-- Prevent duplicate transport retries from running the same investigation lease twice.
alter table public.investigations add column execution_claimed_at timestamptz;
create function public.claim_investigation_execution(p_organization_id uuid,p_estimate_id uuid,p_investigation_id uuid,p_actor_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id) then raise exception 'not authorized'; end if;
 perform 1 from public.estimates where id=p_estimate_id and organization_id=p_organization_id for update;
 update public.investigations set execution_claimed_at=clock_timestamp()
 where id=p_investigation_id and estimate_id=p_estimate_id and organization_id=p_organization_id and status='investigating' and lease_expires_at>clock_timestamp() and execution_claimed_at is null;
 if not found then raise exception using message='execution_already_claimed_or_expired',errcode='55P03'; end if;
end; $$;
revoke execute on function public.claim_investigation_execution(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_investigation_execution(uuid,uuid,uuid,uuid) to service_role;
