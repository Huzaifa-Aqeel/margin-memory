-- Recoverable investigation leases and append-only evidence. Privileged RPCs recheck membership.
alter table public.investigations add column heartbeat_at timestamptz, add column lease_expires_at timestamptz, add column attempt integer not null default 1;
update public.investigations set status='failed',error='lease_expired',completed_at=now() where status='investigating';
create unique index one_live_investigation on public.investigations(estimate_id) where status='investigating';
create table public.investigation_evidence (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id),
 investigation_id uuid not null,
 kind text not null check(kind in ('search','inspection','calculation','document','missing_categories','calibration')),
 tool_name text not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 unique(organization_id,investigation_id,id),
 foreign key(organization_id,investigation_id) references public.investigations(organization_id,id) on delete restrict
);
alter table public.investigation_evidence enable row level security;
create policy evidence_read on public.investigation_evidence for select to authenticated using(public.is_org_member(organization_id));
revoke all on public.investigation_evidence from anon,authenticated;
grant select on public.investigation_evidence to authenticated;
alter table public.findings add column evidence_refs uuid[] not null default '{}';
alter table public.submission_findings add column evidence_snapshot jsonb not null default '{}'::jsonb;

create function public.guard_append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'immutable historical record'; end; $$;
create trigger evidence_immutable before update or delete on public.investigation_evidence for each row execute function public.guard_append_only();
create trigger submission_immutable before update or delete on public.submission_findings for each row execute function public.guard_append_only();

create function public.append_investigation_evidence(p_organization_id uuid,p_investigation_id uuid,p_actor_user_id uuid,p_entry jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_job uuid; v_kind text:=p_entry->>'kind';
begin
 if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id) then raise exception 'not authorized'; end if;
 select id into v_id from public.investigations where organization_id=p_organization_id and id=p_investigation_id and status='investigating' and lease_expires_at>clock_timestamp() for update;
 if v_id is null then raise exception 'investigation lease lost'; end if;
 if (p_entry->>'investigationId')::uuid is distinct from p_investigation_id then raise exception 'foreign evidence'; end if;
 if v_kind in ('search','inspection','calculation') then
  for v_job in select value::uuid from jsonb_array_elements_text(case v_kind when 'search' then p_entry->'result'->'jobIds' when 'inspection' then jsonb_build_array(p_entry->'result'->>'jobId') else p_entry->'result'->'comparableJobIds' end) loop
   if not exists(select 1 from public.jobs where id=v_job and organization_id=p_organization_id) then raise exception 'foreign job'; end if;
   if v_kind<>'search' and not exists(select 1 from public.investigation_evidence where investigation_id=p_investigation_id and kind='search' and result->'jobIds' ? v_job::text) then raise exception 'job not retrieved'; end if;
  end loop;
 end if;
 insert into public.investigation_evidence(id,organization_id,investigation_id,kind,tool_name,result)
 values((p_entry->>'id')::uuid,p_organization_id,p_investigation_id,v_kind,p_entry->>'toolName',p_entry->'result');
 return (p_entry->>'id')::uuid;
end; $$;
revoke execute on function public.append_investigation_evidence(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.append_investigation_evidence(uuid,uuid,uuid,jsonb) to service_role;
create or replace function public.begin_investigation(
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
declare v_stage text; v_attempt integer;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id) then
    raise exception 'actor is not a member of this organization';
  end if;
  select lifecycle_status into v_stage from public.estimates
  where id=p_estimate_id and organization_id=p_organization_id for update;
  if v_stage is null then raise exception 'estimate not found'; end if;
  if v_stage not in ('draft','reviewed') then raise exception 'submitted estimates are frozen; review cannot be rerun after submission'; end if;
  if exists(select 1 from public.investigations where organization_id=p_organization_id and estimate_id=p_estimate_id and status='investigating' and lease_expires_at>clock_timestamp()) then
    raise exception using message='investigation_already_running',errcode='55P03';
  end if;

  update public.investigations set status='failed',error='lease_expired',completed_at=now() where organization_id=p_organization_id and estimate_id=p_estimate_id and status='investigating';
  select coalesce(max(attempt),0)+1 into v_attempt from public.investigations where estimate_id=p_estimate_id;
  insert into public.investigations(id,organization_id,estimate_id,status,heartbeat_at,lease_expires_at,attempt)
  values(p_investigation_id,p_organization_id,p_estimate_id,'investigating',clock_timestamp(),clock_timestamp()+interval '90 seconds',v_attempt);
  update public.estimates set status='reviewing',investigation_status='investigating'
  where id=p_estimate_id and organization_id=p_organization_id;
  return p_investigation_id;
end;
$$;

create function public.renew_investigation_lease(p_organization_id uuid,p_estimate_id uuid,p_investigation_id uuid,p_actor_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id) then raise exception 'not authorized'; end if;
 perform 1 from public.estimates where id=p_estimate_id and organization_id=p_organization_id for update;
 update public.investigations set heartbeat_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '90 seconds'
 where id=p_investigation_id and estimate_id=p_estimate_id and organization_id=p_organization_id and status='investigating' and lease_expires_at>clock_timestamp();
 if not found then raise exception 'investigation lease lost'; end if;
end; $$;
revoke execute on function public.renew_investigation_lease(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.renew_investigation_lease(uuid,uuid,uuid,uuid) to service_role;
create or replace function public.persist_investigation_result(
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
  if jsonb_array_length(coalesce(p_findings,'[]'::jsonb))>3 then raise exception 'too many findings'; end if;
  if jsonb_array_length(coalesce(p_questions,'[]'::jsonb))>2 then raise exception 'too many human questions'; end if;

  select lifecycle_status into v_stage from public.estimates
  where id=p_estimate_id and organization_id=p_organization_id for update;
  if v_stage is null then raise exception 'estimate not found'; end if;
  if v_stage not in ('draft','reviewed') then raise exception 'submitted estimates are frozen'; end if;

  select status into v_running_status from public.investigations
  where id=p_investigation_id and estimate_id=p_estimate_id and organization_id=p_organization_id for update;
  if v_running_status is null then raise exception 'investigation not found'; end if;
  if v_running_status<>'investigating' or not exists(select 1 from public.investigations where id=p_investigation_id and lease_expires_at>clock_timestamp()) then raise exception 'investigation is not running'; end if;

  -- Preserve resolved/dismissed history; atomically replace only active review work.
  delete from public.findings where organization_id=p_organization_id and estimate_id=p_estimate_id and status='open';
  delete from public.human_questions where organization_id=p_organization_id and estimate_id=p_estimate_id and resolved_at is null;

  for f in select value from jsonb_array_elements(coalesce(p_findings,'[]'::jsonb)) loop
    v_finding_id:=(f->>'id')::uuid;
    if jsonb_array_length(coalesce(f->'evidenceRefs','[]'))=0 then raise exception 'calculation evidence required'; end if;
    if exists(select 1 from jsonb_array_elements_text(f->'evidenceRefs') ref where not exists(select 1 from public.investigation_evidence ie where ie.id=ref.value::uuid and ie.investigation_id=p_investigation_id and ie.organization_id=p_organization_id)) then raise exception 'unknown or foreign evidence'; end if;
    if not exists(select 1 from public.investigation_evidence ie where ie.id in (select value::uuid from jsonb_array_elements_text(f->'evidenceRefs')) and ie.kind='calculation' and ie.result->>'category'=f->>'category') then raise exception 'category calculation required'; end if;
    insert into public.findings(
      id,organization_id,estimate_id,investigation_id,category,severity,title,claim,rationale,recommendation,question,confidence,status,created_at,evidence_refs
    ) values (
      v_finding_id,p_organization_id,p_estimate_id,p_investigation_id,f->>'category',f->>'severity',f->>'title',f->>'claim',
      f->>'rationale',f->>'recommendation',nullif(f->>'question',''),least(1,greatest(0,coalesce((f->>'confidence')::numeric,0.5))),'open',now(),array(select value::uuid from jsonb_array_elements_text(f->'evidenceRefs'))
    );
    for e in select value from jsonb_array_elements(coalesce(f->'evidence','[]'::jsonb)) loop
      if not exists(select 1 from public.investigation_evidence where investigation_id=p_investigation_id and kind='search' and result->'jobIds' ? (e->>'jobId')) or not exists(select 1 from public.investigation_evidence ie where ie.investigation_id=p_investigation_id and ie.id in (select value::uuid from jsonb_array_elements_text(f->'evidenceRefs')) and ((ie.kind='inspection' and ie.result->>'jobId'=e->>'jobId') or (ie.kind='calculation' and ie.result->'comparableJobIds' ? (e->>'jobId')))) then raise exception 'unconsumed job citation'; end if;
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

create or replace function public.fail_investigation(
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
  if not found then return; end if;
  update public.estimates set status='draft',investigation_status='failed'
  where id=p_estimate_id and organization_id=p_organization_id;
end;
$$;

create or replace function public.answer_estimator_question(
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

  if exists(select 1 from public.investigations where estimate_id=p_estimate_id and status='investigating' and lease_expires_at>clock_timestamp()) then raise exception 'investigation_already_running'; end if;
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

-- Prevent fabricated lifecycle state at INSERT and bind supplied creator identity.
create function public.guard_estimate_insert() returns trigger language plpgsql set search_path='' as $$
begin
 if new.lifecycle_status<>'draft' or new.status<>'draft' or new.investigation_status<>'queued' or new.reviewed_at is not null or new.submitted_at is not null or new.submitted_amount is not null or new.won_at is not null or new.lost_at is not null or new.contract_value is not null or new.started_at is not null or new.completed_at is not null or new.actuals_imported_at is not null or new.learned_at is not null or new.agent_summary is not null then raise exception 'new estimates must start as unreviewed drafts'; end if;
 if new.created_by is distinct from auth.uid() then raise exception 'invalid creator'; end if;
 return new;
end; $$;
create trigger estimate_insert_guard before insert on public.estimates for each row execute function public.guard_estimate_insert();
-- All line changes are append-only imports. Revisions require a new estimate; no overwrite API exists.
revoke update,delete on public.estimate_lines,public.job_estimate_lines,public.job_actual_lines,public.job_variances from authenticated;
create function public.guard_estimate_line_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.estimates where id=new.estimate_id and organization_id=new.organization_id and lifecycle_status='draft' and investigation_status='queued') then raise exception 'estimate lines are frozen once investigation starts'; end if;
 return new;
end; $$;
create trigger estimate_line_insert_guard before insert on public.estimate_lines for each row execute function public.guard_estimate_line_insert();
-- Historical jobs cannot be attached to an estimate through a direct client INSERT.
revoke insert on public.jobs from authenticated;
grant insert(id,organization_id,created_by,name,project_type,customer_type,location,completed_at,tags,notes,estimated_total,actual_total,gross_margin_pct,created_at) on public.jobs to authenticated;
-- Snapshot the complete warning, evidence ledger, line items and source text at submission.
create function public.snapshot_submission_evidence() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select jsonb_build_object('finding',to_jsonb(f),'evidence',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.finding_evidence e where e.finding_id=f.id),'toolEvidence',(select coalesce(jsonb_agg(to_jsonb(ie)),'[]') from public.investigation_evidence ie where ie.id=any(f.evidence_refs)),'estimateLines',(select coalesce(jsonb_agg(to_jsonb(el)),'[]') from public.estimate_lines el where el.estimate_id=f.estimate_id),'documents',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.documents d where d.estimate_id=f.estimate_id)) into new.evidence_snapshot from public.findings f where f.id=new.finding_id;
 return new;
end; $$;
create trigger submission_snapshot before insert on public.submission_findings for each row execute function public.snapshot_submission_evidence();
-- Original files and their extracted text are append-only; object names are unique per upload.
revoke update,delete on public.documents from authenticated;
drop policy "tenant update job files" on storage.objects;
drop policy "tenant delete job files" on storage.objects;
create policy "tenant remove unattached upload" on storage.objects for delete to authenticated using(bucket_id='job-files' and public.is_org_member(((storage.foldername(name))[1])::uuid) and not exists(select 1 from public.documents d where d.storage_path=name));
-- Relationships must agree on the estimate as well as the organization.
alter table public.investigations add constraint investigations_org_estimate_unique unique(organization_id,estimate_id,id);
alter table public.findings add constraint finding_same_estimate_investigation foreign key(organization_id,estimate_id,investigation_id) references public.investigations(organization_id,estimate_id,id);
alter table public.human_questions add constraint question_same_estimate_investigation foreign key(organization_id,estimate_id,investigation_id) references public.investigations(organization_id,estimate_id,id);
alter table public.human_questions add constraint question_same_estimate_finding foreign key(organization_id,estimate_id,finding_id) references public.findings(organization_id,estimate_id,id);
create or replace function public.match_lessons(
  p_organization_id uuid,
  query_embedding extensions.vector(1536),
  match_threshold float default 0.25,
  match_count int default 8
)
returns table (
  id uuid, job_id uuid, title text, category text, lesson text, cause text,
  impact_summary text, confidence numeric, similarity float
)
language sql stable security invoker set search_path = ''
as $$
  select l.id, l.job_id, l.title, l.category, l.lesson, l.cause,
         l.impact_summary, l.confidence,
         1 - (l.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.lessons l
  where l.organization_id = p_organization_id
    and l.status = 'confirmed'
    and l.embedding is not null
    and 1 - (l.embedding OPERATOR(extensions.<=>) query_embedding) >= match_threshold
  order by l.embedding OPERATOR(extensions.<=>) query_embedding
  limit least(match_count, 20);
$$;

create or replace function public.match_jobs(
  p_organization_id uuid,
  query_embedding extensions.vector(1536),
  p_project_type text default null,
  p_customer_type text default null,
  match_threshold float default 0.18,
  match_count int default 10
)
returns table (
  id uuid, name text, project_type text, customer_type text, tags text[],
  estimated_total numeric, actual_total numeric, similarity float
)
language sql stable security invoker set search_path = ''
as $$
  select j.id, j.name, j.project_type, j.customer_type, j.tags,
         j.estimated_total, j.actual_total,
         1 - (d.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.job_search_documents d
  join public.jobs j on j.id = d.job_id
  where d.organization_id = p_organization_id
    and d.embedding is not null
    and (p_project_type is null or lower(j.project_type) = lower(p_project_type))
    and (p_customer_type is null or lower(j.customer_type) = lower(p_customer_type))
    and 1 - (d.embedding OPERATOR(extensions.<=>) query_embedding) >= match_threshold
  order by d.embedding OPERATOR(extensions.<=>) query_embedding
  limit least(match_count, 20);
$$;

-- RLS
