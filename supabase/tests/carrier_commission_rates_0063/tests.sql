-- 0063 carrier commission % per carrier: who can set and read it, that it is one rate per carrier however
-- the name is typed, and its history. Run against a disposable copy of a database with 0063 applied (test
-- users as in the agency RLS tests: one agency with an admin (…0d) and two agents (…0a, …0b); another
-- agency with its admin (…12)). Fictional data. One transaction, rolled back. Prints one PASS/FAIL line
-- per check.
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
grant usage on schema public to authenticated;
set local role authenticated;

\echo '== admins set it, per carrier'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('C1 the admin sets a carrier''s commission (12%)', not pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 0.12)$$));
select pg_temp.check('C2 the same carrier typed differently changes the same rate (15%)', not pg_temp.refused($$select public.set_carrier_commission_rate('  sample   MUTUAL ', 0.15)$$));
select pg_temp.check('C3 one row for that carrier, at 15%', (select count(*) = 1 and min(rate) = 0.15 from carrier_commission_rates where carrier_key = 'sample mutual'));
select pg_temp.check('C4 over 100% / negative / no name is refused', pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 1.5)$$) and pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', -0.1)$$) and pg_temp.refused($$select public.set_carrier_commission_rate('   ', 0.1)$$));
select pg_temp.check('C5 the history keeps both changes', (select count(*) = 2 from carrier_commission_rate_history where carrier_key = 'sample mutual'));
select pg_temp.check('C6 the admin can''t write the tables directly', pg_temp.refused($$update carrier_commission_rates set rate = 0.5$$) and pg_temp.refused($$insert into carrier_commission_rates (agency_id, carrier_key, carrier_name, rate) values (public.current_agency_id(), 'x', 'x', 0.5)$$) and pg_temp.refused($$delete from carrier_commission_rate_history$$));
select pg_temp.check('C7 another carrier has its own rate', not pg_temp.refused($$select public.set_carrier_commission_rate('Other Specialty', 0.08)$$));
select pg_temp.check('C7b … two carriers, two rates', (select count(*) = 2 and count(distinct rate) = 2 from carrier_commission_rates where carrier_key in ('sample mutual', 'other specialty')));

select pg_temp.check('A1 the admin still reads 0060''s per-policy rates (where 0060 is applied)', to_regclass('public.policy_carrier_rates') is null or (select count(*) >= 1 from public.policy_carrier_rates));

\echo '== agents (carrier agreements are confidential)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('G1 an agent can''t read the rates or their history', (select count(*) = 0 from carrier_commission_rates) and (select count(*) = 0 from carrier_commission_rate_history));
select pg_temp.check('G1b an agent can''t read 0060''s per-policy rates either, even on their own accounts', to_regclass('public.policy_carrier_rates') is null or (select count(*) = 0 from public.policy_carrier_rates));
select pg_temp.check('G2 an agent can''t set or write them', pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 0.5)$$) and pg_temp.refused($$update carrier_commission_rates set rate = 0.5$$));

\echo '== other agency, anonymous'
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check('O1 another agency''s admin doesn''t see them', (select count(*) = 0 from carrier_commission_rates) and (select count(*) = 0 from carrier_commission_rate_history));
select pg_temp.check('O2 … and setting the same carrier makes their own row, not ours', not pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 0.2)$$));
select pg_temp.check('O2b … they see only their own', (select count(*) = 1 and min(rate) = 0.2 from carrier_commission_rates));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('O3 ours is unchanged (15%)', (select rate = 0.15 from carrier_commission_rates where carrier_key = 'sample mutual'));

select pg_temp.check('D1 clearing it goes back to the 10% default (row removed, history kept)', not pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', null)$$));
select pg_temp.check('D2 … removed', (select count(*) = 0 from carrier_commission_rates where carrier_key = 'sample mutual') and (select count(*) = 3 from carrier_commission_rate_history where carrier_key = 'sample mutual'));

reset role;
set local role anon;
select pg_temp.check('E1 anonymous: can''t read', pg_temp.refused($$select 1 from public.carrier_commission_rates$$));
select pg_temp.check('E2 anonymous: can''t set', pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 0.1)$$));
reset role;
rollback;
