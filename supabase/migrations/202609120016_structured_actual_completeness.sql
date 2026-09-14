-- Preserve import structure needed to prove that final actuals cover the bid.
-- These are source dimensions, not new financial facts.
alter table public.estimate_lines add column cost_code text, add column phase text, add column division text;
alter table public.job_estimate_lines add column cost_code text, add column phase text, add column division text;
alter table public.job_actual_lines add column cost_code text, add column phase text, add column division text;

-- A category remains expected when it has a detail transaction, even when
-- positive and negative values net to zero. An explicit actual zero row counts
-- as represented; an absent actual category does not.
create or replace function public.actual_category_coverage_complete(p_estimate_lines jsonb,p_actual_lines jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
 with expected as (
   select distinct category from jsonb_to_recordset(coalesce(p_estimate_lines,'[]'))
     as e(category text,estimated_cost numeric,estimated_hours numeric,quantity numeric)
   where nullif(btrim(category),'') is not null
 ), represented as (
   select distinct category from jsonb_to_recordset(coalesce(p_actual_lines,'[]'))
     as a(category text,actual_cost numeric,actual_hours numeric)
   where nullif(btrim(category),'') is not null
 )
 select not exists(select 1 from expected e where not exists(select 1 from represented a where a.category=e.category));
$$;
revoke all on function public.actual_category_coverage_complete(jsonb,jsonb) from public,anon,authenticated,service_role;

-- Structured dimensions are enforced only when the estimate exposes them. If
-- the actual export omits that structure entirely, coverage is incomplete.
create function public.actual_structural_coverage_complete(p_estimate_lines jsonb,p_actual_lines jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
 with expected as (
   select nullif(lower(btrim(cost_code)),'') cost_code,
          nullif(lower(btrim(phase)),'') phase,
          nullif(lower(btrim(division)),'') division
   from jsonb_to_recordset(coalesce(p_estimate_lines,'[]'))
     as e(cost_code text,phase text,division text)
 ), represented as (
   select nullif(lower(btrim(cost_code)),'') cost_code,
          nullif(lower(btrim(phase)),'') phase,
          nullif(lower(btrim(division)),'') division
   from jsonb_to_recordset(coalesce(p_actual_lines,'[]'))
     as a(cost_code text,phase text,division text)
 )
 select not exists(
   select 1 from expected e where
     (e.cost_code is not null and not exists(select 1 from represented a where a.cost_code=e.cost_code)) or
     (e.phase is not null and not exists(select 1 from represented a where a.phase=e.phase)) or
     (e.division is not null and not exists(select 1 from represented a where a.division=e.division))
 );
$$;
revoke all on function public.actual_structural_coverage_complete(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.create_estimate_with_lines(p_estimate jsonb,p_lines jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=(p_estimate->>'id')::uuid; r jsonb;
begin
 if not public.is_org_member((p_estimate->>'organization_id')::uuid) then raise exception 'not authorized'; end if;
 if jsonb_array_length(coalesce(p_lines,'[]'))=0 then raise exception 'estimate lines required'; end if;
 p_estimate:=p_estimate||jsonb_build_object(
   'status','draft','investigation_status','queued',
   'estimated_total',(select coalesce(sum((x->>'estimated_cost')::numeric),0) from jsonb_array_elements(p_lines) x),
   'estimated_labor_hours',(select coalesce(sum((x->>'estimated_hours')::numeric),0) from jsonb_array_elements(p_lines) x));
 insert into public.estimates(id,organization_id,created_by,name,project_type,customer_type,location,bid_due,tags,assumptions,estimated_total,estimated_labor_hours,status,investigation_status,created_at)
 values(v_id,(p_estimate->>'organization_id')::uuid,(select auth.uid()),p_estimate->>'name',p_estimate->>'project_type',coalesce(p_estimate->>'customer_type','Commercial'),coalesce(p_estimate->>'location',''),nullif(p_estimate->>'bid_due','')::date,
   coalesce(array(select jsonb_array_elements_text(p_estimate->'tags')),'{}'),coalesce(array(select jsonb_array_elements_text(p_estimate->'assumptions')),'{}'),coalesce((p_estimate->>'estimated_total')::numeric,0),coalesce((p_estimate->>'estimated_labor_hours')::numeric,0),coalesce(p_estimate->>'status','draft'),coalesce(p_estimate->>'investigation_status','queued'),coalesce((p_estimate->>'created_at')::timestamptz,now()));
 for r in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
   insert into public.estimate_lines(id,organization_id,estimate_id,category,description,quantity,unit,cost_code,phase,division,estimated_hours,estimated_cost)
   values((r->>'id')::uuid,(p_estimate->>'organization_id')::uuid,v_id,r->>'category',r->>'description',nullif(r->>'quantity','')::numeric,nullif(r->>'unit',''),nullif(r->>'cost_code',''),nullif(r->>'phase',''),nullif(r->>'division',''),nullif(r->>'estimated_hours','')::numeric,coalesce((r->>'estimated_cost')::numeric,0));
 end loop;
 return v_id;
end; $$;

create or replace function public.create_completed_job(p_job jsonb,p_estimate_lines jsonb,p_actual_lines jsonb,p_variances jsonb,p_lessons jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_category_complete boolean; v_structural_complete boolean; v_review jsonb:=coalesce(p_job->'scope_review','{"status":"unreconciled","changes":[],"actualCompleteness":"unknown"}'::jsonb); r jsonb;
begin
 if not public.is_org_member((p_job->>'organization_id')::uuid) then raise exception 'not authorized'; end if;
 if v_review->>'status'='unreconciled' and jsonb_array_length(coalesce(p_lessons,'[]'))>0 then raise exception 'reconcile scope before proposing lessons'; end if;
 v_category_complete:=public.actual_category_coverage_complete(p_estimate_lines,p_actual_lines);
 v_structural_complete:=public.actual_structural_coverage_complete(p_estimate_lines,p_actual_lines);
 if v_review->>'status' in ('no_changes','adjusted') and not v_category_complete then raise exception 'actuals are missing expected categories'; end if;
 if v_review->>'status' in ('no_changes','adjusted') and not v_structural_complete then raise exception 'actuals have incomplete structured coverage'; end if;
 if not v_category_complete or not v_structural_complete then v_review:=v_review||'{"actualCompleteness":"unknown"}'::jsonb; end if;
 v_id:=public.create_completed_job_before_scope(p_job,p_estimate_lines,p_actual_lines,p_variances,p_lessons);
 delete from public.job_estimate_lines where organization_id=(p_job->>'organization_id')::uuid and job_id=v_id;
 for r in select value from jsonb_array_elements(coalesce(p_estimate_lines,'[]'::jsonb)) loop
   insert into public.job_estimate_lines(id,organization_id,job_id,category,description,quantity,unit,cost_code,phase,division,estimated_hours,estimated_cost)
   values((r->>'id')::uuid,(p_job->>'organization_id')::uuid,v_id,r->>'category',r->>'description',nullif(r->>'quantity','')::numeric,nullif(r->>'unit',''),nullif(r->>'cost_code',''),nullif(r->>'phase',''),nullif(r->>'division',''),nullif(r->>'estimated_hours','')::numeric,coalesce((r->>'estimated_cost')::numeric,0));
 end loop;
 delete from public.job_actual_lines where organization_id=(p_job->>'organization_id')::uuid and job_id=v_id;
 for r in select value from jsonb_array_elements(coalesce(p_actual_lines,'[]'::jsonb)) loop
   insert into public.job_actual_lines(id,organization_id,job_id,category,description,cost_code,phase,division,actual_hours,actual_cost)
   values((r->>'id')::uuid,(p_job->>'organization_id')::uuid,v_id,r->>'category',r->>'description',nullif(r->>'cost_code',''),nullif(r->>'phase',''),nullif(r->>'division',''),nullif(r->>'actual_hours','')::numeric,coalesce((r->>'actual_cost')::numeric,0));
 end loop;
 perform public.store_job_scope_review((p_job->>'organization_id')::uuid,v_id,v_review);
 return v_id;
end; $$;

create or replace function public.closeout_estimate_with_actuals(
 p_organization_id uuid,p_estimate_id uuid,p_actual_lines jsonb,p_lessons jsonb,p_outcomes jsonb,p_closeout_notes text,p_source_documents jsonb,
 p_scope_review jsonb default '{"status":"unreconciled","changes":[],"actualCompleteness":"unknown"}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_existing uuid; v_job uuid; v_estimate_lines jsonb; v_category_complete boolean; v_structural_complete boolean; r jsonb;
begin
 if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
 perform 1 from public.estimates where id=p_estimate_id and organization_id=p_organization_id for update;
 select id into v_existing from public.jobs where organization_id=p_organization_id and source_estimate_id=p_estimate_id;
 if v_existing is null then
   select coalesce(jsonb_agg(jsonb_build_object('category',category,'estimated_cost',estimated_cost,'estimated_hours',estimated_hours,'quantity',quantity,'cost_code',cost_code,'phase',phase,'division',division)),'[]') into v_estimate_lines
   from public.estimate_lines where organization_id=p_organization_id and estimate_id=p_estimate_id;
   v_category_complete:=public.actual_category_coverage_complete(v_estimate_lines,p_actual_lines);
   v_structural_complete:=public.actual_structural_coverage_complete(v_estimate_lines,p_actual_lines);
   if p_scope_review->>'status' in ('no_changes','adjusted') and not v_category_complete then raise exception 'actuals are missing expected categories'; end if;
   if p_scope_review->>'status' in ('no_changes','adjusted') and not v_structural_complete then raise exception 'actuals have incomplete structured coverage'; end if;
   if not v_category_complete or not v_structural_complete then p_scope_review:=p_scope_review||'{"actualCompleteness":"unknown"}'::jsonb; end if;
   if p_scope_review->>'status'='unreconciled' then
     if jsonb_array_length(coalesce(p_lessons,'[]'))>0 then raise exception 'reconcile scope before proposing lessons'; end if;
     select coalesce(jsonb_agg(o||jsonb_build_object('system_verdict','not_evaluable','confidence',0,
       'explanation','Scope is unreconciled; original budget differences cannot establish an estimating mistake.',
       'evidence_summary','Scope reconciliation is required.')),'[]') into p_outcomes from jsonb_array_elements(p_outcomes) o;
   end if;
 end if;
 v_job:=public.closeout_estimate_before_scope(p_organization_id,p_estimate_id,p_actual_lines,p_lessons,p_outcomes,p_closeout_notes,p_source_documents);
 if v_existing is null then
   delete from public.job_estimate_lines where organization_id=p_organization_id and job_id=v_job;
   insert into public.job_estimate_lines(id,organization_id,job_id,category,description,quantity,unit,cost_code,phase,division,estimated_hours,estimated_cost)
   select extensions.gen_random_uuid(),organization_id,v_job,category,description,quantity,unit,cost_code,phase,division,estimated_hours,estimated_cost
   from public.estimate_lines where organization_id=p_organization_id and estimate_id=p_estimate_id;
   delete from public.job_actual_lines where organization_id=p_organization_id and job_id=v_job;
   for r in select value from jsonb_array_elements(coalesce(p_actual_lines,'[]'::jsonb)) loop
     insert into public.job_actual_lines(id,organization_id,job_id,category,description,cost_code,phase,division,actual_hours,actual_cost)
     values(coalesce(nullif(r->>'id','')::uuid,extensions.gen_random_uuid()),p_organization_id,v_job,r->>'category',coalesce(nullif(btrim(r->>'description'),''),r->>'category'),nullif(r->>'cost_code',''),nullif(r->>'phase',''),nullif(r->>'division',''),nullif(r->>'actual_hours','')::numeric,coalesce(nullif(r->>'actual_cost','')::numeric,0));
   end loop;
   perform public.store_job_scope_review(p_organization_id,v_job,p_scope_review);
 end if;
 return v_job;
end; $$;
