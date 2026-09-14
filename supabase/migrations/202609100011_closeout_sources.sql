-- Archive bytes first; attach their metadata in the same transaction as actuals.
-- The original implementation is retained as an internal helper, no longer a public write entry point.
alter function public.closeout_estimate_with_actuals(uuid,uuid,jsonb,jsonb,jsonb,text) rename to closeout_estimate_internal;
revoke all on function public.closeout_estimate_internal(uuid,uuid,jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role;
create function public.closeout_estimate_with_actuals(
 p_organization_id uuid,p_estimate_id uuid,p_actual_lines jsonb,p_lessons jsonb,p_outcomes jsonb,p_closeout_notes text,p_source_documents jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_job uuid; v_source jsonb; v_path text; v_expected jsonb; v_supplied jsonb;
begin
 if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
 perform 1 from public.estimates where id=p_estimate_id and organization_id=p_organization_id for update;
 select id into v_job from public.jobs where organization_id=p_organization_id and source_estimate_id=p_estimate_id;
 -- A committed retry cannot replace files, actuals, notes or source metadata.
 if v_job is not null then
  if exists(select 1 from public.documents where job_id=v_job and organization_id=p_organization_id and kind='actuals') or coalesce(jsonb_array_length(p_source_documents),0)=0 then return v_job; end if;
  -- Restore an earlier missing archive only when the parsed file matches every
  -- canonical actual-cost line, including hours. Never overwrite job facts.
  select jsonb_agg(jsonb_build_array(category,description,actual_cost,actual_hours) order by category,description,actual_cost,actual_hours) into v_expected
   from public.job_actual_lines where job_id=v_job and organization_id=p_organization_id;
  select jsonb_agg(jsonb_build_array(category,description,actual_cost,actual_hours) order by category,description,actual_cost,actual_hours) into v_supplied
   from jsonb_to_recordset(p_actual_lines) as x(category text,description text,actual_cost numeric,actual_hours numeric);
  if v_expected is distinct from v_supplied then raise exception 'restored actuals must match the saved cost lines'; end if;
 else
  v_job:=public.closeout_estimate_internal(p_organization_id,p_estimate_id,p_actual_lines,p_lessons,p_outcomes,p_closeout_notes);
 end if;
 if jsonb_typeof(p_source_documents) is distinct from 'array' then raise exception 'closeout source documents are required'; end if;
 if (select count(*) from jsonb_array_elements(p_source_documents) s where s->>'kind'='actuals')<>1
 or jsonb_array_length(p_source_documents)>2 then raise exception 'one archived actuals file is required'; end if;
 for v_source in select value from jsonb_array_elements(p_source_documents) loop
  v_path:=v_source->>'storage_path';
  if v_source->>'kind' not in ('actuals','notes') or v_source->>'kind' is null
   or coalesce(v_source->>'file_name','')='' or coalesce((v_source->>'size_bytes')::bigint,0)<=0 then raise exception 'invalid source metadata'; end if;
  if v_path is null or v_path not like p_organization_id::text||'/'||p_estimate_id::text||'/closeout/%'
   or not exists(select 1 from storage.objects where bucket_id='job-files' and name=v_path)
   or exists(select 1 from public.documents where storage_path=v_path) then raise exception 'source must be a new tenant-owned archived upload'; end if;
  insert into public.documents(organization_id,job_id,kind,file_name,storage_path,mime_type,size_bytes,extracted_text)
  values(p_organization_id,v_job,v_source->>'kind',v_source->>'file_name',v_path,v_source->>'mime_type',(v_source->>'size_bytes')::bigint,coalesce(v_source->>'extracted_text',''));
 end loop;
 return v_job;
end;
$$;
revoke all on function public.closeout_estimate_with_actuals(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb) from public,anon;
grant execute on function public.closeout_estimate_with_actuals(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb) to authenticated;

-- Persistent readiness is derived from durable evidence, not the last HTTP response.
create function public.get_memory_readiness(p_organization_id uuid,p_job_id uuid default null)
returns table(pending_jobs bigint,pending_lessons bigint,missing_closeout_files bigint)
language sql stable security invoker set search_path='' as $$
 select
 (select count(*) from public.jobs j where j.organization_id=p_organization_id and (p_job_id is null or j.id=p_job_id)
  and not exists(select 1 from public.job_search_documents d where d.job_id=j.id and d.organization_id=j.organization_id and d.embedding is not null)),
 (select count(*) from public.lessons l where l.organization_id=p_organization_id and (p_job_id is null or l.job_id=p_job_id) and l.status='confirmed' and l.embedding is null),
 (select count(*) from public.jobs j where j.organization_id=p_organization_id and (p_job_id is null or j.id=p_job_id) and j.source_estimate_id is not null
  and not exists(select 1 from public.documents d where d.job_id=j.id and d.organization_id=j.organization_id and d.kind='actuals'));
$$;
revoke all on function public.get_memory_readiness(uuid,uuid) from public,anon;
grant execute on function public.get_memory_readiness(uuid,uuid) to authenticated;
