-- The estimate is the shared serialization boundary for learning decisions.
-- SECURITY DEFINER is needed because direct outcome writes are revoked.
create or replace function public.confirm_finding_outcome(
 p_organization_id uuid, p_outcome_id uuid, p_verdict text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_estimate_id uuid; v_stage text; v_existing text;
begin
 if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
 if p_verdict is null or p_verdict not in ('validated','partially_validated','not_observed','not_evaluable') then raise exception 'invalid finding outcome verdict'; end if;
 select estimate_id into v_estimate_id from public.finding_outcomes where id=p_outcome_id and organization_id=p_organization_id;
 if v_estimate_id is null then raise exception 'finding outcome not found'; end if;
 -- Lock parent first, then read the current outcome. Matches finalization's lock order.
 select lifecycle_status into v_stage from public.estimates where id=v_estimate_id and organization_id=p_organization_id for update;
 select confirmed_verdict into v_existing from public.finding_outcomes where id=p_outcome_id and organization_id=p_organization_id for update;
 if v_stage='learned' and v_existing=p_verdict then return v_estimate_id; end if;
 if v_stage<>'learning_review' then raise exception 'warning outcomes can only be confirmed during learning review'; end if;
 update public.finding_outcomes set confirmed_verdict=p_verdict,confirmed_at=now(),updated_at=now() where id=p_outcome_id and organization_id=p_organization_id;
 return v_estimate_id;
end;
$$;
