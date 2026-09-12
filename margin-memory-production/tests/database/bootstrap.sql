-- Minimal Supabase-compatible roles/auth/storage for real Postgres RLS tests.
-- This is not a replacement for testing hosted Auth, PostgREST and Storage HTTP APIs.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema extensions;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth,extensions,storage to anon,authenticated,service_role;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),name text,bucket_id text);
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
