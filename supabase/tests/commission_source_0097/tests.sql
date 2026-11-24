-- 0097 commission source: policies by default; only an agency's admin changes it, for their own agency.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, true); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
create or replace function pg_temp.refused(sql text) returns boolean language plpgsql as $$ begin execute sql; return false; exception when others then return true; end $$;
create temp table ids (name text primary key, id uuid);
insert into ids select 'other_admin', p.user_id from profiles p where p.agency_id <> (select agency_id from profiles where user_id = '00000000-0000-0000-0000-00000000000d') and p.role = 'admin' limit 1;
grant all on ids to authenticated;
grant usage on schema public to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('C1 policies by default', public.agency_commission_source() = 'policies');
select pg_temp.check('C2 the admin switches to statements', public.set_agency_commission_source('statements') = 'statements');
select pg_temp.check('C2b … and it reads back as statements', public.agency_commission_source() = 'statements');
select pg_temp.check('C3 an unknown setting is refused', pg_temp.refused($$select public.set_agency_commission_source('bank')$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('C4 an agent of the agency reads it', public.agency_commission_source() = 'statements');
select pg_temp.check('C5 an agent can''t change it', pg_temp.refused($$select public.set_agency_commission_source('policies')$$));
select pg_temp.as_user((select id::text from ids where name = 'other_admin'));
select pg_temp.check('C6 another agency still has its own (policies)', public.agency_commission_source() = 'policies');
rollback;
