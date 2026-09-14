-- Margin Memory production schema
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_org_owner(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner','admin')
  );
$$;

create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if char_length(trim(p_name)) < 2 then
    raise exception 'organization name is too short';
  end if;
  insert into public.organizations(name, created_by)
  values (trim(p_name), (select auth.uid()))
  returning id into v_org_id;
  insert into public.organization_members(organization_id, user_id, role)
  values (v_org_id, (select auth.uid()), 'owner');
  return v_org_id;
end;
$$;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  name text not null,
  project_type text not null,
  customer_type text not null default 'Commercial',
  location text not null default '',
  completed_at date not null,
  tags text[] not null default '{}',
  notes text not null default '',
  estimated_total numeric(14,2) not null default 0,
  actual_total numeric(14,2) not null default 0,
  gross_margin_pct numeric(7,4),
  created_at timestamptz not null default now()
);

create table public.job_estimate_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  category text not null check (category in ('labor','materials','equipment','subcontractor','permit','other')),
  description text not null,
  quantity numeric(14,4), unit text,
  estimated_hours numeric(12,2), estimated_cost numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.job_actual_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  category text not null check (category in ('labor','materials','equipment','subcontractor','permit','other')),
  description text not null,
  actual_hours numeric(12,2), actual_cost numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.job_variances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  category text not null check (category in ('labor','materials','equipment','subcontractor','permit','other')),
  estimated_cost numeric(14,2) not null default 0,
  actual_cost numeric(14,2) not null default 0,
  estimated_hours numeric(12,2) not null default 0,
  actual_hours numeric(12,2) not null default 0,
  cost_delta numeric(14,2) not null default 0,
  cost_delta_pct numeric(12,6),
  hours_delta numeric(12,2) not null default 0,
  hours_delta_pct numeric(12,6),
  unique(job_id, category)
);

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  name text not null,
  project_type text not null,
  customer_type text not null default 'Commercial',
  location text not null default '',
  bid_due date,
  tags text[] not null default '{}',
  assumptions text[] not null default '{}',
  estimated_total numeric(14,2) not null default 0,
  estimated_labor_hours numeric(12,2) not null default 0,
  status text not null default 'draft' check (status in ('draft','reviewing','needs_input','ready')),
  investigation_status text not null default 'queued' check (investigation_status in ('queued','investigating','needs_input','completed','failed')),
  agent_summary text,
  agent_mode text check (agent_mode in ('strands','deterministic')),
  agent_telemetry jsonb,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  category text not null check (category in ('labor','materials','equipment','subcontractor','permit','other')),
  description text not null,
  quantity numeric(14,4), unit text,
  estimated_hours numeric(12,2), estimated_cost numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.investigations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','investigating','needs_input','completed','failed')),
  mode text check (mode in ('strands','deterministic')),
  summary text,
  cycle_count integer not null default 0,
  tools_used text[] not null default '{}',
  total_duration_ms integer,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  investigation_id uuid references public.investigations(id) on delete set null,
  category text not null check (category in ('labor','materials','equipment','subcontractor','permit','other','scope','assumption')),
  severity text not null check (severity in ('low','medium','high')),
  title text not null, claim text not null, rationale text not null, recommendation text not null,
  question text, confidence numeric(5,4) not null check (confidence between 0 and 1),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now()
);

create table public.finding_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null references public.findings(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  label text not null, detail text not null,
  created_at timestamptz not null default now()
);

create table public.human_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  investigation_id uuid references public.investigations(id) on delete set null,
  finding_id uuid references public.findings(id) on delete set null,
  prompt text not null, context text not null default '', options text[] not null default '{}',
  answer text, resolved_at timestamptz, created_at timestamptz not null default now()
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  title text not null,
  category text not null check (category in ('labor','materials','equipment','subcontractor','permit','other','scope','assumption')),
  lesson text not null, cause text not null, impact_summary text not null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.job_search_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  content text not null,
  embedding extensions.vector(1536),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  estimate_id uuid references public.estimates(id) on delete cascade,
  kind text not null check (kind in ('estimate','actuals','notes','project_document')),
  file_name text not null, storage_path text not null unique, mime_type text, size_bytes bigint,
  extracted_text text not null default '',
  created_at timestamptz not null default now(),
  check ((job_id is not null)::int + (estimate_id is not null)::int = 1)
);

-- indexes
create index organization_members_user_idx on public.organization_members(user_id);
create index jobs_org_completed_idx on public.jobs(organization_id, completed_at desc);
create index estimates_org_created_idx on public.estimates(organization_id, created_at desc);
create index findings_estimate_status_idx on public.findings(estimate_id, status);
create index questions_estimate_resolved_idx on public.human_questions(estimate_id, resolved_at);
create index lessons_org_status_idx on public.lessons(organization_id, status);
create index job_docs_embedding_hnsw on public.job_search_documents using hnsw (embedding extensions.vector_cosine_ops);
create index lessons_embedding_hnsw on public.lessons using hnsw (embedding extensions.vector_cosine_ops);

-- Vector RPCs. SECURITY INVOKER preserves RLS.
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
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.jobs enable row level security;
alter table public.job_estimate_lines enable row level security;
alter table public.job_actual_lines enable row level security;
alter table public.job_variances enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_lines enable row level security;
alter table public.investigations enable row level security;
alter table public.findings enable row level security;
alter table public.finding_evidence enable row level security;
alter table public.human_questions enable row level security;
alter table public.lessons enable row level security;
alter table public.job_search_documents enable row level security;
alter table public.documents enable row level security;

create policy org_select on public.organizations for select to authenticated using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated using (public.is_org_owner(id)) with check (public.is_org_owner(id));
create policy members_select on public.organization_members for select to authenticated using (public.is_org_member(organization_id));
create policy members_manage on public.organization_members for all to authenticated using (public.is_org_owner(organization_id)) with check (public.is_org_owner(organization_id));

-- Tenant tables share the same membership policy.
do $$
declare t text;
begin
  foreach t in array array['jobs','job_estimate_lines','job_actual_lines','job_variances','estimates','estimate_lines','investigations','findings','finding_evidence','human_questions','lessons','job_search_documents','documents']
  loop
    execute format('create policy %I on public.%I for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

-- Private file bucket. Object path begins with organization UUID.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('job-files', 'job-files', false, 26214400, array[
  'text/csv','text/plain','text/markdown','application/vnd.ms-excel','application/octet-stream',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf'
])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "tenant read job files" on storage.objects for select to authenticated
using (bucket_id = 'job-files' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "tenant upload job files" on storage.objects for insert to authenticated
with check (bucket_id = 'job-files' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "tenant update job files" on storage.objects for update to authenticated
using (bucket_id = 'job-files' and public.is_org_member(((storage.foldername(name))[1])::uuid))
with check (bucket_id = 'job-files' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "tenant delete job files" on storage.objects for delete to authenticated
using (bucket_id = 'job-files' and public.is_org_member(((storage.foldername(name))[1])::uuid));

revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.is_org_owner(uuid) from public, anon;
revoke execute on function public.create_organization(text) from public, anon;
revoke execute on function public.match_lessons(uuid, extensions.vector, float, int) from public, anon;
revoke execute on function public.match_jobs(uuid, extensions.vector, text, text, float, int) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.match_lessons(uuid, extensions.vector, float, int) to authenticated;
grant execute on function public.match_jobs(uuid, extensions.vector, text, text, float, int) to authenticated;
