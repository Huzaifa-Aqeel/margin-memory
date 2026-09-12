-- Demo fixtures are an explicit, tenant-scoped product action. Their core rows
-- commit atomically, their preflight is a recoverable leased step, and cleanup
-- can delete only rows whose durable origin is demo.

alter table public.estimates
  add column data_origin text not null default 'production'
    check(data_origin in('production','demo','synthetic_test'));

create function public.guard_estimate_data_origin() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.data_origin is distinct from old.data_origin
    and current_setting('margin_memory.demo_seed',true) is distinct from 'on' then
   raise exception 'estimate data origin is immutable';
 end if;
 return new;
end $$;
create trigger estimate_data_origin_immutable before update of data_origin on public.estimates
for each row execute function public.guard_estimate_data_origin();

create function public.propagate_demo_estimate_origin() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.parent_estimate_id is not null and exists(select 1 from public.estimates e where e.organization_id=new.organization_id and e.id=new.parent_estimate_id and e.data_origin<>'production') then
   select e.data_origin into new.data_origin from public.estimates e where e.organization_id=new.organization_id and e.id=new.parent_estimate_id;
 end if;
 return new;
end $$;
create trigger propagate_demo_estimate_origin before insert on public.estimates
for each row execute function public.propagate_demo_estimate_origin();

create function public.propagate_demo_job_origin() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.source_estimate_id is not null and exists(select 1 from public.estimates e where e.organization_id=new.organization_id and e.id=new.source_estimate_id and e.data_origin<>'production') then
   select e.data_origin into new.data_origin from public.estimates e where e.organization_id=new.organization_id and e.id=new.source_estimate_id;
 end if;
 return new;
end $$;
create trigger propagate_demo_job_origin before insert on public.jobs
for each row execute function public.propagate_demo_job_origin();

create or replace function public.guard_append_only() returns trigger language plpgsql set search_path='' as $$
declare allowed boolean:=false;
begin
 if tg_op='DELETE' and current_setting('margin_memory.demo_cleanup',true)='on' then
   if tg_table_name='job_scope_reviews' then allowed:=exists(select 1 from public.jobs j where j.organization_id=old.organization_id and j.id=old.job_id and j.data_origin<>'production');
   elsif tg_table_name in('submission_findings','finding_responses') then allowed:=exists(select 1 from public.estimates e where e.organization_id=old.organization_id and e.id=old.estimate_id and e.data_origin<>'production');
   elsif tg_table_name='investigation_evidence' then allowed:=exists(select 1 from public.investigations i join public.estimates e on e.organization_id=i.organization_id and e.id=i.estimate_id where i.organization_id=old.organization_id and i.id=old.investigation_id and e.data_origin<>'production');
   end if;
 end if;
 if allowed then return old;end if;
 raise exception 'append-only record is immutable';
end $$;

create table public.demo_seed_operations(
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 dataset_version text not null check(char_length(dataset_version) between 1 and 80),
 estimate_id uuid not null,
 status text not null check(status in('preflight_pending','preflight_running','preflight_failed','complete')),
 attempt integer not null default 0 check(attempt>=0),
 lease_token uuid,
 lease_expires_at timestamptz,
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz,
 foreign key(organization_id,estimate_id) references public.estimates(organization_id,id) on delete cascade,
 check((status='preflight_running')=(lease_expires_at is not null and lease_token is not null)),
 check((status='complete')=(completed_at is not null))
);
alter table public.demo_seed_operations enable row level security;
revoke all on public.demo_seed_operations from public,anon,authenticated;

create function public.seed_demo_workspace_server(
 p_organization_id uuid,p_actor_user_id uuid,p_dataset_version text,p_jobs jsonb,p_estimate jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.demo_seed_operations; item jsonb; v_estimate_id uuid; v_jobs integer:=0; v_lessons integer:=0;
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 if coalesce(jsonb_typeof(p_jobs),'')<>'array' or jsonb_array_length(p_jobs)=0 or jsonb_array_length(p_jobs)>20 then raise exception 'invalid demo jobs';end if;
 if coalesce(jsonb_typeof(p_estimate),'')<>'object' or coalesce(jsonb_typeof(p_estimate->'estimate'),'')<>'object' or coalesce(jsonb_typeof(p_estimate->'lines'),'')<>'array' then raise exception 'invalid demo estimate';end if;
 perform pg_advisory_xact_lock(hashtextextended('margin-memory-demo:'||p_organization_id::text,0));
 select * into existing from public.demo_seed_operations where organization_id=p_organization_id;
 if existing.organization_id is not null then
   if existing.dataset_version<>p_dataset_version then raise exception 'a different demo dataset already exists; reset it first';end if;
   return jsonb_build_object('estimateId',existing.estimate_id,'jobs',(select count(*) from public.jobs where organization_id=p_organization_id and data_origin='demo'),'lessons',(select count(*) from public.lessons l join public.jobs j on j.organization_id=l.organization_id and j.id=l.job_id where l.organization_id=p_organization_id and j.data_origin='demo'),'status',existing.status,'reused',true);
 end if;
 if exists(select 1 from public.jobs where organization_id=p_organization_id) or exists(select 1 from public.estimates where organization_id=p_organization_id) then raise exception 'demo data can only be loaded into an empty workspace; reset legacy demo rows separately';end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 for item in select value from jsonb_array_elements(p_jobs) loop
   if item->'job'->>'data_origin'<>'demo' or item->'job'->>'estimate_baseline_role'<>'historical_unknown' then raise exception 'invalid demo job trust identity';end if;
   perform public.create_completed_job_server(p_organization_id,p_actor_user_id,item->'job',item->'estimate_lines',item->'actual_lines',item->'variances',item->'lessons');
   v_jobs:=v_jobs+1;v_lessons:=v_lessons+jsonb_array_length(coalesce(item->'lessons','[]'));
 end loop;
 if p_estimate->'estimate'->>'data_origin'<>'demo' then raise exception 'invalid demo estimate origin';end if;
 v_estimate_id:=public.create_estimate_server(p_organization_id,p_actor_user_id,p_estimate->'estimate',p_estimate->'lines');
 perform set_config('margin_memory.demo_seed','on',true);
 update public.estimates set data_origin='demo' where organization_id=p_organization_id and id=v_estimate_id;
 insert into public.demo_seed_operations(organization_id,actor_user_id,dataset_version,estimate_id,status)
 values(p_organization_id,p_actor_user_id,p_dataset_version,v_estimate_id,'preflight_pending');
 return jsonb_build_object('estimateId',v_estimate_id,'jobs',v_jobs,'lessons',v_lessons,'status','preflight_pending','reused',false);
end $$;

create function public.claim_demo_preflight_server(p_organization_id uuid,p_actor_user_id uuid,p_dataset_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare operation public.demo_seed_operations; v_token uuid:=extensions.gen_random_uuid();
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 select * into operation from public.demo_seed_operations where organization_id=p_organization_id and dataset_version=p_dataset_version for update;
 if operation.organization_id is null then raise exception 'demo seed operation not found';end if;
 if operation.status='complete' then return jsonb_build_object('claimed',false,'status',operation.status,'estimateId',operation.estimate_id,'leaseToken',null);end if;
 if operation.status='preflight_running' and operation.lease_expires_at>now() then return jsonb_build_object('claimed',false,'status',operation.status,'estimateId',operation.estimate_id,'leaseToken',null);end if;
 update public.demo_seed_operations set status='preflight_running',attempt=attempt+1,lease_token=v_token,lease_expires_at=now()+interval '5 minutes',error=null,updated_at=now() where organization_id=p_organization_id;
 return jsonb_build_object('claimed',true,'status','preflight_running','estimateId',operation.estimate_id,'leaseToken',v_token);
end $$;

create function public.finish_demo_seed_server(p_organization_id uuid,p_actor_user_id uuid,p_dataset_version text,p_lease_token uuid,p_succeeded boolean,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare operation public.demo_seed_operations;
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 select * into operation from public.demo_seed_operations where organization_id=p_organization_id and dataset_version=p_dataset_version for update;
 if operation.organization_id is null then raise exception 'demo seed operation not found';end if;
 if operation.status='complete' then return jsonb_build_object('status','complete','estimateId',operation.estimate_id);end if;
 if operation.status<>'preflight_running' or operation.lease_token is distinct from p_lease_token or operation.lease_expires_at<=now() then raise exception 'demo preflight lease lost';end if;
 update public.demo_seed_operations set status=case when p_succeeded then 'complete' else 'preflight_failed' end,
   lease_token=null,lease_expires_at=null,error=case when p_succeeded then null else left(coalesce(p_error,'Preflight failed.'),1000) end,
   completed_at=case when p_succeeded then now() else null end,updated_at=now()
 where organization_id=p_organization_id;
 return jsonb_build_object('status',case when p_succeeded then 'complete' else 'preflight_failed' end,'estimateId',operation.estimate_id);
end $$;

create function public.reset_demo_workspace_server(p_organization_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job_count integer;estimate_count integer;
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 perform pg_advisory_xact_lock(hashtextextended('margin-memory-demo:'||p_organization_id::text,0));
 perform set_config('margin_memory.demo_cleanup','on',true);
 select count(*) into job_count from public.jobs where organization_id=p_organization_id and data_origin='demo';
 select count(*) into estimate_count from public.estimates where organization_id=p_organization_id and data_origin='demo';
 delete from public.demo_seed_operations where organization_id=p_organization_id;
 delete from public.finding_responses r using public.estimates e where r.organization_id=p_organization_id and r.organization_id=e.organization_id and r.estimate_id=e.id and e.data_origin='demo';
 delete from public.investigation_evidence evidence using public.investigations i,public.estimates e where evidence.organization_id=p_organization_id and evidence.organization_id=i.organization_id and evidence.investigation_id=i.id and i.organization_id=e.organization_id and i.estimate_id=e.id and e.data_origin='demo';
 delete from public.memory_reconciliation_runs r using public.jobs j where r.organization_id=p_organization_id and r.organization_id=j.organization_id and r.job_id=j.id and j.data_origin='demo';
 delete from public.job_scope_reviews r using public.jobs j where r.organization_id=p_organization_id and r.organization_id=j.organization_id and r.job_id=j.id and j.data_origin='demo';
 delete from public.estimates where organization_id=p_organization_id and data_origin='demo';
 delete from public.jobs where organization_id=p_organization_id and data_origin='demo';
 return jsonb_build_object('jobs',job_count,'estimates',estimate_count);
end $$;

revoke all on function public.seed_demo_workspace_server(uuid,uuid,text,jsonb,jsonb),public.claim_demo_preflight_server(uuid,uuid,text),public.finish_demo_seed_server(uuid,uuid,text,uuid,boolean,text),public.reset_demo_workspace_server(uuid,uuid) from public,anon,authenticated;
grant execute on function public.seed_demo_workspace_server(uuid,uuid,text,jsonb,jsonb),public.claim_demo_preflight_server(uuid,uuid,text),public.finish_demo_seed_server(uuid,uuid,text,uuid,boolean,text),public.reset_demo_workspace_server(uuid,uuid) to service_role;
