-- Titan G1 has the same dimensions but a different vector space. Never mix models.
create or replace function public.ensure_embedding_space(p_organization_id uuid,p_provider text,p_model text,p_dimensions integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
 if p_provider is distinct from 'bedrock' or p_model is null or p_model not in ('cohere.embed-v4:0','amazon.titan-embed-text-v1') or p_dimensions is distinct from 1536 then raise exception 'unsupported embedding space'; end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 insert into public.embedding_spaces(organization_id,provider,model,dimensions) values(p_organization_id,p_provider,p_model,p_dimensions) on conflict do nothing;
 if not exists(select 1 from public.embedding_spaces where organization_id=p_organization_id and provider=p_provider and model=p_model and dimensions=p_dimensions) then raise exception 'embedding model mismatch: explicitly clear and reindex legacy vectors before changing model'; end if;
end; $$;
revoke execute on function public.ensure_embedding_space(uuid,text,text,integer) from public,anon;
grant execute on function public.ensure_embedding_space(uuid,text,text,integer) to authenticated;
