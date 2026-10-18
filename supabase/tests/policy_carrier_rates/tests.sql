-- 0060 carrier commission % per policy: who can set and read it, and its history. Run against a disposable
-- copy of a database with 0060 applied (test users as in the agency RLS tests: one agency with an admin (…0d) and two
-- agents (…0a, …0b); another agency with its admin (…12)). Fictional data. One transaction, rolled
-- back. Prints one PASS/FAIL line per check.
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

-- Fixture (as the SQL editor): a fictional account of Roman's in Adriatic Agency.
insert into submissions (id, user_id, organization_id, named_insured, assigned_user_id)
select 'acct_cr_1', p.user_id, p.agency_id, 'Sample Haulers (carrier rate test)', p.user_id
  from profiles p where p.user_id = '00000000-0000-0000-0000-00000000000a';
grant usage on schema public to authenticated;
set local role authenticated;

\echo '== admins set it'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('C1 the admin sets a policy''s carrier commission (12%)', not pg_temp.refused($$select public.set_policy_carrier_rate('acct_cr_1', 'pol_1', 0.12)$$));
select pg_temp.check('C2 the admin changes it (15%)', not pg_temp.refused($$select public.set_policy_carrier_rate('acct_cr_1', 'pol_1', 0.15)$$));
select pg_temp.check('C3 over 100% is refused', pg_temp.refused($$select public.set_policy_carrier_rate('acct_cr_1', 'pol_1', 1.5)$$));
select pg_temp.check('C4 negative is refused', pg_temp.refused($$select public.set_policy_carrier_rate('acct_cr_1', 'pol_1', -0.1)$$));
select pg_temp.check('C5 an account outside the agency is refused', pg_temp.refused($$select public.set_policy_carrier_rate('no_such_account', 'pol_1', 0.1)$$));
select pg_temp.check('C6 the admin reads it', (select rate = 0.15 from policy_carrier_rates where submission_id = 'acct_cr_1' and policy_id = 'pol_1'));
select pg_temp.check('C7 the history keeps both changes', (select count(*) = 2 from policy_carrier_rate_history where submission_id = 'acct_cr_1'));
select pg_temp.check('C8 the admin can''t write the table directly', pg_temp.refused($$update policy_carrier_rates set rate = 0.5$$) and pg_temp.refused($$insert into policy_carrier_rates (submission_id, policy_id, agency_id, rate) values ('acct_cr_1', 'x', public.current_agency_id(), 0.5)$$));

\echo '== agents'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('G1 the assigned agent reads the rate on their account (for their commission)', (select count(*) = 1 from policy_carrier_rates where submission_id = 'acct_cr_1'));
select pg_temp.check('G2 an agent can''t set it', pg_temp.refused($$select public.set_policy_carrier_rate('acct_cr_1', 'pol_1', 0.5)$$));
select pg_temp.check('G3 an agent can''t write the table', pg_temp.refused($$update policy_carrier_rates set rate = 0.5$$));
select pg_temp.check('G4 an agent can''t read the history', (select count(*) = 0 from policy_carrier_rate_history));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('G5 another agent (not assigned) doesn''t see it', (select count(*) = 0 from policy_carrier_rates));

\echo '== other agency, anonymous'
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check('O1 another agency''s admin doesn''t see it', (select count(*) = 0 from policy_carrier_rates));
select pg_temp.check('O2 … and can''t set it on this agency''s account', pg_temp.refused($$select public.set_policy_carrier_rate('acct_cr_1', 'pol_1', 0.5)$$));

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('D1 clearing it goes back to the 10% default (row removed, history kept)', not pg_temp.refused($$select public.set_policy_carrier_rate('acct_cr_1', 'pol_1', null)$$));
select pg_temp.check('D2 … removed', (select count(*) = 0 from policy_carrier_rates where submission_id = 'acct_cr_1') and (select count(*) = 3 from policy_carrier_rate_history where submission_id = 'acct_cr_1'));

reset role;
set local role anon;
select pg_temp.check('E1 anonymous: can''t read', pg_temp.refused($$select 1 from public.policy_carrier_rates$$));
select pg_temp.check('E2 anonymous: can''t set', pg_temp.refused($$select public.set_policy_carrier_rate('acct_cr_1', 'pol_1', 0.1)$$));
reset role;
rollback;
