-- A scope reconciliation is usable evidence only when the importer recorded a
-- specific attestation that the actual-cost export was final and complete.
-- Existing reviews without that fact remain readable but are conservatively
-- excluded from automated comparisons until they are re-imported explicitly.
create or replace function public.is_job_scope_reconciled(p_organization_id uuid,p_job_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.job_scope_reviews where organization_id=p_organization_id
    and job_id=p_job_id and review->>'status' in ('no_changes','adjusted')
    and review->>'actualCompleteness'='confirmed_complete');
$$;

create or replace function public.store_job_scope_review(p_org uuid,p_job uuid,p_review jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare c jsonb; k text; n numeric;
begin
 if not public.is_org_member(p_org) then raise exception 'not authorized'; end if;
 if jsonb_typeof(p_review) is distinct from 'object' then raise exception 'invalid scope assessment'; end if;
 if not (p_review ? 'actualCompleteness') then
   if p_review->>'status'='unreconciled' then p_review:=p_review||'{"actualCompleteness":"unknown"}'::jsonb;
   else raise exception 'final actual-cost completeness confirmation required'; end if;
 end if;
 if p_review - array['status','changes','actualCompleteness'] <> '{}'::jsonb
   or coalesce(p_review->>'status','') not in ('unreconciled','no_changes','adjusted')
   or coalesce(p_review->>'actualCompleteness','') not in ('confirmed_complete','unknown')
   or (p_review->>'status'<>'unreconciled' and p_review->>'actualCompleteness'<>'confirmed_complete')
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

create function public.actual_category_coverage_complete(p_estimate_lines jsonb,p_actual_lines jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
 with expected as (
   select category from jsonb_to_recordset(coalesce(p_estimate_lines,'[]'))
     as e(category text,estimated_cost numeric,estimated_hours numeric)
   group by category having coalesce(sum(estimated_cost),0)<>0 or coalesce(sum(estimated_hours),0)<>0
 ), represented as (
   select distinct category from jsonb_to_recordset(coalesce(p_actual_lines,'[]'))
     as a(category text,actual_cost numeric,actual_hours numeric)
 )
 select not exists(select 1 from expected e where not exists(select 1 from represented a where a.category=e.category));
$$;
revoke all on function public.actual_category_coverage_complete(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.create_completed_job(p_job jsonb,p_estimate_lines jsonb,p_actual_lines jsonb,p_variances jsonb,p_lessons jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_coverage_complete boolean; v_review jsonb:=coalesce(p_job->'scope_review','{"status":"unreconciled","changes":[],"actualCompleteness":"unknown"}'::jsonb);
begin
 if not public.is_org_member((p_job->>'organization_id')::uuid) then raise exception 'not authorized'; end if;
 if v_review->>'status'='unreconciled' and jsonb_array_length(coalesce(p_lessons,'[]'))>0 then raise exception 'reconcile scope before proposing lessons'; end if;
 v_coverage_complete:=public.actual_category_coverage_complete(p_estimate_lines,p_actual_lines);
 if v_review->>'status' in ('no_changes','adjusted') and not v_coverage_complete then raise exception 'actuals are missing expected categories'; end if;
 if not v_coverage_complete then v_review:=v_review||'{"actualCompleteness":"unknown"}'::jsonb; end if;
 v_id:=public.create_completed_job_before_scope(p_job,p_estimate_lines,p_actual_lines,p_variances,p_lessons);
 perform public.store_job_scope_review((p_job->>'organization_id')::uuid,v_id,v_review);
 return v_id;
end; $$;

create or replace function public.closeout_estimate_with_actuals(
 p_organization_id uuid,p_estimate_id uuid,p_actual_lines jsonb,p_lessons jsonb,p_outcomes jsonb,p_closeout_notes text,p_source_documents jsonb,
 p_scope_review jsonb default '{"status":"unreconciled","changes":[],"actualCompleteness":"unknown"}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_existing uuid; v_job uuid; v_estimate_lines jsonb; v_coverage_complete boolean;
begin
 if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
 perform 1 from public.estimates where id=p_estimate_id and organization_id=p_organization_id for update;
 select id into v_existing from public.jobs where organization_id=p_organization_id and source_estimate_id=p_estimate_id;
 if v_existing is null and p_scope_review->>'status' in ('no_changes','adjusted') then
   select coalesce(jsonb_agg(jsonb_build_object('category',category,'estimated_cost',estimated_cost,'estimated_hours',estimated_hours)),'[]') into v_estimate_lines
   from public.estimate_lines where organization_id=p_organization_id and estimate_id=p_estimate_id;
   if not public.actual_category_coverage_complete(v_estimate_lines,p_actual_lines) then raise exception 'actuals are missing expected categories'; end if;
 end if;
 if v_existing is null and p_scope_review->>'status'='unreconciled' then
   select coalesce(jsonb_agg(jsonb_build_object('category',category,'estimated_cost',estimated_cost,'estimated_hours',estimated_hours)),'[]') into v_estimate_lines
   from public.estimate_lines where organization_id=p_organization_id and estimate_id=p_estimate_id;
   v_coverage_complete:=public.actual_category_coverage_complete(v_estimate_lines,p_actual_lines);
   if not v_coverage_complete then p_scope_review:=p_scope_review||'{"actualCompleteness":"unknown"}'::jsonb; end if;
 end if;
 if v_existing is null and p_scope_review->>'status'='unreconciled' then
   if jsonb_array_length(coalesce(p_lessons,'[]'))>0 then raise exception 'reconcile scope before proposing lessons'; end if;
   select coalesce(jsonb_agg(o || jsonb_build_object('system_verdict','not_evaluable','confidence',0,
     'explanation','Scope is unreconciled; original budget differences cannot establish an estimating mistake.',
     'evidence_summary','Scope reconciliation is required.')),'[]') into p_outcomes from jsonb_array_elements(p_outcomes) o;
 end if;
 v_job:=public.closeout_estimate_before_scope(p_organization_id,p_estimate_id,p_actual_lines,p_lessons,p_outcomes,p_closeout_notes,p_source_documents);
 if v_existing is null then perform public.store_job_scope_review(p_organization_id,v_job,p_scope_review); end if;
 return v_job;
end; $$;
