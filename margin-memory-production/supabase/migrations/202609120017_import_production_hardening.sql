-- Durable import review contracts, source provenance, revision identity and
-- idempotent staged-file commits. Trusted import RPCs are service-role only;
-- they receive the already authenticated actor and verify membership again.

create function public.is_org_member_user(p_organization_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id)
$$;
revoke all on function public.is_org_member_user(uuid,uuid) from public,anon,authenticated;

alter table public.estimates
  add column revision_group_id uuid,
  add column parent_estimate_id uuid,
  add column revision_number integer not null default 0 check(revision_number>=0),
  add column baseline_role text not null default 'original_bid'
    check(baseline_role in('original_bid','revision','final_submitted','historical_unknown'));
update public.estimates set revision_group_id=id where revision_group_id is null;
alter table public.estimates alter column revision_group_id set not null;
alter table public.estimates
  add constraint estimate_revision_group_fk foreign key(organization_id,revision_group_id) references public.estimates(organization_id,id),
  add constraint estimate_revision_parent_fk foreign key(organization_id,parent_estimate_id) references public.estimates(organization_id,id),
  add constraint estimate_revision_shape check((revision_number=0 and parent_estimate_id is null and baseline_role<>'revision') or (revision_number>0 and parent_estimate_id is not null and baseline_role='revision')),
  add constraint estimate_revision_number_unique unique(organization_id,revision_group_id,revision_number);

alter table public.jobs add column estimate_baseline_role text
  check(estimate_baseline_role in('original_bid','final_submitted','historical_unknown'));

create function public.guard_estimate_baseline_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.revision_group_id,new.parent_estimate_id,new.revision_number,new.baseline_role) is distinct from (old.revision_group_id,old.parent_estimate_id,old.revision_number,old.baseline_role) then raise exception 'estimate revision identity is immutable';end if;
 return new;
end $$;
create function public.guard_job_baseline_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if old.estimate_baseline_role is not null and new.estimate_baseline_role is distinct from old.estimate_baseline_role then raise exception 'job baseline identity is immutable';end if;
 return new;
end $$;
create trigger estimate_baseline_immutable before update on public.estimates for each row execute function public.guard_estimate_baseline_identity();
create trigger job_baseline_immutable before update on public.jobs for each row execute function public.guard_job_baseline_identity();

alter table public.estimate_lines add column normalized_unit text, add column unit_cost numeric(14,4);
alter table public.job_estimate_lines add column normalized_unit text, add column unit_cost numeric(14,4);
alter table public.job_actual_lines add column quantity numeric(14,4), add column unit text, add column normalized_unit text, add column unit_cost numeric(14,4);

alter table public.estimate_lines add constraint estimate_lines_org_id_unique unique(organization_id,id);
alter table public.job_estimate_lines add constraint job_estimate_lines_org_id_unique unique(organization_id,id);
alter table public.job_actual_lines add constraint job_actual_lines_org_id_unique unique(organization_id,id);

create table public.import_reviews(
 id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete restrict,
 import_kind text not null check(import_kind in('new_estimate','historical_job','closeout_actual')),
 parser_version text not null,
 report_hash text not null check(report_hash~'^[0-9a-f]{64}$'),
 context jsonb not null default '{}'::jsonb check(jsonb_typeof(context)='object'),
 reports jsonb not null check(jsonb_typeof(reports)='array'),
 issues jsonb not null check(jsonb_typeof(issues)='array'),
 completeness jsonb,
 status text not null default 'staged' check(status in('staged','committed','expired','cleaned')),
 acknowledged_issue_codes text[] not null default '{}',
 result_estimate_id uuid,
 result_job_id uuid,
 expires_at timestamptz not null,
 committed_at timestamptz,
 cleanup_claimed_at timestamptz,
 cleaned_at timestamptz,
 created_at timestamptz not null default now(),
 unique(organization_id,id),
 check(expires_at>created_at),
 check((status='committed')=(committed_at is not null)),
 check((result_estimate_id is null)::int+(result_job_id is null)::int>=1)
);
alter table public.import_reviews
 add constraint import_review_result_estimate_fk foreign key(organization_id,result_estimate_id) references public.estimates(organization_id,id),
 add constraint import_review_result_job_fk foreign key(organization_id,result_job_id) references public.jobs(organization_id,id);
create index import_reviews_cleanup_idx on public.import_reviews(status,expires_at) where status in('staged','expired');

create table public.import_review_files(
 id uuid primary key,
 organization_id uuid not null,
 import_review_id uuid not null,
 role text not null check(role in('estimate','actuals','notes','project_document')),
 ordinal integer not null default 0 check(ordinal>=0),
 file_name text not null,
 storage_path text not null unique,
 mime_type text not null,
 size_bytes bigint not null check(size_bytes>0 and size_bytes<=26214400),
 file_sha256 text not null check(file_sha256~'^[0-9a-f]{64}$'),
 extracted_text text not null default '',
 worksheet text,
 created_at timestamptz not null default now(),
 unique(import_review_id,role,ordinal),
 unique(organization_id,import_review_id,id),
 foreign key(organization_id,import_review_id) references public.import_reviews(organization_id,id) on delete cascade
);
create index import_review_files_review_idx on public.import_review_files(import_review_id);

create table public.import_line_provenance(
 id uuid primary key default extensions.gen_random_uuid(),
 organization_id uuid not null,
 import_review_id uuid not null,
 import_review_file_id uuid not null,
 estimate_line_id uuid,
 job_estimate_line_id uuid,
 job_actual_line_id uuid,
 worksheet text not null,
 source_row integer not null check(source_row>0),
 resolved_mapping jsonb not null check(jsonb_typeof(resolved_mapping)='object'),
 original_values jsonb not null check(jsonb_typeof(original_values)='object'),
 normalization_decisions text[] not null default '{}',
 parser_version text not null,
 created_at timestamptz not null default now(),
 check((estimate_line_id is not null)::int+(job_estimate_line_id is not null)::int+(job_actual_line_id is not null)::int=1),
 foreign key(organization_id,import_review_id) references public.import_reviews(organization_id,id),
 foreign key(organization_id,import_review_id,import_review_file_id) references public.import_review_files(organization_id,import_review_id,id),
 foreign key(organization_id,estimate_line_id) references public.estimate_lines(organization_id,id),
 foreign key(organization_id,job_estimate_line_id) references public.job_estimate_lines(organization_id,id),
 foreign key(organization_id,job_actual_line_id) references public.job_actual_lines(organization_id,id),
 unique(estimate_line_id), unique(job_estimate_line_id), unique(job_actual_line_id)
);
create index import_line_provenance_review_idx on public.import_line_provenance(import_review_id);

alter table public.import_reviews enable row level security;
alter table public.import_review_files enable row level security;
alter table public.import_line_provenance enable row level security;
revoke all on public.import_reviews,public.import_review_files,public.import_line_provenance from public,anon,authenticated;
grant select on public.import_reviews,public.import_review_files,public.import_line_provenance to service_role;

create function public.create_import_review(
 p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_import_kind text,p_parser_version text,p_report_hash text,
 p_context jsonb,p_reports jsonb,p_issues jsonb,p_completeness jsonb,p_files jsonb,p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare r jsonb; v_prefix text;
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
  insert into public.import_review_files(id,organization_id,import_review_id,role,ordinal,file_name,storage_path,mime_type,size_bytes,file_sha256,extracted_text,worksheet)
  values((r->>'id')::uuid,p_organization_id,p_review_id,r->>'role',coalesce((r->>'ordinal')::int,0),r->>'file_name',r->>'storage_path',coalesce(r->>'mime_type','application/octet-stream'),(r->>'size_bytes')::bigint,r->>'sha256',coalesce(r->>'extracted_text',''),nullif(r->>'worksheet',''));
 end loop;
 if p_import_kind='new_estimate' and not exists(select 1 from public.import_review_files where import_review_id=p_review_id and role='estimate') then raise exception 'estimate source required'; end if;
 if p_import_kind='historical_job' and not exists(select 1 from public.import_review_files where import_review_id=p_review_id and role='estimate') then raise exception 'historical estimate source required'; end if;
 if p_import_kind in('historical_job','closeout_actual') and not exists(select 1 from public.import_review_files where import_review_id=p_review_id and role='actuals') then raise exception 'actual source required'; end if;
 return p_review_id;
end $$;

create function public.assert_import_review(
 p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_import_kind text,p_report_hash text,p_acknowledged text[]
) returns public.import_reviews language plpgsql security definer set search_path='' as $$
declare v public.import_reviews; expected text[];
begin
 select * into v from public.import_reviews where id=p_review_id and organization_id=p_organization_id for update;
 if v.id is null then raise exception 'import review not found'; end if;
 if v.user_id<>p_actor_user_id or not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'import review is not owned by this user'; end if;
 if v.import_kind<>p_import_kind or v.report_hash<>p_report_hash then raise exception 'import review contract mismatch'; end if;
 if v.status='committed' then return v; end if;
 if v.status<>'staged' or v.expires_at<=now() then raise exception 'import review has expired'; end if;
 if exists(select 1 from jsonb_array_elements(v.issues) issue where issue->>'severity'='error') then raise exception 'hard import blockers cannot be approved'; end if;
 select coalesce(array_agg(distinct issue->>'code' order by issue->>'code'),'{}') into expected from jsonb_array_elements(v.issues) issue where issue->>'severity'='warning';
 if expected<>coalesce((select array_agg(distinct code order by code) from unnest(coalesce(p_acknowledged,'{}')) code),'{}') then raise exception 'acknowledged warnings do not match reviewed import'; end if;
 return v;
end $$;

create function public.store_import_provenance(p_organization_id uuid,p_review_id uuid,p_owner_kind text,p_rows jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r jsonb; v_file uuid;
begin
 for r in select value from jsonb_array_elements(coalesce(p_rows,'[]')) loop
  select id into v_file from public.import_review_files where organization_id=p_organization_id and import_review_id=p_review_id and role=r->>'fileRole' order by ordinal limit 1;
  if v_file is null then raise exception 'provenance source file missing'; end if;
  insert into public.import_line_provenance(organization_id,import_review_id,import_review_file_id,estimate_line_id,job_estimate_line_id,job_actual_line_id,worksheet,source_row,resolved_mapping,original_values,normalization_decisions,parser_version)
  values(p_organization_id,p_review_id,v_file,
   case when p_owner_kind='estimate' then (r->>'lineId')::uuid end,
   case when p_owner_kind='job_estimate' then (r->>'lineId')::uuid end,
   case when p_owner_kind='job_actual' then (r->>'lineId')::uuid end,
   r->>'worksheet',(r->>'sourceRow')::int,r->'mapping',r->'originalValues',coalesce(array(select jsonb_array_elements_text(r->'normalizationDecisions')),'{}'),r->>'parserVersion');
 end loop;
end $$;

create or replace function public.create_estimate_with_lines(p_estimate jsonb,p_lines jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=(p_estimate->>'id')::uuid; r jsonb; v_parent uuid:=nullif(p_estimate->>'parent_estimate_id','')::uuid; v_group uuid; v_revision integer; v_role text:=coalesce(nullif(p_estimate->>'baseline_role',''),'original_bid');
begin
 if not public.is_org_member((p_estimate->>'organization_id')::uuid) then raise exception 'not authorized'; end if;
 if jsonb_array_length(coalesce(p_lines,'[]'))=0 then raise exception 'estimate lines required'; end if;
 if v_parent is null then v_group:=v_id;v_revision:=0;if v_role='revision' then raise exception 'revision requires parent estimate';end if;
 else
  select revision_group_id into v_group from public.estimates where id=v_parent and organization_id=(p_estimate->>'organization_id')::uuid;
  if v_group is null then raise exception 'revision parent not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_group::text,0));
  select coalesce(max(revision_number),-1)+1 into v_revision from public.estimates where organization_id=(p_estimate->>'organization_id')::uuid and revision_group_id=v_group;
  v_role:='revision';
 end if;
 insert into public.estimates(id,organization_id,created_by,name,project_type,customer_type,location,bid_due,tags,assumptions,estimated_total,estimated_labor_hours,status,investigation_status,created_at,revision_group_id,parent_estimate_id,revision_number,baseline_role)
 values(v_id,(p_estimate->>'organization_id')::uuid,auth.uid(),p_estimate->>'name',p_estimate->>'project_type',coalesce(p_estimate->>'customer_type','Commercial'),coalesce(p_estimate->>'location',''),nullif(p_estimate->>'bid_due','')::date,
  coalesce(array(select jsonb_array_elements_text(p_estimate->'tags')),'{}'),coalesce(array(select jsonb_array_elements_text(p_estimate->'assumptions')),'{}'),
  (select coalesce(sum((x->>'estimated_cost')::numeric),0) from jsonb_array_elements(p_lines)x),(select coalesce(sum((x->>'estimated_hours')::numeric),0) from jsonb_array_elements(p_lines)x),'draft','queued',coalesce((p_estimate->>'created_at')::timestamptz,now()),v_group,v_parent,v_revision,v_role);
 for r in select value from jsonb_array_elements(p_lines) loop
  insert into public.estimate_lines(id,organization_id,estimate_id,category,description,quantity,unit,normalized_unit,unit_cost,cost_code,phase,division,estimated_hours,estimated_cost)
  values((r->>'id')::uuid,(p_estimate->>'organization_id')::uuid,v_id,r->>'category',r->>'description',nullif(r->>'quantity','')::numeric,nullif(r->>'unit',''),nullif(r->>'normalized_unit',''),nullif(r->>'unit_cost','')::numeric,nullif(r->>'cost_code',''),nullif(r->>'phase',''),nullif(r->>'division',''),nullif(r->>'estimated_hours','')::numeric,coalesce((r->>'estimated_cost')::numeric,0));
 end loop;return v_id;
end $$;

create function public.commit_estimate_import(
 p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_report_hash text,p_acknowledged text[],p_estimate jsonb,p_lines jsonb,p_provenance jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.import_reviews; v_id uuid; f public.import_review_files;
begin
 v:=public.assert_import_review(p_organization_id,p_actor_user_id,p_review_id,'new_estimate',p_report_hash,p_acknowledged);
 if v.status='committed' then return v.result_estimate_id;end if;
 if coalesce(nullif(p_estimate->>'parent_estimate_id',''),'')<>coalesce(v.context->>'parentEstimateId','') or coalesce(nullif(p_estimate->>'baseline_role',''),'original_bid')<>coalesce(v.context->>'baselineRole','original_bid') then raise exception 'commercial baseline does not match reviewed import';end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 p_estimate:=p_estimate||jsonb_build_object('organization_id',p_organization_id);
 v_id:=public.create_estimate_with_lines(p_estimate,p_lines);
 for f in select * from public.import_review_files where import_review_id=p_review_id order by role,ordinal loop
  insert into public.documents(organization_id,estimate_id,kind,file_name,storage_path,mime_type,size_bytes,extracted_text)
  values(p_organization_id,v_id,case when f.role='estimate' then 'estimate' else 'project_document' end,f.file_name,f.storage_path,f.mime_type,f.size_bytes,f.extracted_text);
 end loop;
 perform public.store_import_provenance(p_organization_id,p_review_id,'estimate',p_provenance);
 update public.import_reviews set status='committed',acknowledged_issue_codes=p_acknowledged,result_estimate_id=v_id,committed_at=now() where id=p_review_id;
 return v_id;
end $$;

create function public.commit_historical_import(
 p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_report_hash text,p_acknowledged text[],p_job jsonb,p_estimate_lines jsonb,p_actual_lines jsonb,p_variances jsonb,p_lessons jsonb,p_estimate_provenance jsonb,p_actual_provenance jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.import_reviews; v_id uuid; f public.import_review_files;
begin
 v:=public.assert_import_review(p_organization_id,p_actor_user_id,p_review_id,'historical_job',p_report_hash,p_acknowledged);
 if v.status='committed' then return v.result_job_id;end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 p_job:=p_job||jsonb_build_object('organization_id',p_organization_id);
 v_id:=public.create_completed_job(p_job,p_estimate_lines,p_actual_lines,p_variances,p_lessons);
 update public.jobs set estimate_baseline_role=coalesce(nullif(v.context->>'estimateBaselineRole',''),'historical_unknown') where id=v_id;
 -- Reinsert current line shape so quantity/unit/rate are retained for both sides.
 update public.job_estimate_lines l set normalized_unit=nullif(r.value->>'normalized_unit',''),unit_cost=nullif(r.value->>'unit_cost','')::numeric from jsonb_array_elements(p_estimate_lines)r where l.id=(r.value->>'id')::uuid and l.job_id=v_id;
 update public.job_actual_lines l set quantity=nullif(r.value->>'quantity','')::numeric,unit=nullif(r.value->>'unit',''),normalized_unit=nullif(r.value->>'normalized_unit',''),unit_cost=nullif(r.value->>'unit_cost','')::numeric from jsonb_array_elements(p_actual_lines)r where l.id=(r.value->>'id')::uuid and l.job_id=v_id;
 for f in select * from public.import_review_files where import_review_id=p_review_id order by role,ordinal loop
  insert into public.documents(organization_id,job_id,kind,file_name,storage_path,mime_type,size_bytes,extracted_text) values(p_organization_id,v_id,case when f.role='actuals' then 'actuals' when f.role='estimate' then 'estimate' else 'notes' end,f.file_name,f.storage_path,f.mime_type,f.size_bytes,f.extracted_text);
 end loop;
 perform public.store_import_provenance(p_organization_id,p_review_id,'job_estimate',p_estimate_provenance);
 perform public.store_import_provenance(p_organization_id,p_review_id,'job_actual',p_actual_provenance);
 update public.import_reviews set status='committed',acknowledged_issue_codes=p_acknowledged,result_job_id=v_id,committed_at=now() where id=p_review_id;
 return v_id;
end $$;

create function public.commit_closeout_import(
 p_organization_id uuid,p_actor_user_id uuid,p_review_id uuid,p_report_hash text,p_acknowledged text[],p_estimate_id uuid,p_actual_lines jsonb,p_lessons jsonb,p_outcomes jsonb,p_notes text,p_scope_review jsonb,p_actual_provenance jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.import_reviews; v_id uuid; sources jsonb;
begin
 v:=public.assert_import_review(p_organization_id,p_actor_user_id,p_review_id,'closeout_actual',p_report_hash,p_acknowledged);
 if v.status='committed' then return v.result_job_id;end if;
 if v.context->>'estimateId'<>p_estimate_id::text then raise exception 'closeout estimate does not match reviewed import';end if;
 perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
 select coalesce(jsonb_agg(jsonb_build_object('kind',case when role='actuals' then 'actuals' else 'notes' end,'file_name',file_name,'storage_path',storage_path,'mime_type',mime_type,'size_bytes',size_bytes,'extracted_text',extracted_text)order by role,ordinal),'[]') into sources from public.import_review_files where import_review_id=p_review_id;
 v_id:=public.closeout_estimate_with_actuals(p_organization_id,p_estimate_id,p_actual_lines,p_lessons,p_outcomes,p_notes,sources,p_scope_review);
 update public.jobs set estimate_baseline_role='final_submitted' where id=v_id and organization_id=p_organization_id;
 update public.job_actual_lines l set quantity=nullif(r.value->>'quantity','')::numeric,unit=nullif(r.value->>'unit',''),normalized_unit=nullif(r.value->>'normalized_unit',''),unit_cost=nullif(r.value->>'unit_cost','')::numeric from jsonb_array_elements(p_actual_lines)r where l.id=(r.value->>'id')::uuid and l.job_id=v_id;
 perform public.store_import_provenance(p_organization_id,p_review_id,'job_actual',p_actual_provenance);
 update public.import_reviews set status='committed',acknowledged_issue_codes=p_acknowledged,result_job_id=v_id,committed_at=now() where id=p_review_id;
 return v_id;
end $$;

create function public.claim_expired_import_files(p_organization_id uuid,p_actor_user_id uuid,p_limit integer default 20)
returns table(review_id uuid,storage_path text) language plpgsql security definer set search_path='' as $$
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'not authorized';end if;
 return query with claimed as(
  select r.id from public.import_reviews r where r.organization_id=p_organization_id and r.status in('staged','expired') and r.expires_at<=now() and (r.cleanup_claimed_at is null or r.cleanup_claimed_at<now()-interval '10 minutes') order by r.expires_at for update skip locked limit least(greatest(p_limit,1),100)
 ), marked as(update public.import_reviews r set status='expired',cleanup_claimed_at=now() from claimed c where r.id=c.id returning r.id)
 select m.id,f.storage_path from marked m join public.import_review_files f on f.import_review_id=m.id;
end $$;
create function public.finish_import_cleanup(p_organization_id uuid,p_actor_user_id uuid,p_review_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not public.is_org_member_user(p_organization_id,p_actor_user_id) then raise exception 'not authorized';end if;
 update public.import_reviews set status='cleaned',cleaned_at=now() where organization_id=p_organization_id and id=any(p_review_ids) and status='expired' and not exists(select 1 from public.documents d join public.import_review_files f on f.storage_path=d.storage_path where f.import_review_id=import_reviews.id);
 get diagnostics n=row_count;return n;
end $$;

revoke all on function public.create_import_review(uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.assert_import_review(uuid,uuid,uuid,text,text,text[]) from public,anon,authenticated;
revoke all on function public.store_import_provenance(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.commit_estimate_import(uuid,uuid,uuid,text,text[],jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.commit_historical_import(uuid,uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.commit_closeout_import(uuid,uuid,uuid,text,text[],uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.claim_expired_import_files(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.finish_import_cleanup(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.create_import_review(uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz) to service_role;
grant execute on function public.commit_estimate_import(uuid,uuid,uuid,text,text[],jsonb,jsonb,jsonb) to service_role;
grant execute on function public.commit_historical_import(uuid,uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.commit_closeout_import(uuid,uuid,uuid,text,text[],uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) to service_role;
grant execute on function public.claim_expired_import_files(uuid,uuid,integer) to service_role;
grant execute on function public.finish_import_cleanup(uuid,uuid,uuid[]) to service_role;
