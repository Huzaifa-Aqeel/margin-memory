-- Scope assessments are separate, append-only facts. Existing bids, actuals,
-- variances, warnings and lessons are never backfilled or rewritten.
create table public.job_scope_reviews (
  job_id uuid primary key,
  organization_id uuid not null,
  review jsonb not null,
  reviewed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id,job_id) references public.jobs(organization_id,id) on delete restrict
);
alter table public.job_scope_reviews enable row level security;
create policy scope_review_read on public.job_scope_reviews for select to authenticated
  using (public.is_org_member(organization_id));
revoke all on public.job_scope_reviews from public,anon,authenticated;
grant select on public.job_scope_reviews to authenticated,service_role;
create trigger scope_review_immutable before update or delete on public.job_scope_reviews
  for each row execute function public.guard_append_only();

create function public.is_job_scope_reconciled(p_organization_id uuid,p_job_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.job_scope_reviews where organization_id=p_organization_id
    and job_id=p_job_id and review->>'status' in ('no_changes','adjusted'));
$$;
revoke all on function public.is_job_scope_reconciled(uuid,uuid) from public,anon;
grant execute on function public.is_job_scope_reconciled(uuid,uuid) to authenticated,service_role;

-- Canonical adjusted comparison. The original job_variances remains unchanged.
create view public.job_scope_variances with (security_invoker=true) as
with changes as (
 select r.organization_id,r.job_id,c.category,sum(c."estimatedCost") cost,sum(c."estimatedHours") hours,
   sum(c."actualCost") actual_cost,sum(c."actualHours") actual_hours
 from public.job_scope_reviews r cross join lateral jsonb_to_recordset(r.review->'changes')
   as c(category text,"estimatedCost" numeric,"estimatedHours" numeric,"actualCost" numeric,"actualHours" numeric)
 group by r.organization_id,r.job_id,c.category
), amounts as (
 select coalesce(v.organization_id,c.organization_id) organization_id,coalesce(v.job_id,c.job_id) job_id,
   coalesce(v.category,c.category) category,
   coalesce(v.estimated_cost,0)+coalesce(c.cost,0) estimated_cost,coalesce(v.actual_cost,0) actual_cost,
   coalesce(v.estimated_hours,0)+coalesce(c.hours,0) estimated_hours,coalesce(v.actual_hours,0) actual_hours,
   coalesce(v.actual_cost,0)-coalesce(c.actual_cost,0) original_scope_actual_cost,
   coalesce(v.actual_hours,0)-coalesce(c.actual_hours,0) original_scope_actual_hours
 from public.job_variances v full join changes c on (v.organization_id,v.job_id,v.category)=(c.organization_id,c.job_id,c.category)
)
select *,actual_cost-estimated_cost cost_delta,actual_hours-estimated_hours hours_delta,
 case when estimated_cost>0 then (actual_cost-estimated_cost)/estimated_cost when actual_cost>0 then 1 else null end cost_delta_pct,
 case when estimated_hours>0 then (actual_hours-estimated_hours)/estimated_hours when actual_hours>0 then 1 else null end hours_delta_pct
from amounts where public.is_job_scope_reconciled(organization_id,job_id);
revoke all on public.job_scope_variances from public,anon,authenticated;
grant select on public.job_scope_variances to authenticated,service_role;

-- Called only inside the existing privileged import transactions. SECURITY INVOKER
-- inherits their role; no browser or service-role caller can invoke this helper.
create function public.store_job_scope_review(p_org uuid,p_job uuid,p_review jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare c jsonb; k text; n numeric;
begin
 if not public.is_org_member(p_org) then raise exception 'not authorized'; end if;
 if jsonb_typeof(p_review) is distinct from 'object'
   or p_review - array['status','changes'] <> '{}'::jsonb
   or coalesce(p_review->>'status','') not in ('unreconciled','no_changes','adjusted')
   or jsonb_typeof(p_review->'changes') is distinct from 'array' then raise exception 'invalid scope assessment'; end if;
 if (p_review->>'status'='adjusted' and jsonb_array_length(p_review->'changes') not between 1 and 100)
   or (p_review->>'status'<>'adjusted' and jsonb_array_length(p_review->'changes')<>0) then raise exception 'invalid scope changes'; end if;
 for c in select value from jsonb_array_elements(p_review->'changes') loop
   if jsonb_typeof(c) is distinct from 'object'
     or c - array['reference','description','category','estimatedCost','estimatedHours','actualCost','actualHours'] <> '{}'::jsonb
     or jsonb_typeof(c->'reference') is distinct from 'string' or length(btrim(c->>'reference')) not between 1 and 200
     or jsonb_typeof(c->'description') is distinct from 'string' or length(btrim(c->>'description')) not between 1 and 1000
     or coalesce(c->>'category','') not in ('labor','materials','equipment','subcontractor','permit','other') then raise exception 'invalid scope change reference or category'; end if;
   foreach k in array array['estimatedCost','estimatedHours','actualCost','actualHours'] loop
     if jsonb_typeof(c->k) is distinct from 'number' then raise exception 'scope amounts must be numbers'; end if;
     n:=(c->>k)::numeric;
     if abs(n)>1000000000000 or round(n,2)<>n or (k in ('actualCost','actualHours') and n<0) then raise exception 'invalid scope amount'; end if;
   end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_review->'changes') scope_entry
   group by lower(btrim(scope_entry.value->>'reference')),scope_entry.value->>'category' having count(*)>1) then raise exception 'duplicate scope reference and category'; end if;
 insert into public.job_scope_reviews(job_id,organization_id,review,reviewed_by)
 values(p_job,p_org,p_review,(select auth.uid()));
 if exists(select 1 from public.job_scope_variances where organization_id=p_org and job_id=p_job
   and (estimated_cost<0 or estimated_hours<0 or original_scope_actual_cost<0 or original_scope_actual_hours<0)) then
   raise exception 'scope allocation exceeds original budget or final actuals';
 end if;
end; $$;
revoke all on function public.store_job_scope_review(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

alter function public.create_completed_job(jsonb,jsonb,jsonb,jsonb,jsonb) rename to create_completed_job_before_scope;
revoke all on function public.create_completed_job_before_scope(jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.create_completed_job(p_job jsonb,p_estimate_lines jsonb,p_actual_lines jsonb,p_variances jsonb,p_lessons jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_review jsonb:=coalesce(p_job->'scope_review','{"status":"unreconciled","changes":[]}'::jsonb);
begin
 if not public.is_org_member((p_job->>'organization_id')::uuid) then raise exception 'not authorized'; end if;
 if v_review->>'status'='unreconciled' and jsonb_array_length(coalesce(p_lessons,'[]'))>0 then raise exception 'reconcile scope before proposing lessons'; end if;
 v_id:=public.create_completed_job_before_scope(p_job,p_estimate_lines,p_actual_lines,p_variances,p_lessons);
 perform public.store_job_scope_review((p_job->>'organization_id')::uuid,v_id,v_review);
 return v_id;
end; $$;
revoke all on function public.create_completed_job(jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.create_completed_job(jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

alter function public.closeout_estimate_with_actuals(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb) rename to closeout_estimate_before_scope;
revoke all on function public.closeout_estimate_before_scope(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb) from public,anon,authenticated,service_role;
create function public.closeout_estimate_with_actuals(
 p_organization_id uuid,p_estimate_id uuid,p_actual_lines jsonb,p_lessons jsonb,p_outcomes jsonb,p_closeout_notes text,p_source_documents jsonb,
 p_scope_review jsonb default '{"status":"unreconciled","changes":[]}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_existing uuid; v_job uuid;
begin
 if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
 perform 1 from public.estimates where id=p_estimate_id and organization_id=p_organization_id for update;
 select id into v_existing from public.jobs where organization_id=p_organization_id and source_estimate_id=p_estimate_id;
 if v_existing is null and p_scope_review->>'status'='unreconciled' then
   if jsonb_array_length(coalesce(p_lessons,'[]'))>0 then raise exception 'reconcile scope before proposing lessons'; end if;
   select coalesce(jsonb_agg(o || jsonb_build_object('system_verdict','not_evaluable','confidence',0,
     'explanation','Scope is unreconciled; original budget differences cannot establish an estimating mistake.',
     'evidence_summary','Scope reconciliation is required.')),'[]') into p_outcomes from jsonb_array_elements(p_outcomes) o;
 end if;
 -- Existing archival retry/restoration behavior remains the owner of source files.
 v_job:=public.closeout_estimate_before_scope(p_organization_id,p_estimate_id,p_actual_lines,p_lessons,p_outcomes,p_closeout_notes,p_source_documents);
 if v_existing is null then perform public.store_job_scope_review(p_organization_id,v_job,p_scope_review); end if;
 return v_job;
end; $$;
revoke all on function public.closeout_estimate_with_actuals(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) from public,anon;
grant execute on function public.closeout_estimate_with_actuals(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) to authenticated;

-- Old confirmed lessons are preserved but cannot enter future automatic evidence
-- without a reconciled source. New confirmation of unknown-scope lessons is blocked.
create function public.guard_scope_lesson_confirmation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status='confirmed' and old.status is distinct from new.status
   and not public.is_job_scope_reconciled(new.organization_id,new.job_id) then raise exception 'reconcile scope before confirming lessons'; end if;
 return new;
end; $$;
create trigger scope_lesson_confirmation before update on public.lessons for each row execute function public.guard_scope_lesson_confirmation();

create function public.guard_scope_evidence() returns trigger language plpgsql security invoker set search_path='' as $$
declare j uuid; ids jsonb;
begin
 if new.kind in ('search','inspection','calculation') then
   ids:=case new.kind when 'search' then new.result->'jobIds' when 'inspection' then jsonb_build_array(new.result->>'jobId') else new.result->'comparableJobIds' end;
   for j in select value::uuid from jsonb_array_elements_text(ids) loop
     if not public.is_job_scope_reconciled(new.organization_id,j) then raise exception 'job scope is unreconciled'; end if;
   end loop;
 elsif new.kind='missing_categories' then
   for j in select id::uuid from jsonb_array_elements(new.result) r cross join lateral jsonb_array_elements_text(r->'jobIds') id loop
     if not public.is_job_scope_reconciled(new.organization_id,j) then raise exception 'job scope is unreconciled'; end if;
   end loop;
 end if;
 return new;
end; $$;
create trigger scope_evidence before insert on public.investigation_evidence for each row execute function public.guard_scope_evidence();

-- Filter before ranking/limiting so ineligible vectors cannot crowd out valid results.
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
    and public.is_job_scope_reconciled(l.organization_id,l.job_id)
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
    and public.is_job_scope_reconciled(j.organization_id,j.id)
    and (p_project_type is null or lower(j.project_type) = lower(p_project_type))
    and (p_customer_type is null or lower(j.customer_type) = lower(p_customer_type))
    and 1 - (d.embedding OPERATOR(extensions.<=>) query_embedding) >= match_threshold
  order by d.embedding OPERATOR(extensions.<=>) query_embedding
  limit least(match_count, 20);
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
      and public.is_job_scope_reconciled(o.organization_id,o.job_id)
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

drop function public.get_memory_readiness(uuid,uuid);
create function public.get_memory_readiness(p_organization_id uuid,p_job_id uuid default null)
returns table(pending_jobs bigint,pending_lessons bigint,missing_closeout_files bigint,unreconciled_jobs bigint)
language sql stable security invoker set search_path='' as $$
 select
 (select count(*) from public.jobs j where j.organization_id=p_organization_id and (p_job_id is null or j.id=p_job_id)
  and public.is_job_scope_reconciled(j.organization_id,j.id)
  and not exists(select 1 from public.job_search_documents d where d.job_id=j.id and d.organization_id=j.organization_id and d.embedding is not null)),
 (select count(*) from public.lessons l where l.organization_id=p_organization_id and (p_job_id is null or l.job_id=p_job_id) and l.status='confirmed' and l.embedding is null and public.is_job_scope_reconciled(l.organization_id,l.job_id)),
 (select count(*) from public.jobs j where j.organization_id=p_organization_id and (p_job_id is null or j.id=p_job_id) and j.source_estimate_id is not null
  and not exists(select 1 from public.documents d where d.job_id=j.id and d.organization_id=j.organization_id and d.kind='actuals')),
 (select count(*) from public.jobs j where j.organization_id=p_organization_id and (p_job_id is null or j.id=p_job_id) and not public.is_job_scope_reconciled(j.organization_id,j.id));
$$;
revoke all on function public.get_memory_readiness(uuid,uuid) from public,anon;
grant execute on function public.get_memory_readiness(uuid,uuid) to authenticated;
