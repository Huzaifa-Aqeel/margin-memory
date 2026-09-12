-- Imported financial history may only enter through trusted server code. The
-- review-bound commit functions in 017 call these primitives as their owner;
-- authenticated browser clients cannot invoke the primitives directly.

create function public.create_estimate_server(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_estimate jsonb,
  p_lines jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not public.is_org_member_user(p_organization_id,p_actor_user_id) then
    raise exception 'actor is not a member';
  end if;
  perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  return public.create_estimate_with_lines(
    p_estimate || jsonb_build_object('organization_id',p_organization_id),
    p_lines
  );
end $$;

create function public.create_completed_job_server(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_job jsonb,
  p_estimate_lines jsonb,
  p_actual_lines jsonb,
  p_variances jsonb,
  p_lessons jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not public.is_org_member_user(p_organization_id,p_actor_user_id) then
    raise exception 'actor is not a member';
  end if;
  perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  return public.create_completed_job(
    p_job || jsonb_build_object('organization_id',p_organization_id),
    p_estimate_lines,p_actual_lines,p_variances,p_lessons
  );
end $$;

create function public.closeout_estimate_server(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_estimate_id uuid,
  p_actual_lines jsonb,
  p_lessons jsonb,
  p_outcomes jsonb,
  p_closeout_notes text,
  p_source_documents jsonb,
  p_scope_review jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not public.is_org_member_user(p_organization_id,p_actor_user_id) then
    raise exception 'actor is not a member';
  end if;
  perform set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  return public.closeout_estimate_with_actuals(
    p_organization_id,p_estimate_id,p_actual_lines,p_lessons,p_outcomes,
    p_closeout_notes,p_source_documents,p_scope_review
  );
end $$;

revoke all on function public.create_estimate_with_lines(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.create_completed_job(jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.closeout_estimate_with_actuals(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_estimate_with_lines(jsonb,jsonb) to service_role;
grant execute on function public.create_completed_job(jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.closeout_estimate_with_actuals(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) to service_role;

revoke all on function public.create_estimate_server(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.create_completed_job_server(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.closeout_estimate_server(uuid,uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_estimate_server(uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.create_completed_job_server(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.closeout_estimate_server(uuid,uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) to service_role;

-- A successful reviewed commit must account for every normalized financial
-- line and must point it to the reviewed source role, worksheet and parser.
create function public.guard_committed_import_provenance() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status<>'committed' or old.status='committed' then return new; end if;

  if new.import_kind='new_estimate' then
    if new.result_estimate_id is null or exists(
      select 1 from public.estimate_lines l
      left join public.import_line_provenance p
        on p.import_review_id=new.id and p.estimate_line_id=l.id
      where l.organization_id=new.organization_id and l.estimate_id=new.result_estimate_id and p.id is null
    ) then raise exception 'every imported estimate line requires provenance'; end if;
  elsif new.import_kind='historical_job' then
    if new.result_job_id is null or exists(
      select 1 from public.job_estimate_lines l
      left join public.import_line_provenance p
        on p.import_review_id=new.id and p.job_estimate_line_id=l.id
      where l.organization_id=new.organization_id and l.job_id=new.result_job_id and p.id is null
    ) or exists(
      select 1 from public.job_actual_lines l
      left join public.import_line_provenance p
        on p.import_review_id=new.id and p.job_actual_line_id=l.id
      where l.organization_id=new.organization_id and l.job_id=new.result_job_id and p.id is null
    ) then raise exception 'every imported historical line requires provenance'; end if;
  elsif new.import_kind='closeout_actual' then
    if new.result_job_id is null or exists(
      select 1 from public.job_actual_lines l
      left join public.import_line_provenance p
        on p.import_review_id=new.id and p.job_actual_line_id=l.id
      where l.organization_id=new.organization_id and l.job_id=new.result_job_id and p.id is null
    ) then raise exception 'every imported actual line requires provenance'; end if;
  end if;

  if exists(
    select 1
    from public.import_line_provenance p
    join public.import_review_files f on f.id=p.import_review_file_id and f.import_review_id=new.id
    where p.import_review_id=new.id and (
      p.organization_id<>new.organization_id or p.parser_version<>new.parser_version or
      p.worksheet is distinct from f.worksheet or
      (p.estimate_line_id is not null and (f.role<>'estimate' or not exists(select 1 from public.estimate_lines l where l.id=p.estimate_line_id and l.estimate_id=new.result_estimate_id))) or
      (p.job_estimate_line_id is not null and (f.role<>'estimate' or new.import_kind<>'historical_job' or not exists(select 1 from public.job_estimate_lines l where l.id=p.job_estimate_line_id and l.job_id=new.result_job_id))) or
      (p.job_actual_line_id is not null and (f.role<>'actuals' or new.import_kind not in('historical_job','closeout_actual') or not exists(select 1 from public.job_actual_lines l where l.id=p.job_actual_line_id and l.job_id=new.result_job_id)))
    )
  ) then raise exception 'import provenance does not match the reviewed source or committed result'; end if;
  return new;
end $$;

create trigger committed_import_provenance_guard
before update of status on public.import_reviews
for each row execute function public.guard_committed_import_provenance();
