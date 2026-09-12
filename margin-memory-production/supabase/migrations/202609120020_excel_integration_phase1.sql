-- Excel live-source identity and the narrow server-only binding that makes a
-- reviewed workbook snapshot an immutable estimate revision. Uploaded XLSX
-- and CSV artifacts retain their existing byte-hash review semantics.

alter table public.import_review_files
  add column source_type text check(source_type in('xlsx_upload','csv_upload','excel_live_snapshot')),
  add column source_adapter_version text,
  add column source_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(source_metadata)='object'),
  add column canonical_snapshot_hash text check(canonical_snapshot_hash~'^[0-9a-f]{64}$'),
  add column source_captured_at timestamptz;

update public.import_review_files
set source_type=case when lower(file_name) like '%.csv' then 'csv_upload' else 'xlsx_upload' end
where role in('estimate','actuals') and source_type is null;

alter table public.import_review_files add constraint import_review_file_source_shape check(
  (role not in('estimate','actuals') and source_type is null and canonical_snapshot_hash is null)
  or
  (role in('estimate','actuals') and source_type in('xlsx_upload','csv_upload') and canonical_snapshot_hash is null)
  or
  (role='estimate' and source_type='excel_live_snapshot' and canonical_snapshot_hash is not null
    and source_adapter_version is not null and source_captured_at is not null
    and source_metadata ? 'sourceIdentityHash' and source_metadata ? 'worksheetId')
);

alter table public.documents
  add column source_type text check(source_type in('xlsx_upload','csv_upload','excel_live_snapshot')),
  add column source_adapter_version text,
  add column source_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(source_metadata)='object'),
  add column canonical_snapshot_hash text check(canonical_snapshot_hash~'^[0-9a-f]{64}$'),
  add column source_captured_at timestamptz;

create table public.estimate_source_bindings(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type text not null check(source_type='excel_live_snapshot'),
  source_identity_hash text not null check(source_identity_hash~'^[0-9a-f]{64}$'),
  latest_snapshot_hash text not null check(latest_snapshot_hash~'^[0-9a-f]{64}$'),
  latest_profile_hash text not null check(latest_profile_hash~'^[0-9a-f]{64}$'),
  latest_review_id uuid not null,
  latest_estimate_id uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(organization_id,source_type,source_identity_hash),
  foreign key(organization_id,latest_review_id) references public.import_reviews(organization_id,id),
  foreign key(organization_id,latest_estimate_id) references public.estimates(organization_id,id)
);
create index estimate_source_bindings_estimate_idx on public.estimate_source_bindings(organization_id,latest_estimate_id);

create table public.excel_integration_runs(
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  source_identity_hash text not null check(source_identity_hash~'^[0-9a-f]{64}$'),
  snapshot_hash text not null check(snapshot_hash~'^[0-9a-f]{64}$'),
  adapter_version text not null,
  captured_at timestamptz not null,
  status text not null check(status in('previewed','ready','committing','running','needs_input','completed','failed')),
  failure_stage text,
  error_message text,
  review_id uuid,
  estimate_id uuid,
  investigation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,id),
  foreign key(organization_id,review_id) references public.import_reviews(organization_id,id),
  foreign key(organization_id,estimate_id) references public.estimates(organization_id,id),
  foreign key(organization_id,investigation_id) references public.investigations(organization_id,id),
  check((status='failed')=(failure_stage is not null and error_message is not null))
);
create index excel_integration_runs_source_idx on public.excel_integration_runs(organization_id,source_identity_hash,created_at desc);
create index excel_integration_runs_review_idx on public.excel_integration_runs(organization_id,review_id);

alter table public.estimate_source_bindings enable row level security;
alter table public.excel_integration_runs enable row level security;
revoke all on public.estimate_source_bindings,public.excel_integration_runs from public,anon,authenticated;
grant select,insert,update on public.estimate_source_bindings,public.excel_integration_runs to service_role;

create or replace function public.create_import_review(
 p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_import_kind text,p_parser_version text,p_report_hash text,
 p_context jsonb,p_reports jsonb,p_issues jsonb,p_completeness jsonb,p_files jsonb,p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare r jsonb; v_prefix text; v_source_type text;
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'actor is not a member'; end if;
 if p_import_kind not in('new_estimate','historical_job','closeout_actual') then raise exception 'invalid import kind'; end if;
 if p_expires_at<=now() or p_expires_at>now()+interval '24 hours' then raise exception 'invalid review expiry'; end if;
 insert into public.import_reviews(id,organization_id,user_id,import_kind,parser_version,report_hash,context,reports,issues,completeness,expires_at)
 values(p_review_id,p_organization_id,p_actor_user_id,p_import_kind,p_parser_version,p_report_hash,p_context,p_reports,p_issues,p_completeness,p_expires_at);
 for r in select value from jsonb_array_elements(coalesce(p_files,'[]')) loop
  v_prefix:=case when p_import_kind='closeout_actual' then p_organization_id::text||'/'||(p_context->>'estimateId')||'/closeout/reviews/'||p_review_id::text||'/' else p_organization_id::text||'/import-staging/'||p_review_id::text||'/' end;
  if position(v_prefix in (r->>'storage_path'))<>1 then raise exception 'invalid staged file path'; end if;
  if not exists(select 1 from storage.objects where bucket_id='job-files' and name=r->>'storage_path') then raise exception 'staged source file does not exist'; end if;
  v_source_type:=nullif(r->>'source_type','');
  if v_source_type is null and r->>'role' in('estimate','actuals') then
    v_source_type:=case when lower(r->>'file_name') like '%.csv' then 'csv_upload' else 'xlsx_upload' end;
  end if;
  insert into public.import_review_files(
    id,organization_id,import_review_id,role,ordinal,file_name,storage_path,mime_type,size_bytes,file_sha256,
    extracted_text,worksheet,source_type,source_adapter_version,source_metadata,canonical_snapshot_hash,source_captured_at
  ) values(
    (r->>'id')::uuid,p_organization_id,p_review_id,r->>'role',coalesce((r->>'ordinal')::int,0),r->>'file_name',r->>'storage_path',
    coalesce(r->>'mime_type','application/octet-stream'),(r->>'size_bytes')::bigint,r->>'sha256',coalesce(r->>'extracted_text',''),nullif(r->>'worksheet',''),
    v_source_type,nullif(r->>'source_adapter_version',''),coalesce(r->'source_metadata','{}'::jsonb),nullif(r->>'canonical_snapshot_hash',''),nullif(r->>'source_captured_at','')::timestamptz
  );
 end loop;
 if p_import_kind='new_estimate' and not exists(select 1 from public.import_review_files where import_review_id=p_review_id and role='estimate') then raise exception 'estimate source required'; end if;
 if p_import_kind='historical_job' and not exists(select 1 from public.import_review_files where import_review_id=p_review_id and role='estimate') then raise exception 'historical estimate source required'; end if;
 if p_import_kind in('historical_job','closeout_actual') and not exists(select 1 from public.import_review_files where import_review_id=p_review_id and role='actuals') then raise exception 'actual source required'; end if;
 return p_review_id;
end $$;

create or replace function public.commit_estimate_import(
 p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_report_hash text,p_acknowledged text[],p_estimate jsonb,p_lines jsonb,p_provenance jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
 v public.import_reviews; v_id uuid; f public.import_review_files; v_binding public.estimate_source_bindings;
 v_identity text; v_snapshot text; v_profile_hash text; v_expected_parent uuid;
begin
 v:=public.assert_import_review(p_organization_id,p_actor_user_id,p_review_id,'new_estimate',p_report_hash,p_acknowledged);
 if v.status='committed' then return v.result_estimate_id;end if;
 select * into f from public.import_review_files where organization_id=p_organization_id and import_review_id=p_review_id and role='estimate' and ordinal=0;
 if f.id is null then raise exception 'reviewed estimate source is missing';end if;

 if f.source_type='excel_live_snapshot' then
  v_identity:=f.source_metadata->>'sourceIdentityHash';v_snapshot:=f.canonical_snapshot_hash;v_profile_hash:=v.context->>'profileHash';
  if v_identity is null or v_identity<>v.context->>'sourceIdentityHash' or v_snapshot is null or v_snapshot<>v.context->>'snapshotHash' or v_profile_hash is null then raise exception 'Excel source identity does not match reviewed import';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_identity,0));
  select * into v_binding from public.estimate_source_bindings where organization_id=p_organization_id and source_type='excel_live_snapshot' and source_identity_hash=v_identity for update;
  if v_binding.latest_estimate_id is not null and v_binding.latest_snapshot_hash=v_snapshot and v_binding.latest_profile_hash=v_profile_hash then return v_binding.latest_estimate_id;end if;
  v_expected_parent:=v_binding.latest_estimate_id;
  if nullif(v.context->>'parentEstimateId','')::uuid is distinct from v_expected_parent then raise exception 'Excel workbook changed from a stale estimate baseline; preview it again';end if;
 end if;

 if coalesce(nullif(p_estimate->>'parent_estimate_id',''),'')<>coalesce(v.context->>'parentEstimateId','') or coalesce(nullif(p_estimate->>'baseline_role',''),'original_bid')<>coalesce(v.context->>'baselineRole','original_bid') then raise exception 'commercial baseline does not match reviewed import';end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 p_estimate:=p_estimate||jsonb_build_object('organization_id',p_organization_id);
 v_id:=public.create_estimate_with_lines(p_estimate,p_lines);
 for f in select * from public.import_review_files where import_review_id=p_review_id order by role,ordinal loop
  insert into public.documents(organization_id,estimate_id,kind,file_name,storage_path,mime_type,size_bytes,extracted_text,source_type,source_adapter_version,source_metadata,canonical_snapshot_hash,source_captured_at)
  values(p_organization_id,v_id,case when f.role='estimate' then 'estimate' else 'project_document' end,f.file_name,f.storage_path,f.mime_type,f.size_bytes,f.extracted_text,f.source_type,f.source_adapter_version,f.source_metadata,f.canonical_snapshot_hash,f.source_captured_at);
 end loop;
 perform public.store_import_provenance(p_organization_id,p_review_id,'estimate',p_provenance);
 update public.import_reviews set status='committed',acknowledged_issue_codes=p_acknowledged,result_estimate_id=v_id,committed_at=now() where id=p_review_id;
 if v_identity is not null then
  insert into public.estimate_source_bindings(organization_id,source_type,source_identity_hash,latest_snapshot_hash,latest_profile_hash,latest_review_id,latest_estimate_id,created_by)
  values(p_organization_id,'excel_live_snapshot',v_identity,v_snapshot,v_profile_hash,p_review_id,v_id,p_actor_user_id)
  on conflict(organization_id,source_type,source_identity_hash) do update set latest_snapshot_hash=excluded.latest_snapshot_hash,latest_profile_hash=excluded.latest_profile_hash,latest_review_id=excluded.latest_review_id,latest_estimate_id=excluded.latest_estimate_id,updated_at=now();
 end if;
 return v_id;
end $$;

revoke all on function public.create_import_review(uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.commit_estimate_import(uuid,uuid,uuid,text,text[],jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_import_review(uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz) to service_role;
grant execute on function public.commit_estimate_import(uuid,uuid,uuid,text,text[],jsonb,jsonb,jsonb) to service_role;
