-- Closed-loop estimate -> outcome -> learning lifecycle.
-- Keeps review readiness separate from commercial/job lifecycle and evaluates whether prior warnings were useful.

alter table public.estimates
  add column lifecycle_status text not null default 'draft'
    check (lifecycle_status in ('draft','reviewed','submitted','won','lost','in_progress','completed','learning_review','learned')),
  add column submitted_at timestamptz,
  add column submitted_amount numeric(14,2),
  add column won_at timestamptz,
  add column lost_at timestamptz,
  add column lost_reason text,
  add column contract_value numeric(14,2),
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add column actuals_imported_at timestamptz,
  add column learned_at timestamptz,
  add column closeout_notes text not null default '';

alter table public.jobs
  add column source_estimate_id uuid,
  add column contract_value numeric(14,2);

create unique index jobs_source_estimate_unique
  on public.jobs(source_estimate_id)
  where source_estimate_id is not null;

alter table public.jobs
  add constraint jobs_org_source_estimate_fk
  foreign key (organization_id, source_estimate_id)
  references public.estimates(organization_id, id)
  on delete set null (source_estimate_id);

create table public.lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid not null,
  from_stage text,
  to_stage text not null,
  note text not null default '',
  amount numeric(14,2),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (organization_id, estimate_id) references public.estimates(organization_id, id) on delete cascade
);

create table public.finding_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid not null,
  finding_id uuid not null,
  job_id uuid not null,
  system_verdict text not null check (system_verdict in ('validated','partially_validated','not_observed','not_evaluable')),
  confirmed_verdict text check (confirmed_verdict in ('validated','partially_validated','not_observed','not_evaluable')),
  explanation text not null,
  evidence_summary text not null default '',
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(finding_id),
  foreign key (organization_id, estimate_id) references public.estimates(organization_id, id) on delete cascade,
  foreign key (organization_id, finding_id) references public.findings(organization_id, id) on delete cascade,
  foreign key (organization_id, job_id) references public.jobs(organization_id, id) on delete cascade
);


-- A submitted bid gets an immutable snapshot of exactly the findings from its final investigation.
-- This is the canonical set later used to score whether Margin Memory's warnings were useful.
create table public.submission_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid not null,
  finding_id uuid not null,
  investigation_id uuid not null,
  category text not null check (category in ('labor','materials','equipment','subcontractor','permit','other','scope','assumption')),
  severity text not null check (severity in ('low','medium','high')),
  title text not null,
  claim text not null,
  recommendation text not null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  submitted_at timestamptz not null default now(),
  unique(estimate_id, finding_id),
  foreign key (organization_id, estimate_id) references public.estimates(organization_id, id) on delete cascade,
  foreign key (organization_id, finding_id) references public.findings(organization_id, id) on delete cascade,
  foreign key (organization_id, investigation_id) references public.investigations(organization_id, id) on delete cascade
);

-- Strong relational integrity: an outcome must refer to a finding and completed job from the same estimate.
alter table public.findings
  add constraint findings_org_estimate_finding_unique unique (organization_id, estimate_id, id);
alter table public.jobs
  add constraint jobs_org_source_estimate_job_unique unique (organization_id, source_estimate_id, id);
alter table public.finding_outcomes
  add constraint finding_outcomes_same_estimate_finding_fk
  foreign key (organization_id, estimate_id, finding_id)
  references public.findings(organization_id, estimate_id, id) on delete cascade;
alter table public.finding_outcomes
  add constraint finding_outcomes_same_estimate_job_fk
  foreign key (organization_id, estimate_id, job_id)
  references public.jobs(organization_id, source_estimate_id, id) on delete cascade;

create index submission_findings_estimate_idx on public.submission_findings(estimate_id, submitted_at);
create index lifecycle_events_estimate_idx on public.lifecycle_events(estimate_id, created_at);
create index finding_outcomes_estimate_idx on public.finding_outcomes(estimate_id, confirmed_at);
create index finding_outcomes_org_verdict_idx on public.finding_outcomes(organization_id, confirmed_verdict);

alter table public.lifecycle_events enable row level security;
alter table public.finding_outcomes enable row level security;
alter table public.submission_findings enable row level security;
create policy lifecycle_events_tenant on public.lifecycle_events for all to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy finding_outcomes_tenant on public.finding_outcomes for all to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy submission_findings_tenant on public.submission_findings for select to authenticated
  using (public.is_org_member(organization_id));

-- Existing estimates were created before lifecycle support. Keep them as draft until the estimator explicitly completes review.
insert into public.lifecycle_events(organization_id, estimate_id, from_stage, to_stage, note, created_by, created_at)
select organization_id, id, null, 'draft', 'Lifecycle tracking enabled', created_by, created_at
from public.estimates
on conflict do nothing;

create or replace function public.transition_estimate_lifecycle(
  p_organization_id uuid,
  p_estimate_id uuid,
  p_to_stage text,
  p_note text default '',
  p_amount numeric default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
  v_review_status text;
  v_investigation_status text;
  v_open_findings integer;
  v_open_questions integer;
  v_effective_amount numeric;
  v_latest_investigation uuid;
begin
  if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
  select lifecycle_status, status, investigation_status
    into v_from, v_review_status, v_investigation_status
  from public.estimates
  where id = p_estimate_id and organization_id = p_organization_id
  for update;

  if v_from is null then raise exception 'estimate not found'; end if;
  if v_from = p_to_stage then return v_from; end if;

  select count(*) into v_open_findings from public.findings
  where organization_id=p_organization_id and estimate_id=p_estimate_id and status='open';
  select count(*) into v_open_questions from public.human_questions
  where organization_id=p_organization_id and estimate_id=p_estimate_id and resolved_at is null;

  if v_from='draft' and p_to_stage='reviewed' then
    if v_review_status <> 'ready' or v_investigation_status <> 'completed' or v_open_findings > 0 or v_open_questions > 0 then
      raise exception 'resolve the preflight before marking this estimate reviewed';
    end if;
    update public.estimates set lifecycle_status='reviewed' where id=p_estimate_id and organization_id=p_organization_id;
  elsif v_from='reviewed' and p_to_stage='submitted' then
    if v_review_status <> 'ready' or v_investigation_status <> 'completed' or v_open_findings > 0 or v_open_questions > 0 then
      raise exception 'preflight changed after review; resolve it again before submission';
    end if;
    select id into v_latest_investigation
    from public.investigations
    where organization_id=p_organization_id and estimate_id=p_estimate_id and status='completed'
    order by completed_at desc nulls last, started_at desc
    limit 1;
    if v_latest_investigation is null then raise exception 'a completed investigation is required before submission'; end if;
    select coalesce(p_amount, estimated_total) into v_effective_amount from public.estimates where id=p_estimate_id and organization_id=p_organization_id;
    if v_effective_amount <= 0 then raise exception 'submitted amount must be greater than zero'; end if;

    insert into public.submission_findings(
      organization_id,estimate_id,finding_id,investigation_id,category,severity,title,claim,recommendation,confidence,submitted_at
    )
    select organization_id,estimate_id,id,investigation_id,category,severity,title,claim,recommendation,confidence,now()
    from public.findings
    where organization_id=p_organization_id and estimate_id=p_estimate_id and investigation_id=v_latest_investigation;

    update public.estimates set lifecycle_status='submitted',submitted_at=now(),submitted_amount=v_effective_amount where id=p_estimate_id and organization_id=p_organization_id;
  elsif v_from='submitted' and p_to_stage='won' then
    select coalesce(p_amount, submitted_amount, estimated_total) into v_effective_amount from public.estimates where id=p_estimate_id;
    if v_effective_amount <= 0 then raise exception 'contract value must be greater than zero'; end if;
    update public.estimates set lifecycle_status='won',won_at=now(),contract_value=v_effective_amount,lost_at=null,lost_reason=null where id=p_estimate_id and organization_id=p_organization_id;
  elsif v_from='submitted' and p_to_stage='lost' then
    update public.estimates set lifecycle_status='lost',lost_at=now(),lost_reason=nullif(trim(coalesce(p_note,'')),'') where id=p_estimate_id and organization_id=p_organization_id;
  elsif v_from='won' and p_to_stage='in_progress' then
    update public.estimates set lifecycle_status='in_progress',started_at=now() where id=p_estimate_id and organization_id=p_organization_id;
  elsif v_from='in_progress' and p_to_stage='completed' then
    update public.estimates set lifecycle_status='completed',completed_at=now() where id=p_estimate_id and organization_id=p_organization_id;
  else
    raise exception 'invalid lifecycle transition from % to %', v_from, p_to_stage;
  end if;

  insert into public.lifecycle_events(organization_id,estimate_id,from_stage,to_stage,note,amount)
  values(p_organization_id,p_estimate_id,v_from,p_to_stage,coalesce(p_note,''),p_amount);
  return p_to_stage;
end;
$$;

create or replace function public.closeout_estimate_with_actuals(
  p_organization_id uuid,
  p_estimate_id uuid,
  p_actual_lines jsonb,
  p_lessons jsonb,
  p_outcomes jsonb,
  p_closeout_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage text;
  v_job_id uuid := extensions.gen_random_uuid();
  v_name text;
  v_project_type text;
  v_customer_type text;
  v_location text;
  v_completed_at timestamptz;
  v_tags text[];
  v_estimated_total numeric;
  v_contract_value numeric;
  v_actual_total numeric;
  v_gross_margin numeric;
  v_snapshot_count integer;
  v_outcome_count integer;
  r jsonb;
begin
  if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;

  select lifecycle_status,name,project_type,customer_type,location,completed_at,tags,estimated_total,coalesce(contract_value,submitted_amount)
    into v_stage,v_name,v_project_type,v_customer_type,v_location,v_completed_at,v_tags,v_estimated_total,v_contract_value
  from public.estimates
  where id=p_estimate_id and organization_id=p_organization_id
  for update;

  if v_stage is null then raise exception 'estimate not found'; end if;
  -- Idempotent retry: if the transaction already committed, return the linked job even though lifecycle advanced.
  if exists(select 1 from public.jobs where organization_id=p_organization_id and source_estimate_id=p_estimate_id) then
    select id into v_job_id from public.jobs where organization_id=p_organization_id and source_estimate_id=p_estimate_id;
    return v_job_id;
  end if;
  if v_stage <> 'completed' then raise exception 'actuals can only be imported after work is marked completed'; end if;
  if v_completed_at is null then raise exception 'completed estimate is missing completion timestamp'; end if;
  if jsonb_array_length(coalesce(p_actual_lines,'[]'::jsonb))=0 then raise exception 'actual cost lines are required'; end if;

  -- Job totals and variances are canonical database calculations; the client cannot provide them.
  select coalesce(sum(coalesce(nullif(value->>'actual_cost','')::numeric,0)),0)
    into v_actual_total
  from jsonb_array_elements(coalesce(p_actual_lines,'[]'::jsonb));
  v_gross_margin := case when coalesce(v_contract_value,0)>0 then (v_contract_value-v_actual_total)/v_contract_value else null end;

  -- Every warning in the immutable submission snapshot must receive exactly one closeout hypothesis.
  select count(*) into v_snapshot_count
  from public.submission_findings
  where organization_id=p_organization_id and estimate_id=p_estimate_id;
  v_outcome_count := jsonb_array_length(coalesce(p_outcomes,'[]'::jsonb));
  if v_outcome_count <> v_snapshot_count then
    raise exception 'closeout must evaluate every warning from the submitted preflight';
  end if;
  if exists(
    select 1
    from jsonb_array_elements(coalesce(p_outcomes,'[]'::jsonb)) x
    where not exists(
      select 1 from public.submission_findings sf
      where sf.organization_id=p_organization_id and sf.estimate_id=p_estimate_id and sf.finding_id=(x.value->>'finding_id')::uuid
    )
  ) then raise exception 'closeout outcome references a finding that was not part of the submitted preflight'; end if;

  insert into public.jobs(
    id,organization_id,created_by,source_estimate_id,name,project_type,customer_type,location,completed_at,tags,notes,
    estimated_total,actual_total,gross_margin_pct,contract_value,created_at
  ) values (
    v_job_id,p_organization_id,(select auth.uid()),p_estimate_id,v_name,v_project_type,v_customer_type,v_location,v_completed_at::date,
    coalesce(v_tags,'{}'),coalesce(p_closeout_notes,''),v_estimated_total,v_actual_total,v_gross_margin,v_contract_value,now()
  );

  insert into public.job_estimate_lines(id,organization_id,job_id,category,description,quantity,unit,estimated_hours,estimated_cost)
  select extensions.gen_random_uuid(),organization_id,v_job_id,category,description,quantity,unit,estimated_hours,estimated_cost
  from public.estimate_lines where organization_id=p_organization_id and estimate_id=p_estimate_id;

  for r in select value from jsonb_array_elements(coalesce(p_actual_lines,'[]'::jsonb)) loop
    insert into public.job_actual_lines(id,organization_id,job_id,category,description,actual_hours,actual_cost)
    values(
      extensions.gen_random_uuid(),p_organization_id,v_job_id,r->>'category',coalesce(nullif(trim(r->>'description'),''),r->>'category'),
      nullif(r->>'actual_hours','')::numeric,coalesce(nullif(r->>'actual_cost','')::numeric,0)
    );
  end loop;

  -- Recompute category variances from canonical estimate/actual rows inside Postgres.
  with categories(category) as (
    values ('labor'::text),('materials'::text),('equipment'::text),('subcontractor'::text),('permit'::text),('other'::text)
  ), est as (
    select category,coalesce(sum(estimated_cost),0) estimated_cost,coalesce(sum(estimated_hours),0) estimated_hours
    from public.job_estimate_lines where organization_id=p_organization_id and job_id=v_job_id group by category
  ), act as (
    select category,coalesce(sum(actual_cost),0) actual_cost,coalesce(sum(actual_hours),0) actual_hours
    from public.job_actual_lines where organization_id=p_organization_id and job_id=v_job_id group by category
  )
  insert into public.job_variances(
    organization_id,job_id,category,estimated_cost,actual_cost,estimated_hours,actual_hours,cost_delta,cost_delta_pct,hours_delta,hours_delta_pct
  )
  select
    p_organization_id,v_job_id,c.category,
    coalesce(e.estimated_cost,0),coalesce(a.actual_cost,0),coalesce(e.estimated_hours,0),coalesce(a.actual_hours,0),
    coalesce(a.actual_cost,0)-coalesce(e.estimated_cost,0),
    case when coalesce(e.estimated_cost,0)<>0 then (coalesce(a.actual_cost,0)-e.estimated_cost)/e.estimated_cost
         when coalesce(a.actual_cost,0)>0 then 1 else null end,
    coalesce(a.actual_hours,0)-coalesce(e.estimated_hours,0),
    case when coalesce(e.estimated_hours,0)<>0 then (coalesce(a.actual_hours,0)-e.estimated_hours)/e.estimated_hours
         when coalesce(a.actual_hours,0)>0 then 1 else null end
  from categories c
  left join est e on e.category=c.category
  left join act a on a.category=c.category
  where coalesce(e.estimated_cost,0)<>0 or coalesce(a.actual_cost,0)<>0 or coalesce(e.estimated_hours,0)<>0 or coalesce(a.actual_hours,0)<>0;

  for r in select value from jsonb_array_elements(coalesce(p_lessons,'[]'::jsonb)) loop
    insert into public.lessons(id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status,created_at)
    values(
      extensions.gen_random_uuid(),p_organization_id,v_job_id,r->>'title',r->>'category',r->>'lesson',r->>'cause',r->>'impact_summary',
      least(1,greatest(0,coalesce((r->>'confidence')::numeric,0.5))),'pending',now()
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_outcomes,'[]'::jsonb)) loop
    insert into public.finding_outcomes(
      id,organization_id,estimate_id,finding_id,job_id,system_verdict,explanation,evidence_summary,confidence
    ) values (
      extensions.gen_random_uuid(),p_organization_id,p_estimate_id,(r->>'finding_id')::uuid,v_job_id,r->>'system_verdict',
      r->>'explanation',coalesce(r->>'evidence_summary',''),least(1,greatest(0,coalesce((r->>'confidence')::numeric,0.5)))
    );
  end loop;

  update public.estimates
  set lifecycle_status='learning_review',actuals_imported_at=now(),closeout_notes=coalesce(p_closeout_notes,'')
  where id=p_estimate_id and organization_id=p_organization_id;

  insert into public.lifecycle_events(organization_id,estimate_id,from_stage,to_stage,note)
    values(p_organization_id,p_estimate_id,'completed','learning_review','Actuals imported and closeout learning prepared');

  return v_job_id;
end;
$$;

create or replace function public.confirm_finding_outcome(
  p_organization_id uuid,
  p_outcome_id uuid,
  p_verdict text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_estimate_id uuid; v_stage text; v_existing text;
begin
  if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
  if p_verdict not in ('validated','partially_validated','not_observed','not_evaluable') then raise exception 'invalid finding outcome verdict'; end if;
  select o.estimate_id,o.confirmed_verdict,e.lifecycle_status into v_estimate_id,v_existing,v_stage
  from public.finding_outcomes o join public.estimates e on e.id=o.estimate_id and e.organization_id=o.organization_id
  where o.id=p_outcome_id and o.organization_id=p_organization_id for update of o;
  if v_estimate_id is null then raise exception 'finding outcome not found'; end if;
  if v_stage='learned' and v_existing=p_verdict then return v_estimate_id; end if;
  if v_stage<>'learning_review' then raise exception 'warning outcomes can only be confirmed during learning review'; end if;
  update public.finding_outcomes set confirmed_verdict=p_verdict,confirmed_at=now(),updated_at=now()
  where id=p_outcome_id and organization_id=p_organization_id;
  return v_estimate_id;
end;
$$;

create or replace function public.try_finalize_estimate_learning(
  p_organization_id uuid,
  p_estimate_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_job_id uuid; v_stage text; v_pending_lessons integer; v_pending_outcomes integer;
begin
  if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
  select lifecycle_status into v_stage from public.estimates where id=p_estimate_id and organization_id=p_organization_id for update;
  if v_stage <> 'learning_review' then return false; end if;
  select id into v_job_id from public.jobs where organization_id=p_organization_id and source_estimate_id=p_estimate_id;
  if v_job_id is null then return false; end if;
  select count(*) into v_pending_lessons from public.lessons where organization_id=p_organization_id and job_id=v_job_id and status='pending';
  select count(*) into v_pending_outcomes
  from public.submission_findings sf
  left join public.finding_outcomes o
    on o.organization_id=sf.organization_id and o.estimate_id=sf.estimate_id and o.finding_id=sf.finding_id
  where sf.organization_id=p_organization_id and sf.estimate_id=p_estimate_id
    and (o.id is null or o.confirmed_verdict is null);
  if v_pending_lessons > 0 or v_pending_outcomes > 0 then return false; end if;
  update public.estimates set lifecycle_status='learned',learned_at=now() where id=p_estimate_id and organization_id=p_organization_id;
  insert into public.lifecycle_events(organization_id,estimate_id,from_stage,to_stage,note)
    values(p_organization_id,p_estimate_id,'learning_review','learned','Closeout lessons and warning outcomes reviewed');
  return true;
end;
$$;


-- Trusted agent-state RPCs. They are callable only with the server-side Supabase secret key.
-- The actor id is still checked against organization membership so an application bug cannot cross tenants.
drop function if exists public.begin_investigation(uuid,uuid,uuid);
drop function if exists public.answer_estimator_question(uuid,uuid,uuid,text);
drop function if exists public.persist_investigation_result(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb);
drop function if exists public.fail_investigation(uuid,uuid,uuid,text);

create function public.begin_investigation(
  p_organization_id uuid,
  p_estimate_id uuid,
  p_investigation_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_stage text;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id) then
    raise exception 'actor is not a member of this organization';
  end if;
  select lifecycle_status into v_stage from public.estimates
  where id=p_estimate_id and organization_id=p_organization_id for update;
  if v_stage is null then raise exception 'estimate not found'; end if;
  if v_stage not in ('draft','reviewed') then raise exception 'submitted estimates are frozen; review cannot be rerun after submission'; end if;
  if exists(select 1 from public.investigations where organization_id=p_organization_id and estimate_id=p_estimate_id and status='investigating') then
    raise exception 'an investigation is already running for this estimate';
  end if;

  insert into public.investigations(id,organization_id,estimate_id,status)
  values(p_investigation_id,p_organization_id,p_estimate_id,'investigating');
  update public.estimates set status='reviewing',investigation_status='investigating'
  where id=p_estimate_id and organization_id=p_organization_id;
  return p_investigation_id;
end;
$$;

create function public.answer_estimator_question(
  p_organization_id uuid,
  p_estimate_id uuid,
  p_question_id uuid,
  p_answer text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_prompt text; v_stage text;
begin
  if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
  if char_length(trim(coalesce(p_answer,'')))=0 then raise exception 'answer is required'; end if;
  select lifecycle_status into v_stage from public.estimates
  where id=p_estimate_id and organization_id=p_organization_id for update;
  if v_stage is null then raise exception 'estimate not found'; end if;
  if v_stage not in ('draft','reviewed') then raise exception 'submitted estimates are frozen'; end if;

  update public.human_questions set answer=trim(p_answer),resolved_at=now()
  where id=p_question_id and estimate_id=p_estimate_id and organization_id=p_organization_id and resolved_at is null
  returning prompt into v_prompt;
  if v_prompt is null then raise exception 'question not found or already resolved'; end if;

  update public.estimates
  set assumptions=array_append(assumptions,format('Estimator response to "%s": %s',v_prompt,trim(p_answer))),
      status='reviewing',investigation_status='queued'
  where id=p_estimate_id and organization_id=p_organization_id;
end;
$$;

create function public.persist_investigation_result(
  p_organization_id uuid,
  p_estimate_id uuid,
  p_investigation_id uuid,
  p_summary text,
  p_mode text,
  p_telemetry jsonb,
  p_findings jsonb,
  p_questions jsonb,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f jsonb; e jsonb; q jsonb; v_finding_id uuid; v_stage text; v_running_status text;
  v_estimate_status text; v_investigation_status text;
  v_cycle_count integer:=coalesce((p_telemetry->>'cycleCount')::integer,0);
  v_tools_used text[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_telemetry->'toolsUsed','[]'::jsonb))),'{}');
  v_duration integer:=nullif(p_telemetry->>'totalDurationMs','')::integer;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id) then
    raise exception 'actor is not a member of this organization';
  end if;
  if p_mode not in ('strands','deterministic') then raise exception 'invalid agent mode'; end if;
  if jsonb_array_length(coalesce(p_findings,'[]'::jsonb))>5 then raise exception 'too many findings'; end if;
  if jsonb_array_length(coalesce(p_questions,'[]'::jsonb))>2 then raise exception 'too many human questions'; end if;

  select lifecycle_status into v_stage from public.estimates
  where id=p_estimate_id and organization_id=p_organization_id for update;
  if v_stage is null then raise exception 'estimate not found'; end if;
  if v_stage not in ('draft','reviewed') then raise exception 'submitted estimates are frozen'; end if;

  select status into v_running_status from public.investigations
  where id=p_investigation_id and estimate_id=p_estimate_id and organization_id=p_organization_id for update;
  if v_running_status is null then raise exception 'investigation not found'; end if;
  if v_running_status<>'investigating' then raise exception 'investigation is not running'; end if;

  -- Preserve resolved/dismissed history; atomically replace only active review work.
  delete from public.findings where organization_id=p_organization_id and estimate_id=p_estimate_id and status='open';
  delete from public.human_questions where organization_id=p_organization_id and estimate_id=p_estimate_id and resolved_at is null;

  for f in select value from jsonb_array_elements(coalesce(p_findings,'[]'::jsonb)) loop
    v_finding_id:=(f->>'id')::uuid;
    insert into public.findings(
      id,organization_id,estimate_id,investigation_id,category,severity,title,claim,rationale,recommendation,question,confidence,status,created_at
    ) values (
      v_finding_id,p_organization_id,p_estimate_id,p_investigation_id,f->>'category',f->>'severity',f->>'title',f->>'claim',
      f->>'rationale',f->>'recommendation',nullif(f->>'question',''),least(1,greatest(0,coalesce((f->>'confidence')::numeric,0.5))),'open',now()
    );
    for e in select value from jsonb_array_elements(coalesce(f->'evidence','[]'::jsonb)) loop
      insert into public.finding_evidence(organization_id,finding_id,job_id,label,detail)
      values(p_organization_id,v_finding_id,(e->>'jobId')::uuid,e->>'label',e->>'detail');
    end loop;
  end loop;

  for q in select value from jsonb_array_elements(coalesce(p_questions,'[]'::jsonb)) loop
    insert into public.human_questions(id,organization_id,estimate_id,investigation_id,prompt,context,options)
    values((q->>'id')::uuid,p_organization_id,p_estimate_id,p_investigation_id,q->>'prompt',coalesce(q->>'context',''),
      coalesce(array(select jsonb_array_elements_text(coalesce(q->'options','[]'::jsonb))),'{}'));
  end loop;

  v_estimate_status:=case when jsonb_array_length(coalesce(p_findings,'[]'::jsonb))>0 or jsonb_array_length(coalesce(p_questions,'[]'::jsonb))>0 then 'needs_input' else 'ready' end;
  v_investigation_status:=case when jsonb_array_length(coalesce(p_questions,'[]'::jsonb))>0 then 'needs_input' else 'completed' end;

  update public.investigations set status=v_investigation_status,mode=p_mode,summary=p_summary,cycle_count=v_cycle_count,
    tools_used=v_tools_used,total_duration_ms=v_duration,error=null,completed_at=now()
  where id=p_investigation_id and estimate_id=p_estimate_id and organization_id=p_organization_id;

  update public.estimates set status=v_estimate_status,investigation_status=v_investigation_status,agent_summary=p_summary,agent_mode=p_mode,
    agent_telemetry=coalesce(p_telemetry,'{"cycleCount":0,"toolsUsed":[]}'::jsonb),reviewed_at=now()
  where id=p_estimate_id and organization_id=p_organization_id;
end;
$$;

create function public.fail_investigation(
  p_organization_id uuid,
  p_estimate_id uuid,
  p_investigation_id uuid,
  p_error text,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_stage text;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id) then
    raise exception 'actor is not a member of this organization';
  end if;
  select lifecycle_status into v_stage from public.estimates
  where id=p_estimate_id and organization_id=p_organization_id for update;
  if v_stage is null then raise exception 'estimate not found'; end if;
  if v_stage not in ('draft','reviewed') then return; end if;
  update public.investigations set status='failed',error=left(coalesce(p_error,'unknown error'),2000),completed_at=now()
  where id=p_investigation_id and estimate_id=p_estimate_id and organization_id=p_organization_id and status='investigating';
  update public.estimates set status='draft',investigation_status='failed'
  where id=p_estimate_id and organization_id=p_organization_id;
end;
$$;

create or replace function public.set_finding_status(
  p_organization_id uuid,
  p_finding_id uuid,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_estimate_id uuid; v_stage text; v_open_findings integer; v_open_questions integer;
begin
  if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
  if p_status not in ('open','resolved','dismissed') then raise exception 'invalid finding status'; end if;
  select f.estimate_id,e.lifecycle_status into v_estimate_id,v_stage
  from public.findings f join public.estimates e on e.id=f.estimate_id and e.organization_id=f.organization_id
  where f.id=p_finding_id and f.organization_id=p_organization_id for update of e;
  if v_estimate_id is null then raise exception 'finding not found'; end if;
  if v_stage not in ('draft','reviewed') then raise exception 'submitted findings are frozen'; end if;

  update public.findings set status=p_status where id=p_finding_id and organization_id=p_organization_id and status<>p_status;
  if not found then raise exception 'finding already has that status'; end if;

  select count(*) into v_open_findings from public.findings where organization_id=p_organization_id and estimate_id=v_estimate_id and status='open';
  select count(*) into v_open_questions from public.human_questions where organization_id=p_organization_id and estimate_id=v_estimate_id and resolved_at is null;
  update public.estimates set status=case when v_open_findings>0 or v_open_questions>0 then 'needs_input' else 'ready' end
  where id=v_estimate_id and organization_id=p_organization_id;
  return v_estimate_id;
end;
$$;


create or replace function public.get_warning_calibration(
  p_organization_id uuid,
  p_category text default null
)
returns table(
  total bigint,
  evaluable bigint,
  validated bigint,
  partially_validated bigint,
  not_observed bigint,
  not_evaluable bigint,
  hit_rate numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select o.confirmed_verdict
    from public.finding_outcomes o
    join public.findings f on f.id=o.finding_id and f.organization_id=o.organization_id
    where o.organization_id=p_organization_id
      and o.confirmed_verdict is not null
      and (p_category is null or f.category=p_category)
  ), counts as (
    select
      count(*)::bigint as total,
      count(*) filter(where confirmed_verdict in ('validated','partially_validated','not_observed'))::bigint as evaluable,
      count(*) filter(where confirmed_verdict='validated')::bigint as validated,
      count(*) filter(where confirmed_verdict='partially_validated')::bigint as partially_validated,
      count(*) filter(where confirmed_verdict='not_observed')::bigint as not_observed,
      count(*) filter(where confirmed_verdict='not_evaluable')::bigint as not_evaluable
    from scoped
  )
  select total,evaluable,validated,partially_validated,not_observed,not_evaluable,
    case when evaluable=0 then null else (validated::numeric + partially_validated::numeric*0.5)/evaluable::numeric end as hit_rate
  from counts;
$$;

-- Enforce lifecycle integrity even if an authenticated tenant calls PostgREST directly.
create or replace function public.enforce_estimate_lifecycle_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_open_findings integer; v_open_questions integer; v_job_exists boolean; v_pending_lessons integer; v_pending_outcomes integer; v_job_id uuid;
begin
  if new.lifecycle_status = old.lifecycle_status then
    if new.submitted_at is distinct from old.submitted_at or new.submitted_amount is distinct from old.submitted_amount or new.won_at is distinct from old.won_at or new.lost_at is distinct from old.lost_at or new.lost_reason is distinct from old.lost_reason or new.contract_value is distinct from old.contract_value or new.started_at is distinct from old.started_at or new.completed_at is distinct from old.completed_at or new.actuals_imported_at is distinct from old.actuals_imported_at or new.learned_at is distinct from old.learned_at or new.closeout_notes is distinct from old.closeout_notes then
      raise exception 'lifecycle-managed fields cannot be edited directly';
    end if;
    return new;
  end if;
  if not (
    (old.lifecycle_status='draft' and new.lifecycle_status='reviewed') or
    (old.lifecycle_status='reviewed' and new.lifecycle_status='submitted') or
    (old.lifecycle_status='submitted' and new.lifecycle_status in ('won','lost')) or
    (old.lifecycle_status='won' and new.lifecycle_status='in_progress') or
    (old.lifecycle_status='in_progress' and new.lifecycle_status='completed') or
    (old.lifecycle_status='completed' and new.lifecycle_status='learning_review') or
    (old.lifecycle_status='learning_review' and new.lifecycle_status='learned')
  ) then raise exception 'invalid lifecycle transition from % to %', old.lifecycle_status, new.lifecycle_status; end if;

  if new.lifecycle_status in ('reviewed','submitted') then
    select count(*) into v_open_findings from public.findings where organization_id=old.organization_id and estimate_id=old.id and status='open';
    select count(*) into v_open_questions from public.human_questions where organization_id=old.organization_id and estimate_id=old.id and resolved_at is null;
    if old.status <> 'ready' or old.investigation_status <> 'completed' or old.reviewed_at is null or v_open_findings>0 or v_open_questions>0 then
      raise exception 'preflight must be completed and resolved before this lifecycle transition';
    end if;
  end if;

  if new.lifecycle_status='learning_review' then
    select exists(select 1 from public.jobs where organization_id=old.organization_id and source_estimate_id=old.id) into v_job_exists;
    if not v_job_exists then raise exception 'actuals must be imported before learning review'; end if;
  end if;

  if new.lifecycle_status='learned' then
    select id into v_job_id from public.jobs where organization_id=old.organization_id and source_estimate_id=old.id;
    if v_job_id is null then raise exception 'completed job is required before learning can close'; end if;
    select count(*) into v_pending_lessons from public.lessons where organization_id=old.organization_id and job_id=v_job_id and status='pending';
    select count(*) into v_pending_outcomes
    from public.submission_findings sf
    left join public.finding_outcomes o
      on o.organization_id=sf.organization_id and o.estimate_id=sf.estimate_id and o.finding_id=sf.finding_id
    where sf.organization_id=old.organization_id and sf.estimate_id=old.id
      and (o.id is null or o.confirmed_verdict is null);
    if v_pending_lessons>0 or v_pending_outcomes>0 then raise exception 'learning review still has unverified items'; end if;
  end if;
  if new.lifecycle_status='submitted' and (new.submitted_at is null or coalesce(new.submitted_amount,0)<=0) then raise exception 'submitted bid requires amount and timestamp'; end if;
  if new.lifecycle_status='won' and (new.won_at is null or coalesce(new.contract_value,0)<=0) then raise exception 'won bid requires contract value and timestamp'; end if;
  if new.lifecycle_status='lost' and new.lost_at is null then raise exception 'lost bid requires timestamp'; end if;
  if new.lifecycle_status='in_progress' and new.started_at is null then raise exception 'in-progress job requires start timestamp'; end if;
  if new.lifecycle_status='completed' and new.completed_at is null then raise exception 'completed job requires completion timestamp'; end if;
  if new.lifecycle_status='learning_review' and new.actuals_imported_at is null then raise exception 'learning review requires imported actuals'; end if;
  if new.lifecycle_status='learned' and new.learned_at is null then raise exception 'learned lifecycle requires completion timestamp'; end if;
  return new;
end;
$$;

drop trigger if exists estimates_lifecycle_guard on public.estimates;
create trigger estimates_lifecycle_guard before update of lifecycle_status on public.estimates
for each row execute function public.enforce_estimate_lifecycle_update();

create or replace function public.freeze_submitted_findings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_stage text; v_estimate_id uuid; v_org_id uuid;
begin
  -- Allow only nested FK-cascade cleanup; direct tenant deletion of frozen findings remains blocked.
  if tg_op='DELETE' and pg_catalog.pg_trigger_depth()>1 then return old; end if;
  if tg_op='DELETE' then v_estimate_id:=old.estimate_id; v_org_id:=old.organization_id; else v_estimate_id:=new.estimate_id; v_org_id:=new.organization_id; end if;
  select lifecycle_status into v_stage from public.estimates where id=v_estimate_id and organization_id=v_org_id;
  if v_stage not in ('draft','reviewed') then raise exception 'preflight findings are frozen after submission'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists findings_freeze_guard on public.findings;
create trigger findings_freeze_guard before insert or update or delete on public.findings
for each row execute function public.freeze_submitted_findings();

-- Lifecycle/audit records are readable by tenants but writable only through guarded server RPCs.
-- Agent/review state is changed only through guarded RPCs, never direct PostgREST mutation.
revoke update on public.estimates from authenticated;
revoke insert, update, delete on public.investigations from authenticated;
revoke insert, update, delete on public.findings from authenticated;
revoke insert, update, delete on public.finding_evidence from authenticated;
revoke insert, update, delete on public.human_questions from authenticated;
grant select on public.investigations,public.findings,public.finding_evidence,public.human_questions to authenticated;
revoke insert, update, delete on public.lifecycle_events from authenticated;
revoke insert, update, delete on public.finding_outcomes from authenticated;
revoke insert, update, delete on public.submission_findings from authenticated;
grant select on public.lifecycle_events to authenticated;
grant select on public.finding_outcomes to authenticated;
grant select on public.submission_findings to authenticated;
revoke update, delete on public.jobs from authenticated;
revoke delete on public.estimates from authenticated;

revoke execute on function public.get_warning_calibration(uuid,text) from public,anon;
grant execute on function public.get_warning_calibration(uuid,text) to authenticated;

revoke execute on function public.begin_investigation(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke execute on function public.persist_investigation_result(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke execute on function public.fail_investigation(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.begin_investigation(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.persist_investigation_result(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,uuid) to service_role;
grant execute on function public.fail_investigation(uuid,uuid,uuid,text,uuid) to service_role;

revoke execute on function public.answer_estimator_question(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.answer_estimator_question(uuid,uuid,uuid,text) to authenticated;
revoke execute on function public.set_finding_status(uuid,uuid,text) from public,anon;
grant execute on function public.set_finding_status(uuid,uuid,text) to authenticated;

revoke execute on function public.transition_estimate_lifecycle(uuid,uuid,text,text,numeric) from public,anon;
revoke execute on function public.closeout_estimate_with_actuals(uuid,uuid,jsonb,jsonb,jsonb,text) from public,anon;
revoke execute on function public.confirm_finding_outcome(uuid,uuid,text) from public,anon;
revoke execute on function public.try_finalize_estimate_learning(uuid,uuid) from public,anon;
grant execute on function public.transition_estimate_lifecycle(uuid,uuid,text,text,numeric) to authenticated;
grant execute on function public.closeout_estimate_with_actuals(uuid,uuid,jsonb,jsonb,jsonb,text) to authenticated;
grant execute on function public.confirm_finding_outcome(uuid,uuid,text) to authenticated;
grant execute on function public.try_finalize_estimate_learning(uuid,uuid) to authenticated;
