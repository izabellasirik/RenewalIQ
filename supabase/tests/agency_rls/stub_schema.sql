create schema auth; create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
grant usage on schema public, auth, storage to authenticated;
grant all on storage.objects to authenticated;
-- 0001 bits 0011's setup script touches
create table admin_users (user_id uuid primary key references auth.users(id), email text not null);
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000d','denis@agency.com'),
 ('00000000-0000-0000-0000-00000000000a','roman@agency.com'),
 ('00000000-0000-0000-0000-00000000000b','agentb@agency.com'),
 ('00000000-0000-0000-0000-00000000000c','outsider@other.com'),
 ('00000000-0000-0000-0000-00000000000e','newbie@agency.com');
