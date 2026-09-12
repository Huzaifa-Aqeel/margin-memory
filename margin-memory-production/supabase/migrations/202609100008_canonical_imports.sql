-- Imports are narrow SECURITY DEFINER transactions because imported facts are append-only.
-- Membership is checked before any write; totals and variance are recomputed from normalized lines.
revoke insert on public.estimates,public.estimate_lines,public.job_estimate_lines,public.job_actual_lines,public.job_variances from authenticated;
create or replace function public.create_estimate_with_lines(p_estimate jsonb, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid := (p_estimate->>'id')::uuid; r jsonb;
begin
  if not public.is_org_member((p_estimate->>'organization_id')::uuid) then raise exception 'not authorized'; end if;
  if jsonb_array_length(coalesce(p_lines,'[]'))=0 then raise exception 'estimate lines required'; end if;
  p_estimate:=p_estimate || jsonb_build_object('status','draft','investigation_status','queued','estimated_total',(select coalesce(sum((x->>'estimated_cost')::numeric),0) from jsonb_array_elements(p_lines) x),'estimated_labor_hours',(select coalesce(sum((x->>'estimated_hours')::numeric),0) from jsonb_array_elements(p_lines) x));
  insert into public.estimates(id,organization_id,created_by,name,project_type,customer_type,location,bid_due,tags,assumptions,estimated_total,estimated_labor_hours,status,investigation_status,created_at)
  values(v_id,(p_estimate->>'organization_id')::uuid,(select auth.uid()),p_estimate->>'name',p_estimate->>'project_type',coalesce(p_estimate->>'customer_type','Commercial'),coalesce(p_estimate->>'location',''),nullif(p_estimate->>'bid_due','')::date,
    coalesce(array(select jsonb_array_elements_text(p_estimate->'tags')),'{}'),coalesce(array(select jsonb_array_elements_text(p_estimate->'assumptions')),'{}'),coalesce((p_estimate->>'estimated_total')::numeric,0),coalesce((p_estimate->>'estimated_labor_hours')::numeric,0),coalesce(p_estimate->>'status','draft'),coalesce(p_estimate->>'investigation_status','queued'),coalesce((p_estimate->>'created_at')::timestamptz,now()));
  for r in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    insert into public.estimate_lines(id,organization_id,estimate_id,category,description,quantity,unit,estimated_hours,estimated_cost)
    values((r->>'id')::uuid,(p_estimate->>'organization_id')::uuid,v_id,r->>'category',r->>'description',nullif(r->>'quantity','')::numeric,nullif(r->>'unit',''),nullif(r->>'estimated_hours','')::numeric,coalesce((r->>'estimated_cost')::numeric,0));
  end loop;
  return v_id;
end;
$$;

create or replace function public.create_completed_job(p_job jsonb,p_estimate_lines jsonb,p_actual_lines jsonb,p_variances jsonb,p_lessons jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid := (p_job->>'id')::uuid; r jsonb;
begin
  if not public.is_org_member((p_job->>'organization_id')::uuid) then raise exception 'not authorized'; end if;
  if jsonb_array_length(coalesce(p_estimate_lines,'[]'))=0 or jsonb_array_length(coalesce(p_actual_lines,'[]'))=0 then raise exception 'estimate and actual lines required'; end if;
  p_job:=p_job || jsonb_build_object('estimated_total',(select coalesce(sum((x->>'estimated_cost')::numeric),0) from jsonb_array_elements(p_estimate_lines) x),'actual_total',(select coalesce(sum((x->>'actual_cost')::numeric),0) from jsonb_array_elements(p_actual_lines) x));
  insert into public.jobs(id,organization_id,created_by,name,project_type,customer_type,location,completed_at,tags,notes,estimated_total,actual_total,gross_margin_pct,created_at)
  values(v_id,(p_job->>'organization_id')::uuid,(select auth.uid()),p_job->>'name',p_job->>'project_type',coalesce(p_job->>'customer_type','Commercial'),coalesce(p_job->>'location',''),(p_job->>'completed_at')::date,coalesce(array(select jsonb_array_elements_text(p_job->'tags')),'{}'),coalesce(p_job->>'notes',''),coalesce((p_job->>'estimated_total')::numeric,0),coalesce((p_job->>'actual_total')::numeric,0),nullif(p_job->>'gross_margin_pct','')::numeric,coalesce((p_job->>'created_at')::timestamptz,now()));
  for r in select value from jsonb_array_elements(coalesce(p_estimate_lines,'[]'::jsonb)) loop
    insert into public.job_estimate_lines(id,organization_id,job_id,category,description,quantity,unit,estimated_hours,estimated_cost)
    values((r->>'id')::uuid,(p_job->>'organization_id')::uuid,v_id,r->>'category',r->>'description',nullif(r->>'quantity','')::numeric,nullif(r->>'unit',''),nullif(r->>'estimated_hours','')::numeric,coalesce((r->>'estimated_cost')::numeric,0));
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_actual_lines,'[]'::jsonb)) loop
    insert into public.job_actual_lines(id,organization_id,job_id,category,description,actual_hours,actual_cost)
    values((r->>'id')::uuid,(p_job->>'organization_id')::uuid,v_id,r->>'category',r->>'description',nullif(r->>'actual_hours','')::numeric,coalesce((r->>'actual_cost')::numeric,0));
  end loop;
  with est as(select category,sum(estimated_cost) cost,coalesce(sum(estimated_hours),0) hours from public.job_estimate_lines where job_id=v_id group by category),
  act as(select category,sum(actual_cost) cost,coalesce(sum(actual_hours),0) hours from public.job_actual_lines where job_id=v_id group by category)
  insert into public.job_variances(organization_id,job_id,category,estimated_cost,actual_cost,estimated_hours,actual_hours,cost_delta,cost_delta_pct,hours_delta,hours_delta_pct)
  select (p_job->>'organization_id')::uuid,v_id,coalesce(e.category,a.category),coalesce(e.cost,0),coalesce(a.cost,0),coalesce(e.hours,0),coalesce(a.hours,0),coalesce(a.cost,0)-coalesce(e.cost,0),
   case when coalesce(e.cost,0)<>0 then (coalesce(a.cost,0)-e.cost)/e.cost when coalesce(a.cost,0)>0 then 1 else null end,
   coalesce(a.hours,0)-coalesce(e.hours,0),
   case when coalesce(e.hours,0)<>0 then (coalesce(a.hours,0)-e.hours)/e.hours when coalesce(a.hours,0)>0 then 1 else null end
  from est e full join act a on a.category=e.category;
  for r in select value from jsonb_array_elements(coalesce(p_lessons,'[]'::jsonb)) loop
    insert into public.lessons(id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status,created_at)
    values((r->>'id')::uuid,(p_job->>'organization_id')::uuid,v_id,r->>'title',r->>'category',r->>'lesson',r->>'cause',r->>'impact_summary',coalesce((r->>'confidence')::numeric,0.5),coalesce(r->>'status','pending'),coalesce((r->>'created_at')::timestamptz,now()));
  end loop;
  return v_id;
end;
$$;

revoke execute on function public.create_estimate_with_lines(jsonb,jsonb) from public,anon;
revoke execute on function public.create_completed_job(jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.create_estimate_with_lines(jsonb,jsonb) to authenticated;
grant execute on function public.create_completed_job(jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

-- Freeze confirmed historical lesson text; only explicit human status decisions and index maintenance are writable.
revoke update on public.lessons from authenticated;
grant update(status,embedding,updated_at) on public.lessons to authenticated;
create function public.guard_learning_lesson() returns trigger language plpgsql security definer set search_path='' as $$
declare v_job uuid; v_stage text;
begin
 if tg_op='DELETE' then v_job:=old.job_id;else v_job:=new.job_id;end if;
 select e.lifecycle_status into v_stage from public.jobs j join public.estimates e on e.id=j.source_estimate_id where j.id=v_job for update of e;
 if v_stage='learned' and (tg_op<>'UPDATE' or new.status is distinct from old.status) then raise exception 'completed learning is immutable'; end if;
 if tg_op='DELETE' then return old;else return new;end if;
end; $$;
create trigger learning_lesson_guard before insert or update or delete on public.lessons for each row execute function public.guard_learning_lesson();
revoke delete on public.lessons from authenticated;
