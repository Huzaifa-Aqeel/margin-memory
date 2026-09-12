-- Trusted company memory is derived data. Browser clients can read business
-- records, but only service-role workers may change trust state or vectors.

alter table public.jobs
  add column data_origin text not null default 'production'
    check(data_origin in('production','demo','synthetic_test')),
  add column memory_status text not null default 'trusted'
    check(memory_status in('trusted','quarantined')),
  add column memory_quarantine_reason text,
  add column memory_quarantined_at timestamptz,
  add column memory_quarantined_by uuid references auth.users(id),
  add constraint job_memory_quarantine_shape check(
    (memory_status='trusted' and memory_quarantine_reason is null and memory_quarantined_at is null and memory_quarantined_by is null)
    or
    (memory_status='quarantined' and length(btrim(memory_quarantine_reason)) between 1 and 1000 and memory_quarantined_at is not null and memory_quarantined_by is not null)
  );

-- A job created from the closed-loop estimate lifecycle always compares to the
-- immutable submitted snapshot. Preserve that authority even for legacy RPC callers.
update public.jobs set estimate_baseline_role='final_submitted' where source_estimate_id is not null and estimate_baseline_role is null;
create function public.assign_closeout_memory_baseline() returns trigger language plpgsql set search_path='' as $$
begin
 if new.source_estimate_id is not null and new.estimate_baseline_role is null then new.estimate_baseline_role:='final_submitted';end if;
 return new;
end $$;
create trigger assign_closeout_memory_baseline before insert on public.jobs for each row execute function public.assign_closeout_memory_baseline();

alter table public.job_search_documents
  add column source_content_hash text check(source_content_hash~'^[0-9a-f]{64}$'),
  add column content_version text,
  add column embedding_space_id uuid,
  add column embedding_provider text,
  add column embedding_model text,
  add column embedding_dimensions integer check(embedding_dimensions=1536),
  add column indexed_at timestamptz,
  add constraint job_memory_space_fk foreign key(embedding_space_id) references public.embedding_spaces(organization_id);

alter table public.lessons
  add column source_content_hash text check(source_content_hash~'^[0-9a-f]{64}$'),
  add column content_version text,
  add column embedding_space_id uuid,
  add column embedding_provider text,
  add column embedding_model text,
  add column embedding_dimensions integer check(embedding_dimensions=1536),
  add column indexed_at timestamptz,
  add constraint lesson_memory_space_fk foreign key(embedding_space_id) references public.embedding_spaces(organization_id);
alter table public.lessons add constraint lessons_org_id_unique unique(organization_id,id);

create table public.memory_index_jobs(
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type text not null check(source_type in('job','lesson')),
  job_id uuid,
  lesson_id uuid,
  desired_content text not null,
  desired_content_hash text not null check(desired_content_hash~'^[0-9a-f]{64}$'),
  content_version text not null,
  embedding_space_id uuid not null references public.embedding_spaces(organization_id),
  embedding_provider text not null,
  embedding_model text not null,
  embedding_dimensions integer not null check(embedding_dimensions=1536),
  status text not null default 'pending' check(status in('pending','processing','indexed','failed','disabled')),
  attempt_count integer not null default 0 check(attempt_count>=0),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  next_attempt_at timestamptz,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((source_type='job' and job_id is not null and lesson_id is null) or (source_type='lesson' and lesson_id is not null and job_id is null)),
  foreign key(organization_id,job_id) references public.jobs(organization_id,id) on delete cascade,
  foreign key(organization_id,lesson_id) references public.lessons(organization_id,id) on delete cascade
);
create unique index memory_index_jobs_job_unique on public.memory_index_jobs(organization_id,job_id) where source_type='job';
create unique index memory_index_jobs_lesson_unique on public.memory_index_jobs(organization_id,lesson_id) where source_type='lesson';
create index memory_index_jobs_claim_idx on public.memory_index_jobs(organization_id,status,next_attempt_at,created_at);
create index job_memory_lookup_idx on public.job_search_documents(organization_id,embedding_space_id,job_id) where embedding is not null;
create index lesson_memory_lookup_idx on public.lessons(organization_id,status,embedding_space_id,id) where embedding is not null;

create table public.memory_reconciliation_runs(
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  job_id uuid,
  added integer not null default 0,
  refreshed integer not null default 0,
  removed integer not null default 0,
  verified integer not null default 0,
  failed integer not null default 0,
  completed_at timestamptz not null default now(),
  foreign key(organization_id,job_id) references public.jobs(organization_id,id)
);
create index memory_reconciliation_org_time_idx on public.memory_reconciliation_runs(organization_id,completed_at desc);

alter table public.memory_index_jobs enable row level security;
alter table public.memory_reconciliation_runs enable row level security;
revoke all on public.memory_index_jobs,public.memory_reconciliation_runs from public,anon,authenticated;
grant select,insert,update,delete on public.memory_index_jobs,public.memory_reconciliation_runs to service_role;

create function public.ensure_embedding_space_server(p_organization_id uuid,p_actor_user_id uuid,p_provider text,p_model text,p_dimensions integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 if p_provider is distinct from 'bedrock' or p_model is null or p_model not in('cohere.embed-v4:0','amazon.titan-embed-text-v1') or p_dimensions is distinct from 1536 then raise exception 'unsupported embedding space';end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 insert into public.embedding_spaces(organization_id,provider,model,dimensions) values(p_organization_id,p_provider,p_model,p_dimensions) on conflict do nothing;
 if not exists(select 1 from public.embedding_spaces where organization_id=p_organization_id and provider=p_provider and model=p_model and dimensions=p_dimensions) then raise exception 'embedding model mismatch: explicitly reindex before changing model';end if;
end $$;
create function public.assert_embedding_space(p_organization_id uuid,p_provider text,p_model text,p_dimensions integer)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_org_member(p_organization_id) then raise exception 'not authorized';end if;
 if not exists(select 1 from public.embedding_spaces where organization_id=p_organization_id and provider=p_provider and model=p_model and dimensions=p_dimensions) then raise exception 'embedding space is not configured for this model';end if;
end $$;
revoke all on function public.ensure_embedding_space(uuid,text,text,integer) from public,anon,authenticated;

create function public.is_job_eligible_for_trusted_memory(p_organization_id uuid,p_job_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.jobs j
    where j.organization_id=p_organization_id and j.id=p_job_id
      and public.is_job_scope_reconciled(j.organization_id,j.id)
      and j.estimate_baseline_role in('original_bid','final_submitted')
      and j.data_origin='production'
      and j.memory_status='trusted'
  );
$$;

create function public.is_lesson_eligible_for_trusted_memory(p_organization_id uuid,p_lesson_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.lessons l
    where l.organization_id=p_organization_id and l.id=p_lesson_id and l.status='confirmed'
      and public.is_job_eligible_for_trusted_memory(l.organization_id,l.job_id)
  );
$$;
revoke all on function public.is_job_eligible_for_trusted_memory(uuid,uuid),public.is_lesson_eligible_for_trusted_memory(uuid,uuid) from public,anon,authenticated;
grant execute on function public.is_job_eligible_for_trusted_memory(uuid,uuid),public.is_lesson_eligible_for_trusted_memory(uuid,uuid) to service_role;

-- Existing vectors have no provable source/model identity. Fail closed until reconciled.
update public.job_search_documents set embedding=null;
update public.lessons set embedding=null;

create function public.invalidate_job_memory() returns trigger language plpgsql set search_path='' as $$
begin
  update public.job_search_documents set embedding=null,source_content_hash=null,content_version=null,
    embedding_space_id=null,embedding_provider=null,embedding_model=null,embedding_dimensions=null,indexed_at=null,updated_at=now()
    where organization_id=coalesce(new.organization_id,old.organization_id) and job_id=coalesce(new.id,old.id);
  update public.memory_index_jobs set status='pending',lease_token=null,lease_expires_at=null,indexed_at=null,
    next_attempt_at=null,updated_at=now() where organization_id=coalesce(new.organization_id,old.organization_id)
    and (job_id=coalesce(new.id,old.id) or lesson_id in(select id from public.lessons where job_id=coalesce(new.id,old.id)));
  return coalesce(new,old);
end $$;
create trigger invalidate_job_memory_on_source_change after update of project_type,customer_type,completed_at,tags,notes,estimated_total,actual_total,estimate_baseline_role,data_origin,memory_status on public.jobs
  for each row execute function public.invalidate_job_memory();

create function public.invalidate_job_line_memory() returns trigger language plpgsql set search_path='' as $$
begin
  update public.job_search_documents set embedding=null,source_content_hash=null,content_version=null,
    embedding_space_id=null,embedding_provider=null,embedding_model=null,embedding_dimensions=null,indexed_at=null,updated_at=now()
    where organization_id=coalesce(new.organization_id,old.organization_id) and job_id=coalesce(new.job_id,old.job_id);
  update public.memory_index_jobs set status='pending',lease_token=null,lease_expires_at=null,indexed_at=null,next_attempt_at=null,updated_at=now()
    where organization_id=coalesce(new.organization_id,old.organization_id) and job_id=coalesce(new.job_id,old.job_id);
  return coalesce(new,old);
end $$;
create trigger invalidate_job_memory_on_estimate_line after insert or update or delete on public.job_estimate_lines for each row execute function public.invalidate_job_line_memory();
create trigger invalidate_job_memory_on_actual_line after insert or update or delete on public.job_actual_lines for each row execute function public.invalidate_job_line_memory();
create trigger invalidate_job_memory_on_variance after insert or update or delete on public.job_variances for each row execute function public.invalidate_job_line_memory();
create trigger invalidate_job_memory_on_scope after insert or update or delete on public.job_scope_reviews for each row execute function public.invalidate_job_line_memory();

create function public.invalidate_lesson_memory() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.title,new.category,new.lesson,new.cause,new.impact_summary,new.status) is distinct from
     (old.title,old.category,old.lesson,old.cause,old.impact_summary,old.status) then
    new.embedding:=null;new.source_content_hash:=null;new.content_version:=null;new.embedding_space_id:=null;
    new.embedding_provider:=null;new.embedding_model:=null;new.embedding_dimensions:=null;new.indexed_at:=null;
    update public.memory_index_jobs set status=case when new.status='confirmed' then 'pending' else 'disabled' end,
      lease_token=null,lease_expires_at=null,indexed_at=null,next_attempt_at=null,updated_at=now()
      where organization_id=new.organization_id and lesson_id=new.id;
  end if;
  return new;
end $$;
create trigger invalidate_lesson_memory_on_source_change before update on public.lessons for each row execute function public.invalidate_lesson_memory();

create function public.set_lesson_status_server(p_organization_id uuid,p_actor_user_id uuid,p_lesson_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare l public.lessons;
begin
  if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
  if p_status not in('confirmed','rejected') then raise exception 'invalid lesson status';end if;
  select * into l from public.lessons where organization_id=p_organization_id and id=p_lesson_id for update;
  if l.id is null then raise exception 'lesson not found';end if;
  if l.status=p_status then return;end if;
  if l.status<>'pending' then raise exception 'lesson decision is final';end if;
  if p_status='confirmed' and not public.is_job_eligible_for_trusted_memory(p_organization_id,l.job_id) then raise exception 'source job is not eligible for trusted memory';end if;
  update public.lessons set status=p_status,updated_at=now() where id=p_lesson_id;
  if p_status='rejected' then
    update public.memory_index_jobs set status='disabled',lease_token=null,lease_expires_at=null,updated_at=now() where lesson_id=p_lesson_id;
  end if;
end $$;

create function public.quarantine_job_memory_server(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
  if length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'quarantine reason is required';end if;
  update public.jobs set memory_status='quarantined',memory_quarantine_reason=btrim(p_reason),memory_quarantined_at=now(),memory_quarantined_by=p_actor_user_id
    where organization_id=p_organization_id and id=p_job_id and memory_status='trusted';
  if not found and not exists(select 1 from public.jobs where organization_id=p_organization_id and id=p_job_id and memory_status='quarantined') then raise exception 'job not found';end if;
  delete from public.job_search_documents where organization_id=p_organization_id and job_id=p_job_id;
  update public.lessons set embedding=null,source_content_hash=null,content_version=null,embedding_space_id=null,
    embedding_provider=null,embedding_model=null,embedding_dimensions=null,indexed_at=null where organization_id=p_organization_id and job_id=p_job_id;
  update public.memory_index_jobs set status='disabled',lease_token=null,lease_expires_at=null,indexed_at=null,updated_at=now()
    where organization_id=p_organization_id and (job_id=p_job_id or lesson_id in(select id from public.lessons where job_id=p_job_id));
end $$;

create function public.revise_lesson_server(p_organization_id uuid,p_actor_user_id uuid,p_lesson_id uuid,p_title text,p_lesson text,p_cause text,p_impact_summary text)
returns void language plpgsql security definer set search_path='' as $$
declare l public.lessons; v_stage text;
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 if least(length(btrim(coalesce(p_title,''))),length(btrim(coalesce(p_lesson,''))),length(btrim(coalesce(p_cause,''))),length(btrim(coalesce(p_impact_summary,''))))<1 then raise exception 'lesson fields are required';end if;
 select * into l from public.lessons where organization_id=p_organization_id and id=p_lesson_id for update;
 if l.id is null then raise exception 'lesson not found';end if;
 select e.lifecycle_status into v_stage from public.jobs j join public.estimates e on e.id=j.source_estimate_id and e.organization_id=j.organization_id where j.id=l.job_id;
 if v_stage='learned' then raise exception 'completed learning is immutable';end if;
 update public.lessons set title=btrim(p_title),lesson=btrim(p_lesson),cause=btrim(p_cause),impact_summary=btrim(p_impact_summary),status='pending',updated_at=now() where id=p_lesson_id;
end $$;

create function public.enqueue_memory_index_job(
 p_organization_id uuid,p_actor_user_id uuid,p_source_type text,p_source_id uuid,p_content text,p_content_hash text,
 p_content_version text,p_provider text,p_model text,p_dimensions integer
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_current boolean; v_space public.embedding_spaces;
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 if p_source_type not in('job','lesson') or length(btrim(p_content))<10 or p_content_hash<>encode(extensions.digest(p_content,'sha256'),'hex')
   or (p_source_type='job' and p_content_version<>'job-memory-v2') or (p_source_type='lesson' and p_content_version<>'lesson-memory-v2') then raise exception 'invalid memory content';end if;
 select * into v_space from public.embedding_spaces where organization_id=p_organization_id;
 if v_space.organization_id is null or (v_space.provider,v_space.model,v_space.dimensions) is distinct from (p_provider,p_model,p_dimensions) then raise exception 'embedding space mismatch';end if;
 if p_source_type='job' then
   if not public.is_job_eligible_for_trusted_memory(p_organization_id,p_source_id) then raise exception 'job is not eligible for trusted memory';end if;
   insert into public.job_search_documents(organization_id,job_id,content,source_content_hash,content_version,updated_at)
    values(p_organization_id,p_source_id,p_content,p_content_hash,p_content_version,now())
    on conflict(job_id) do update set content=excluded.content,source_content_hash=excluded.source_content_hash,content_version=excluded.content_version,
      embedding=case when public.job_search_documents.source_content_hash=excluded.source_content_hash and public.job_search_documents.content_version=excluded.content_version then public.job_search_documents.embedding else null end,
      indexed_at=case when public.job_search_documents.source_content_hash=excluded.source_content_hash and public.job_search_documents.content_version=excluded.content_version then public.job_search_documents.indexed_at else null end,updated_at=now();
   select embedding is not null and source_content_hash=p_content_hash and content_version=p_content_version and embedding_space_id=p_organization_id
     into v_current from public.job_search_documents where organization_id=p_organization_id and job_id=p_source_id;
   insert into public.memory_index_jobs(organization_id,source_type,job_id,desired_content,desired_content_hash,content_version,embedding_space_id,embedding_provider,embedding_model,embedding_dimensions,status,indexed_at)
    values(p_organization_id,'job',p_source_id,p_content,p_content_hash,p_content_version,p_organization_id,p_provider,p_model,p_dimensions,case when v_current then 'indexed' else 'pending' end,case when v_current then now() end)
    on conflict(organization_id,job_id) where source_type='job' do update set desired_content=excluded.desired_content,desired_content_hash=excluded.desired_content_hash,content_version=excluded.content_version,
      embedding_space_id=excluded.embedding_space_id,embedding_provider=excluded.embedding_provider,embedding_model=excluded.embedding_model,embedding_dimensions=excluded.embedding_dimensions,
      status=case when public.memory_index_jobs.status='indexed' and public.memory_index_jobs.desired_content_hash=excluded.desired_content_hash then 'indexed'
        when public.memory_index_jobs.status='failed' and public.memory_index_jobs.desired_content_hash=excluded.desired_content_hash and public.memory_index_jobs.next_attempt_at>now() then 'failed' else 'pending' end,
      lease_token=null,lease_expires_at=null,last_error=case when public.memory_index_jobs.desired_content_hash=excluded.desired_content_hash then public.memory_index_jobs.last_error end,
      next_attempt_at=case when public.memory_index_jobs.status='failed' and public.memory_index_jobs.desired_content_hash=excluded.desired_content_hash then public.memory_index_jobs.next_attempt_at end,updated_at=now() returning id into v_id;
 else
   if not public.is_lesson_eligible_for_trusted_memory(p_organization_id,p_source_id) then raise exception 'lesson is not eligible for trusted memory';end if;
   update public.lessons set source_content_hash=p_content_hash,content_version=p_content_version where organization_id=p_organization_id and id=p_source_id;
   select embedding is not null and source_content_hash=p_content_hash and content_version=p_content_version and embedding_space_id=p_organization_id
     into v_current from public.lessons where organization_id=p_organization_id and id=p_source_id;
   insert into public.memory_index_jobs(organization_id,source_type,lesson_id,desired_content,desired_content_hash,content_version,embedding_space_id,embedding_provider,embedding_model,embedding_dimensions,status,indexed_at)
    values(p_organization_id,'lesson',p_source_id,p_content,p_content_hash,p_content_version,p_organization_id,p_provider,p_model,p_dimensions,case when v_current then 'indexed' else 'pending' end,case when v_current then now() end)
    on conflict(organization_id,lesson_id) where source_type='lesson' do update set desired_content=excluded.desired_content,desired_content_hash=excluded.desired_content_hash,content_version=excluded.content_version,
      embedding_space_id=excluded.embedding_space_id,embedding_provider=excluded.embedding_provider,embedding_model=excluded.embedding_model,embedding_dimensions=excluded.embedding_dimensions,
      status=case when public.memory_index_jobs.status='indexed' and public.memory_index_jobs.desired_content_hash=excluded.desired_content_hash then 'indexed'
        when public.memory_index_jobs.status='failed' and public.memory_index_jobs.desired_content_hash=excluded.desired_content_hash and public.memory_index_jobs.next_attempt_at>now() then 'failed' else 'pending' end,
      lease_token=null,lease_expires_at=null,last_error=case when public.memory_index_jobs.desired_content_hash=excluded.desired_content_hash then public.memory_index_jobs.last_error end,
      next_attempt_at=case when public.memory_index_jobs.status='failed' and public.memory_index_jobs.desired_content_hash=excluded.desired_content_hash then public.memory_index_jobs.next_attempt_at end,updated_at=now() returning id into v_id;
 end if;
 return v_id;
end $$;

create function public.claim_memory_index_jobs(p_organization_id uuid,p_actor_user_id uuid,p_worker_id uuid,p_limit integer default 20)
returns table(id uuid,source_type text,source_id uuid,desired_content text,desired_content_hash text,content_version text,embedding_provider text,embedding_model text,embedding_dimensions integer,lease_token uuid)
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 -- Disable anything whose relational source lost eligibility before claiming work.
 update public.memory_index_jobs q set status='disabled',lease_token=null,lease_expires_at=null,updated_at=now()
 where q.organization_id=p_organization_id and q.status<>'disabled' and
  ((q.source_type='job' and not public.is_job_eligible_for_trusted_memory(q.organization_id,q.job_id)) or
   (q.source_type='lesson' and not public.is_lesson_eligible_for_trusted_memory(q.organization_id,q.lesson_id)));
 delete from public.job_search_documents d where d.organization_id=p_organization_id and not public.is_job_eligible_for_trusted_memory(d.organization_id,d.job_id);
 update public.lessons l set embedding=null,source_content_hash=null,content_version=null,embedding_space_id=null,embedding_provider=null,embedding_model=null,embedding_dimensions=null,indexed_at=null
  where l.organization_id=p_organization_id and l.embedding is not null and not public.is_lesson_eligible_for_trusted_memory(l.organization_id,l.id);
 return query with candidates as(
   select q.id from public.memory_index_jobs q where q.organization_id=p_organization_id
    and (q.status in('pending','failed') and coalesce(q.next_attempt_at,now())<=now() or q.status='processing' and q.lease_expires_at<now())
    order by q.created_at for update skip locked limit least(greatest(p_limit,1),50)
 ), claimed as(
   update public.memory_index_jobs q set status='processing',attempt_count=q.attempt_count+1,lease_token=extensions.gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',updated_at=now()
   from candidates c where q.id=c.id returning q.*
 ) select c.id,c.source_type,coalesce(c.job_id,c.lesson_id),c.desired_content,c.desired_content_hash,c.content_version,c.embedding_provider,c.embedding_model,c.embedding_dimensions,c.lease_token from claimed c;
end $$;

create function public.complete_memory_index_job(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_lease_token uuid,p_content_hash text,p_embedding extensions.vector(1536))
returns void language plpgsql security definer set search_path='' as $$
declare q public.memory_index_jobs; s public.embedding_spaces;
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 select * into q from public.memory_index_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if q.id is null or q.status<>'processing' or q.lease_token<>p_lease_token or q.desired_content_hash<>p_content_hash then raise exception 'stale memory worker';end if;
 select * into s from public.embedding_spaces where organization_id=p_organization_id;
 if (s.provider,s.model,s.dimensions) is distinct from(q.embedding_provider,q.embedding_model,q.embedding_dimensions) then raise exception 'embedding space mismatch';end if;
 if extensions.vector_dims(p_embedding)<>q.embedding_dimensions or extensions.vector_norm(p_embedding)<=0.000000001 then raise exception 'invalid embedding vector';end if;
 if q.source_type='job' then
   if not public.is_job_eligible_for_trusted_memory(p_organization_id,q.job_id) then raise exception 'job is not eligible for trusted memory';end if;
   update public.job_search_documents set embedding=p_embedding,embedding_space_id=p_organization_id,embedding_provider=q.embedding_provider,embedding_model=q.embedding_model,
    embedding_dimensions=q.embedding_dimensions,indexed_at=now(),updated_at=now() where organization_id=p_organization_id and job_id=q.job_id and source_content_hash=q.desired_content_hash;
 else
   if not public.is_lesson_eligible_for_trusted_memory(p_organization_id,q.lesson_id) then raise exception 'lesson is not eligible for trusted memory';end if;
   update public.lessons set embedding=p_embedding,embedding_space_id=p_organization_id,embedding_provider=q.embedding_provider,embedding_model=q.embedding_model,
    embedding_dimensions=q.embedding_dimensions,indexed_at=now(),updated_at=now() where organization_id=p_organization_id and id=q.lesson_id and source_content_hash=q.desired_content_hash;
 end if;
 if not found then raise exception 'memory source changed during embedding';end if;
 update public.memory_index_jobs set status='indexed',indexed_at=now(),lease_token=null,lease_expires_at=null,last_error=null,next_attempt_at=null,updated_at=now() where id=q.id;
end $$;

create function public.fail_memory_index_job(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_lease_token uuid,p_error text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 update public.memory_index_jobs set status='failed',last_error=left(coalesce(p_error,'Embedding failed'),2000),next_attempt_at=now()+least(interval '1 hour',interval '15 seconds'*power(2,least(attempt_count,8))),lease_token=null,lease_expires_at=null,updated_at=now()
  where organization_id=p_organization_id and id=p_job_id and status='processing' and lease_token=p_lease_token;
 if not found then raise exception 'stale memory worker';end if;
end $$;

create function public.record_memory_reconciliation(p_organization_id uuid,p_actor_user_id uuid,p_job_id uuid,p_added integer,p_refreshed integer,p_removed integer,p_verified integer,p_failed integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 insert into public.memory_reconciliation_runs(organization_id,actor_user_id,job_id,added,refreshed,removed,verified,failed)
 values(p_organization_id,p_actor_user_id,p_job_id,p_added,p_refreshed,p_removed,p_verified,p_failed) returning id into v_id;return v_id;
end $$;

-- Trusted retrieval requires eligibility, current hash, active embedding space and nonzero vector.
create or replace function public.match_lessons(p_organization_id uuid,query_embedding extensions.vector(1536),match_threshold float default 0.25,match_count int default 8)
returns table(id uuid,job_id uuid,title text,category text,lesson text,cause text,impact_summary text,confidence numeric,similarity float)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_org_member(p_organization_id) then return;end if;
 return query select l.id,l.job_id,l.title,l.category,l.lesson,l.cause,l.impact_summary,l.confidence,
  1-(l.embedding OPERATOR(extensions.<=>) query_embedding)
 from public.lessons l join public.embedding_spaces s on s.organization_id=l.organization_id
 where l.organization_id=p_organization_id and public.is_lesson_eligible_for_trusted_memory(l.organization_id,l.id)
  and l.embedding is not null and l.source_content_hash is not null and l.content_version='lesson-memory-v2'
  and (l.embedding_provider,l.embedding_model,l.embedding_dimensions,l.embedding_space_id)=(s.provider,s.model,s.dimensions,s.organization_id)
  and extensions.vector_norm(l.embedding)>0.000000001
  and 1-(l.embedding OPERATOR(extensions.<=>) query_embedding)>=match_threshold
 order by l.embedding OPERATOR(extensions.<=>) query_embedding,l.id limit least(match_count,20);
end $$;

create or replace function public.match_jobs(p_organization_id uuid,query_embedding extensions.vector(1536),p_project_type text default null,p_customer_type text default null,match_threshold float default 0.18,match_count int default 10)
returns table(id uuid,name text,project_type text,customer_type text,tags text[],estimated_total numeric,actual_total numeric,similarity float)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_org_member(p_organization_id) then return;end if;
 return query select j.id,j.name,j.project_type,j.customer_type,j.tags,j.estimated_total,j.actual_total,
  1-(d.embedding OPERATOR(extensions.<=>) query_embedding)
 from public.job_search_documents d join public.jobs j on j.id=d.job_id and j.organization_id=d.organization_id
 join public.embedding_spaces s on s.organization_id=d.organization_id
 where d.organization_id=p_organization_id and public.is_job_eligible_for_trusted_memory(j.organization_id,j.id)
  and d.embedding is not null and d.source_content_hash is not null and d.content_version='job-memory-v2'
  and (d.embedding_provider,d.embedding_model,d.embedding_dimensions,d.embedding_space_id)=(s.provider,s.model,s.dimensions,s.organization_id)
  and extensions.vector_norm(d.embedding)>0.000000001
  and (p_project_type is null or lower(j.project_type)=lower(p_project_type))
  and (p_customer_type is null or lower(j.customer_type)=lower(p_customer_type))
  and 1-(d.embedding OPERATOR(extensions.<=>) query_embedding)>=match_threshold
 order by d.embedding OPERATOR(extensions.<=>) query_embedding,j.id limit least(match_count,20);
end $$;

create function public.match_trusted_jobs(p_organization_id uuid,query_embedding extensions.vector(1536),p_candidate_ids uuid[],match_threshold float default 0.12,match_count int default 10)
returns table(id uuid,name text,project_type text,customer_type text,tags text[],estimated_total numeric,actual_total numeric,similarity float)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_org_member(p_organization_id) then return;end if;
 return query select j.id,j.name,j.project_type,j.customer_type,j.tags,j.estimated_total,j.actual_total,
  1-(d.embedding OPERATOR(extensions.<=>) query_embedding)
 from unnest(p_candidate_ids) c(id)
 join public.job_search_documents d on d.organization_id=p_organization_id and d.job_id=c.id
 join public.jobs j on j.organization_id=d.organization_id and j.id=d.job_id
 join public.embedding_spaces s on s.organization_id=d.organization_id
 where public.is_job_eligible_for_trusted_memory(j.organization_id,j.id) and d.embedding is not null
  and d.source_content_hash is not null and d.content_version='job-memory-v2'
  and (d.embedding_provider,d.embedding_model,d.embedding_dimensions,d.embedding_space_id)=(s.provider,s.model,s.dimensions,s.organization_id)
  and extensions.vector_norm(d.embedding)>0.000000001
  and 1-(d.embedding OPERATOR(extensions.<=>) query_embedding)>=match_threshold
 order by d.embedding OPERATOR(extensions.<=>) query_embedding,j.id limit least(match_count,20);
end $$;

drop function public.get_memory_readiness(uuid,uuid);
create function public.get_memory_readiness(p_organization_id uuid,p_job_id uuid default null)
returns table(pending_jobs bigint,pending_lessons bigint,missing_closeout_files bigint,unreconciled_jobs bigint,eligible_jobs bigint,indexed_jobs bigint,confirmed_lessons bigint,indexed_lessons bigint,stale_items bigint,failed_items bigint,quarantined_jobs bigint,excluded_jobs bigint,active_provider text,active_model text,last_reconciled_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_org_member(p_organization_id) then return;end if;
 return query select
  count(*) filter(where public.is_job_eligible_for_trusted_memory(j.organization_id,j.id) and not exists(select 1 from public.job_search_documents d join public.embedding_spaces s on s.organization_id=d.organization_id where d.organization_id=j.organization_id and d.job_id=j.id and d.embedding is not null and d.source_content_hash is not null and d.content_version='job-memory-v2' and extensions.vector_norm(d.embedding)>0.000000001 and (d.embedding_provider,d.embedding_model,d.embedding_dimensions,d.embedding_space_id)=(s.provider,s.model,s.dimensions,s.organization_id)))::bigint,
  (select count(*) from public.lessons l where l.organization_id=p_organization_id and (p_job_id is null or l.job_id=p_job_id) and public.is_lesson_eligible_for_trusted_memory(l.organization_id,l.id) and not exists(select 1 from public.embedding_spaces s where s.organization_id=l.organization_id and l.embedding is not null and l.source_content_hash is not null and l.content_version='lesson-memory-v2' and extensions.vector_norm(l.embedding)>0.000000001 and (l.embedding_provider,l.embedding_model,l.embedding_dimensions,l.embedding_space_id)=(s.provider,s.model,s.dimensions,s.organization_id))),
  count(*) filter(where j.source_estimate_id is not null and not exists(select 1 from public.documents d where d.job_id=j.id and d.organization_id=j.organization_id and d.kind='actuals'))::bigint,
  count(*) filter(where not public.is_job_scope_reconciled(j.organization_id,j.id))::bigint,
  count(*) filter(where public.is_job_eligible_for_trusted_memory(j.organization_id,j.id))::bigint,
  count(*) filter(where public.is_job_eligible_for_trusted_memory(j.organization_id,j.id) and exists(select 1 from public.job_search_documents d join public.embedding_spaces s on s.organization_id=d.organization_id where d.organization_id=j.organization_id and d.job_id=j.id and d.embedding is not null and d.source_content_hash is not null and d.content_version='job-memory-v2' and extensions.vector_norm(d.embedding)>0.000000001 and (d.embedding_provider,d.embedding_model,d.embedding_dimensions,d.embedding_space_id)=(s.provider,s.model,s.dimensions,s.organization_id)))::bigint,
  (select count(*) from public.lessons l where l.organization_id=p_organization_id and (p_job_id is null or l.job_id=p_job_id) and public.is_lesson_eligible_for_trusted_memory(l.organization_id,l.id)),
  (select count(*) from public.lessons l join public.embedding_spaces s on s.organization_id=l.organization_id where l.organization_id=p_organization_id and (p_job_id is null or l.job_id=p_job_id) and public.is_lesson_eligible_for_trusted_memory(l.organization_id,l.id) and l.embedding is not null and l.source_content_hash is not null and l.content_version='lesson-memory-v2' and extensions.vector_norm(l.embedding)>0.000000001 and (l.embedding_provider,l.embedding_model,l.embedding_dimensions,l.embedding_space_id)=(s.provider,s.model,s.dimensions,s.organization_id)),
  (select count(*) from public.memory_index_jobs q where q.organization_id=p_organization_id and (p_job_id is null or q.job_id=p_job_id or q.lesson_id in(select id from public.lessons where job_id=p_job_id)) and q.status in('pending','processing')),
  (select count(*) from public.memory_index_jobs q where q.organization_id=p_organization_id and (p_job_id is null or q.job_id=p_job_id or q.lesson_id in(select id from public.lessons where job_id=p_job_id)) and q.status='failed'),
  count(*) filter(where j.memory_status='quarantined')::bigint,
  count(*) filter(where not public.is_job_eligible_for_trusted_memory(j.organization_id,j.id))::bigint,
  (select provider from public.embedding_spaces where organization_id=p_organization_id),
  (select model from public.embedding_spaces where organization_id=p_organization_id),
  (select max(completed_at) from public.memory_reconciliation_runs where organization_id=p_organization_id)
 from public.jobs j where j.organization_id=p_organization_id and (p_job_id is null or j.id=p_job_id);
end $$;

create or replace function public.get_warning_calibration(p_organization_id uuid,p_category text default null)
returns table(total bigint,evaluable bigint,validated bigint,partially_validated bigint,not_observed bigint,not_evaluable bigint,hit_rate numeric,mitigated bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_org_member(p_organization_id) then return;end if;
 return query with scoped as(
  select o.confirmed_verdict from public.finding_outcomes o join public.findings f on f.id=o.finding_id and f.organization_id=o.organization_id
  where o.organization_id=p_organization_id and o.confirmed_verdict is not null and public.is_job_eligible_for_trusted_memory(o.organization_id,o.job_id)
   and (p_category is null or f.category=p_category)
 ),counts as(select count(*)::bigint total,count(*)filter(where confirmed_verdict in('validated','partially_validated','not_observed'))::bigint evaluable,
  count(*)filter(where confirmed_verdict='validated')::bigint validated,count(*)filter(where confirmed_verdict='partially_validated')::bigint partially_validated,
  count(*)filter(where confirmed_verdict='not_observed')::bigint not_observed,count(*)filter(where confirmed_verdict='not_evaluable')::bigint not_evaluable,
  count(*)filter(where confirmed_verdict='mitigated')::bigint mitigated from scoped)
 select c.total,c.evaluable,c.validated,c.partially_validated,c.not_observed,c.not_evaluable,
  case when c.evaluable=0 then null else(c.validated::numeric+c.partially_validated::numeric*.5)/c.evaluable end,c.mitigated from counts c;
end $$;

-- Every job/lesson identifier placed in investigation evidence is checked at insertion time.
create or replace function public.guard_scope_evidence() returns trigger language plpgsql security invoker set search_path='' as $$
declare j uuid; l uuid; ids jsonb;
begin
 if new.kind in('search','inspection','calculation') then
   ids:=case new.kind when 'search' then coalesce(new.result->'jobIds','[]') when 'inspection' then jsonb_build_array(new.result->>'jobId') else new.result->'comparableJobIds' end;
   for j in select value::uuid from jsonb_array_elements_text(ids) loop
     if not public.is_job_eligible_for_trusted_memory(new.organization_id,j) then raise exception 'job is not eligible for trusted memory';end if;
   end loop;
   if new.kind='search' and new.tool_name='search_lessons' then
     for l in select value::uuid from jsonb_array_elements_text(coalesce(new.result->'lessonIds','[]')) loop
       if not public.is_lesson_eligible_for_trusted_memory(new.organization_id,l) then raise exception 'lesson is not eligible for trusted memory';end if;
     end loop;
   end if;
 elsif new.kind='missing_categories' then
   for j in select id::uuid from jsonb_array_elements(new.result) r cross join lateral jsonb_array_elements_text(r->'jobIds') id loop
     if not public.is_job_eligible_for_trusted_memory(new.organization_id,j) then raise exception 'job is not eligible for trusted memory';end if;
   end loop;
 end if;return new;
end $$;

create function public.guard_trusted_finding_job_evidence() returns trigger language plpgsql set search_path='' as $$
begin
 if not public.is_job_eligible_for_trusted_memory(new.organization_id,new.job_id) then raise exception 'finding job is not eligible for trusted memory';end if;
 return new;
end $$;
create trigger trusted_finding_job_evidence before insert on public.finding_evidence for each row execute function public.guard_trusted_finding_job_evidence();

-- Demo origin from the server seed path must not be lost in the legacy primitive.
create or replace function public.create_completed_job_server(p_organization_id uuid,p_actor_user_id uuid,p_job jsonb,p_estimate_lines jsonb,p_actual_lines jsonb,p_variances jsonb,p_lessons jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member';end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 v_id:=public.create_completed_job(p_job||jsonb_build_object('organization_id',p_organization_id),p_estimate_lines,p_actual_lines,p_variances,p_lessons);
 update public.jobs set data_origin=coalesce(nullif(p_job->>'data_origin',''),'production'),estimate_baseline_role=nullif(p_job->>'estimate_baseline_role','') where id=v_id and organization_id=p_organization_id;
 return v_id;
end $$;

-- Remove browser mutation and direct vector visibility. Business fields remain readable.
revoke all on public.job_search_documents from authenticated;
revoke update,insert,delete on public.lessons from authenticated;
revoke select on public.lessons from authenticated;
grant select(id,organization_id,job_id,title,category,lesson,cause,impact_summary,confidence,status,created_at,updated_at) on public.lessons to authenticated;

revoke all on function public.ensure_embedding_space_server(uuid,uuid,text,text,integer),public.set_lesson_status_server(uuid,uuid,uuid,text),public.quarantine_job_memory_server(uuid,uuid,uuid,text),public.revise_lesson_server(uuid,uuid,uuid,text,text,text,text),
 public.enqueue_memory_index_job(uuid,uuid,text,uuid,text,text,text,text,text,integer),public.claim_memory_index_jobs(uuid,uuid,uuid,integer),
 public.complete_memory_index_job(uuid,uuid,uuid,uuid,text,extensions.vector),public.fail_memory_index_job(uuid,uuid,uuid,uuid,text),
 public.record_memory_reconciliation(uuid,uuid,uuid,integer,integer,integer,integer,integer),public.match_trusted_jobs(uuid,extensions.vector,uuid[],float,integer) from public,anon,authenticated;
grant execute on function public.ensure_embedding_space_server(uuid,uuid,text,text,integer),public.set_lesson_status_server(uuid,uuid,uuid,text),public.quarantine_job_memory_server(uuid,uuid,uuid,text),public.revise_lesson_server(uuid,uuid,uuid,text,text,text,text),
 public.enqueue_memory_index_job(uuid,uuid,text,uuid,text,text,text,text,text,integer),public.claim_memory_index_jobs(uuid,uuid,uuid,integer),
 public.complete_memory_index_job(uuid,uuid,uuid,uuid,text,extensions.vector),public.fail_memory_index_job(uuid,uuid,uuid,uuid,text),
 public.record_memory_reconciliation(uuid,uuid,uuid,integer,integer,integer,integer,integer) to service_role;
revoke all on function public.match_lessons(uuid,extensions.vector,float,integer),public.match_jobs(uuid,extensions.vector,text,text,float,integer) from public,anon;
grant execute on function public.match_lessons(uuid,extensions.vector,float,integer),public.match_jobs(uuid,extensions.vector,text,text,float,integer),public.match_trusted_jobs(uuid,extensions.vector,uuid[],float,integer),public.get_memory_readiness(uuid,uuid),public.get_warning_calibration(uuid,text) to authenticated,service_role;
revoke all on function public.assert_embedding_space(uuid,text,text,integer) from public,anon;
grant execute on function public.assert_embedding_space(uuid,text,text,integer) to authenticated,service_role;
