create or replace function public.create_estimate_with_lines(p_estimate jsonb, p_lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_id uuid := (p_estimate->>'id')::uuid; r jsonb;
begin
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
security invoker
set search_path = ''
as $$
declare v_id uuid := (p_job->>'id')::uuid; r jsonb;
begin
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
  for r in select value from jsonb_array_elements(coalesce(p_variances,'[]'::jsonb)) loop
    insert into public.job_variances(organization_id,job_id,category,estimated_cost,actual_cost,estimated_hours,actual_hours,cost_delta,cost_delta_pct,hours_delta,hours_delta_pct)
    values((p_job->>'organization_id')::uuid,v_id,r->>'category',coalesce((r->>'estimated_cost')::numeric,0),coalesce((r->>'actual_cost')::numeric,0),coalesce((r->>'estimated_hours')::numeric,0),coalesce((r->>'actual_hours')::numeric,0),coalesce((r->>'cost_delta')::numeric,0),nullif(r->>'cost_delta_pct','')::numeric,coalesce((r->>'hours_delta')::numeric,0),nullif(r->>'hours_delta_pct','')::numeric);
  end loop;
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
