-- Human actions are append-only events, separate from the immutable bid.
create table public.finding_responses (
 id uuid primary key,
 organization_id uuid not null,
 estimate_id uuid not null,
 finding_id uuid not null,
 kind text not null check(kind in ('mitigation_planned','mitigation_completed','verified','accepted_risk','dismissed')),
 note text not null check(length(btrim(note)) between 1 and 4000),
 revision_reference text not null default '' check(length(revision_reference)<=500),
 requested_status text check(requested_status in ('resolved','dismissed')),
 recorded_at timestamptz not null default clock_timestamp(),
 recorded_stage text not null,
 recorded_by uuid not null references auth.users(id),
 unique(organization_id,estimate_id,finding_id,id),
 foreign key(organization_id,estimate_id,finding_id) references public.findings(organization_id,estimate_id,id) on delete restrict
);
create index finding_responses_finding_time on public.finding_responses(organization_id,finding_id,recorded_at,id);
alter table public.finding_responses enable row level security;
create policy finding_responses_read on public.finding_responses for select to authenticated using(public.is_org_member(organization_id));
revoke all on public.finding_responses from public,anon,authenticated;
grant select on public.finding_responses to authenticated,service_role;
create trigger finding_responses_immutable before update or delete on public.finding_responses for each row execute function public.guard_append_only();

-- SECURITY DEFINER follows the existing narrow write RPCs: direct writes to
-- responses/findings are revoked; membership and parent lifecycle are rechecked.
create function public.record_finding_response(p_organization_id uuid,p_finding_id uuid,p_response_id uuid,p_response jsonb,p_status text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_estimate uuid; v_stage text; v_existing public.finding_responses; v_kind text; v_note text; v_revision text;
begin
 if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
 if p_response_id is null or jsonb_typeof(p_response) is distinct from 'object'
   or p_response - array['kind','note','revisionReference'] <> '{}'::jsonb
   or coalesce(p_response->>'kind','') not in ('mitigation_planned','mitigation_completed','verified','accepted_risk','dismissed')
   or jsonb_typeof(p_response->'note') is distinct from 'string' or length(btrim(p_response->>'note')) not between 1 and 4000
   or jsonb_typeof(p_response->'revisionReference') is distinct from 'string' or length(btrim(p_response->>'revisionReference'))>500 then raise exception 'invalid warning response'; end if;
 v_kind:=p_response->>'kind';v_note:=btrim(p_response->>'note');v_revision:=btrim(p_response->>'revisionReference');
 if p_status is not null and (p_status not in ('resolved','dismissed') or (p_status='dismissed')<>(v_kind='dismissed')) then raise exception 'response must match finding decision'; end if;
 select f.estimate_id into v_estimate from public.findings f where f.id=p_finding_id and f.organization_id=p_organization_id;
 if v_estimate is null then raise exception 'finding not found'; end if;
 -- Same parent lock as submission, closeout and learning: no event can straddle them.
 select lifecycle_status into v_stage from public.estimates where id=v_estimate and organization_id=p_organization_id for update;
 select * into v_existing from public.finding_responses where id=p_response_id;
 if found then
   if v_existing.organization_id=p_organization_id and v_existing.finding_id=p_finding_id
     and v_existing.recorded_by=(select auth.uid()) and v_existing.kind=v_kind and v_existing.note=v_note
     and v_existing.revision_reference=v_revision and v_existing.requested_status is not distinct from p_status then return p_response_id; end if;
   raise exception 'response retry conflicts with saved record';
 end if;
 if v_stage not in ('draft','reviewed','submitted','won','in_progress','completed') then raise exception 'warning responses are closed after actuals or bid closure'; end if;
 if v_stage not in ('draft','reviewed') then
   if p_status is not null then raise exception 'submitted findings are frozen'; end if;
   if not exists(select 1 from public.submission_findings where organization_id=p_organization_id and estimate_id=v_estimate and finding_id=p_finding_id) then raise exception 'response requires a submitted warning'; end if;
 end if;
 if p_status is not null then perform public.set_finding_status(p_organization_id,p_finding_id,p_status); end if;
 insert into public.finding_responses(id,organization_id,estimate_id,finding_id,kind,note,revision_reference,requested_status,recorded_stage,recorded_by)
 values(p_response_id,p_organization_id,v_estimate,p_finding_id,v_kind,v_note,v_revision,p_status,v_stage,(select auth.uid()));
 return p_response_id;
end; $$;
revoke all on function public.record_finding_response(uuid,uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.record_finding_response(uuid,uuid,uuid,jsonb,text) to authenticated;

alter table public.submission_findings add column response_snapshot jsonb not null default '[]'::jsonb;
create function public.snapshot_warning_responses() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select coalesce(jsonb_agg(to_jsonb(r) order by r.recorded_at,r.id),'[]') into new.response_snapshot
 from public.finding_responses r where r.organization_id=new.organization_id and r.estimate_id=new.estimate_id and r.finding_id=new.finding_id;
 return new;
end; $$;
create trigger submission_response_snapshot before insert on public.submission_findings for each row execute function public.snapshot_warning_responses();

alter table public.finding_outcomes drop constraint finding_outcomes_confirmed_verdict_check;
alter table public.finding_outcomes add constraint finding_outcomes_confirmed_verdict_check
 check(confirmed_verdict in ('validated','partially_validated','not_observed','not_evaluable','mitigated'));
alter table public.finding_outcomes add column confirmed_assessment jsonb, add column confirmed_response_id uuid;
alter table public.finding_outcomes add constraint finding_outcome_response_same_warning
 foreign key(organization_id,estimate_id,finding_id,confirmed_response_id) references public.finding_responses(organization_id,estimate_id,finding_id,id) on delete restrict;

-- A successful job after intervention cannot establish that the warning was false;
-- an overrun after intervention also cannot establish how well that action worked.
create function public.guard_mitigation_outcome() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.finding_responses r where r.organization_id=new.organization_id and r.finding_id=new.finding_id and r.kind='mitigation_completed') then
   new.system_verdict:='not_evaluable';new.confidence:=0;
   new.explanation:='A completed mitigation was recorded. Review condition occurrence and response effectiveness separately; variance alone cannot judge the warning.';
 end if;
 return new;
end; $$;
create trigger mitigation_outcome before insert on public.finding_outcomes for each row execute function public.guard_mitigation_outcome();

alter function public.confirm_finding_outcome(uuid,uuid,text) rename to confirm_finding_outcome_before_response;
revoke all on function public.confirm_finding_outcome_before_response(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.confirm_finding_outcome(p_organization_id uuid,p_outcome_id uuid,p_verdict text,p_assessment jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_estimate uuid; v_finding uuid; v_stage text; v_existing text; v_assessment jsonb; v_response uuid; v_derived text; v_completed boolean;
begin
 if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
 select estimate_id,finding_id into v_estimate,v_finding from public.finding_outcomes where id=p_outcome_id and organization_id=p_organization_id;
 if v_estimate is null then raise exception 'finding outcome not found'; end if;
 select lifecycle_status into v_stage from public.estimates where id=v_estimate and organization_id=p_organization_id for update;
 select confirmed_verdict,confirmed_assessment into v_existing,v_assessment from public.finding_outcomes where id=p_outcome_id and organization_id=p_organization_id for update;
 select exists(select 1 from public.finding_responses where organization_id=p_organization_id and finding_id=v_finding and kind='mitigation_completed') into v_completed;
 if p_assessment is not null then
   if jsonb_typeof(p_assessment) is distinct from 'object'
     or p_assessment - array['condition','mitigation','responseId','note'] <> '{}'::jsonb
     or coalesce(p_assessment->>'condition','') not in ('occurred','partially_observed','not_observed','unknown')
     or coalesce(p_assessment->>'mitigation','') not in ('helped','not_helped','unknown','not_attempted')
     or jsonb_typeof(p_assessment->'note') is distinct from 'string' or length(btrim(p_assessment->>'note')) not between 1 and 4000
     or coalesce(jsonb_typeof(p_assessment->'responseId'),'missing') not in ('string','null') then raise exception 'invalid outcome assessment'; end if;
   p_assessment:=jsonb_set(p_assessment,'{note}',to_jsonb(btrim(p_assessment->>'note')));
   v_response:=(p_assessment->>'responseId')::uuid;
   if v_response is not null and not exists(select 1 from public.finding_responses where id=v_response and organization_id=p_organization_id and finding_id=v_finding and estimate_id=v_estimate and kind='mitigation_completed') then raise exception 'assessment requires a completed response for this warning'; end if;
   if p_assessment->>'mitigation' in ('helped','not_helped') and v_response is null then raise exception 'assessment requires a completed response'; end if;
   if p_assessment->>'mitigation'='not_attempted' and (v_response is not null or v_completed) then raise exception 'review the recorded mitigation effect'; end if;
   if p_assessment->>'mitigation'='helped' and p_assessment->>'condition'='unknown' then raise exception 'review condition occurrence before claiming mitigation helped'; end if;
   v_derived:=case when p_assessment->>'mitigation'='helped' then 'mitigated'
     when p_assessment->>'mitigation'='unknown' or p_assessment->>'condition'='unknown' then 'not_evaluable'
     when p_assessment->>'condition'='occurred' then 'validated'
     when p_assessment->>'condition'='partially_observed' then 'partially_validated' else 'not_observed' end;
   if p_verdict is distinct from v_derived then raise exception 'verdict must match the structured assessment'; end if;
 else
   if v_completed then raise exception 'completed mitigation requires a structured outcome assessment'; end if;
   if p_verdict is null or p_verdict not in ('validated','partially_validated','not_observed','not_evaluable') then raise exception 'invalid finding outcome verdict'; end if;
 end if;
 if v_stage='learned' and v_existing=p_verdict and v_assessment is not distinct from p_assessment then return v_estimate; end if;
 if v_stage<>'learning_review' then raise exception 'warning outcomes can only be confirmed during learning review'; end if;
 update public.finding_outcomes set confirmed_verdict=p_verdict,confirmed_assessment=p_assessment,confirmed_response_id=v_response,
   confirmed_at=now(),updated_at=now() where id=p_outcome_id and organization_id=p_organization_id;
 return v_estimate;
end; $$;
revoke all on function public.confirm_finding_outcome(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.confirm_finding_outcome(uuid,uuid,text,jsonb) to authenticated;

-- Keep human-confirmed mitigations separate from occurrence accuracy. Inconclusive
-- mitigation reviews are already not_evaluable; scope eligibility still applies.
drop function public.get_warning_calibration(uuid,text);
create function public.get_warning_calibration(p_organization_id uuid,p_category text default null)
returns table(total bigint,evaluable bigint,validated bigint,partially_validated bigint,not_observed bigint,not_evaluable bigint,hit_rate numeric,mitigated bigint)
language sql stable security invoker set search_path='' as $$
 with scoped as (
   select o.confirmed_verdict from public.finding_outcomes o join public.findings f on f.id=o.finding_id and f.organization_id=o.organization_id
   where o.organization_id=p_organization_id and o.confirmed_verdict is not null
     and public.is_job_scope_reconciled(o.organization_id,o.job_id) and (p_category is null or f.category=p_category)
 ), counts as (
   select count(*) total,
     count(*) filter(where confirmed_verdict in ('validated','partially_validated','not_observed')) evaluable,
     count(*) filter(where confirmed_verdict='validated') validated,
     count(*) filter(where confirmed_verdict='partially_validated') partially_validated,
     count(*) filter(where confirmed_verdict='not_observed') not_observed,
     count(*) filter(where confirmed_verdict='not_evaluable') not_evaluable,
     count(*) filter(where confirmed_verdict='mitigated') mitigated from scoped
 ) select total,evaluable,validated,partially_validated,not_observed,not_evaluable,
   case when evaluable=0 then null else (validated::numeric+partially_validated::numeric*0.5)/evaluable::numeric end,mitigated from counts;
$$;
revoke all on function public.get_warning_calibration(uuid,text) from public,anon;
grant execute on function public.get_warning_calibration(uuid,text) to authenticated;

-- Preserve responses when a preflight rerun supersedes reopened work.
alter table public.findings drop constraint findings_status_check;
alter table public.findings add constraint findings_status_check check(status in ('open','resolved','dismissed','superseded'));
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
  -- Reopened warnings with a human response remain auditable when rerun work replaces them.
  update public.findings f set status='superseded'
  where f.organization_id=p_organization_id and f.estimate_id=p_estimate_id and f.status='open'
    and exists(select 1 from public.finding_responses r where r.organization_id=f.organization_id and r.finding_id=f.id);
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

create function public.guard_superseded_finding() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.status='superseded' and new.status<>old.status then raise exception 'superseded finding is historical; respond to the current preflight'; end if;
 return new;
end; $$;
create trigger superseded_finding before update on public.findings for each row execute function public.guard_superseded_finding();
