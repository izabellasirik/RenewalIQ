-- 0094 links from QQCatalyst agent names to RenewalIQ agents: admins only, own agency's people only.
-- Run against a disposable copy with 0094 applied (users as in the agency RLS tests). Fictional; rolled back.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, true); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
create or replace function pg_temp.refused(sql text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return true;
end $$;
create temp table ids (name text primary key, id uuid);
insert into ids select 'other_admin', p.user_id from profiles p where p.agency_id <> (select agency_id from profiles where user_id = '00000000-0000-0000-0000-00000000000d') and p.role = 'admin' limit 1;
grant all on ids to authenticated;
grant usage on schema public to authenticated;
set local role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
insert into agency_qq_agent_links (agency_id, qq_name, user_id) values (public.current_agency_id(), 'roman sample', '00000000-0000-0000-0000-00000000000a');
select pg_temp.check('L1 an admin links a QQCatalyst name to an agent of the agency', (select count(*) = 1 from agency_qq_agent_links));
select pg_temp.check('L2 a person from another agency can''t be linked', pg_temp.refused($$insert into agency_qq_agent_links (agency_id, qq_name, user_id) values (public.current_agency_id(), 'x', (select id from ids where name = 'other_admin'))$$));
update agency_qq_agent_links set user_id = '00000000-0000-0000-0000-00000000000d' where qq_name = 'roman sample';
select pg_temp.check('L3 the admin changes the link', (select user_id = '00000000-0000-0000-0000-00000000000d' from agency_qq_agent_links));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('L4 an agent can''t see or add links', (select count(*) = 0 from agency_qq_agent_links) and pg_temp.refused($$insert into agency_qq_agent_links (agency_id, qq_name, user_id) values (public.current_agency_id(), 'y', '00000000-0000-0000-0000-00000000000a')$$));
rollback;
