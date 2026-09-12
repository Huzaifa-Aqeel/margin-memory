-- One explicit vector space per workspace. Existing OpenAI vectors keep their legacy identity.
create table public.embedding_spaces(
 organization_id uuid primary key references public.organizations(id),
 provider text not null, model text not null, dimensions integer not null check(dimensions=1536),
 created_at timestamptz not null default now()
);
alter table public.embedding_spaces enable row level security;
create policy embedding_space_read on public.embedding_spaces for select to authenticated using(public.is_org_member(organization_id));
revoke all on public.embedding_spaces from anon,authenticated;
grant select on public.embedding_spaces to authenticated;
insert into public.embedding_spaces(organization_id,provider,model,dimensions)
select distinct organization_id,'openai','text-embedding-3-small',1536 from (
 select organization_id from public.lessons where embedding is not null
 union select organization_id from public.job_search_documents where embedding is not null
) legacy;
create function public.ensure_embedding_space(p_organization_id uuid,p_provider text,p_model text,p_dimensions integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_org_member(p_organization_id) then raise exception 'not authorized'; end if;
 if p_provider<>'bedrock' or p_model<>'cohere.embed-v4:0' or p_dimensions<>1536 then raise exception 'unsupported embedding space'; end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 insert into public.embedding_spaces(organization_id,provider,model,dimensions) values(p_organization_id,p_provider,p_model,p_dimensions) on conflict do nothing;
 if not exists(select 1 from public.embedding_spaces where organization_id=p_organization_id and provider=p_provider and model=p_model and dimensions=p_dimensions) then raise exception 'embedding model mismatch: explicitly clear and reindex legacy vectors before changing model'; end if;
end; $$;
revoke execute on function public.ensure_embedding_space(uuid,text,text,integer) from public,anon;
grant execute on function public.ensure_embedding_space(uuid,text,text,integer) to authenticated;
