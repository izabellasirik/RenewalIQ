-- 0074: reading the entered carrier % and the admin's check. Run against a disposable copy of a database with
-- 0073 and 0074 applied (test users as in the agency RLS tests: admin …0d, agents …0a and …0b, outsider …0c).
-- Fictional data only. One transaction, rolled back. One PASS/FAIL line each.
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
select set_config('request.jwt.claim.sub', '', true);
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes)
select 'acct_rv1', '00000000-0000-0000-0000-00000000000a', agency_id, 'Review One (sample)', '00000000-0000-0000-0000-00000000000a', '[]'
  from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d';
create temp table out (r text);
grant all on out to authenticated;
set local role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.enter_policy_carrier_rate('acct_rv1', 'r1', 0.12) is not null as x \g /dev/null
select pg_temp.check('R1 the assigned agent reads the entered %, not checked yet', (select count(*) = 1 and bool_and(rate = 0.12 and not reviewed) from public.policy_carrier_rates('acct_rv1')));
select pg_temp.check('R2 the agent can''t check it', pg_temp.refused($$select public.review_policy_carrier_rate('acct_rv1', 'r1', true)$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('R3 another agent sees nothing', (select count(*) = 0 from public.policy_carrier_rates('acct_rv1')) and (select count(*) = 0 from public.policy_carrier_rates()));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check('R4 someone outside the agency sees nothing and can''t check', (select count(*) = 0 from public.policy_carrier_rates()) and pg_temp.refused($$select public.review_policy_carrier_rate('acct_rv1', 'r1', true)$$));
select pg_temp.as_user('');
select pg_temp.check('R5 signed out sees nothing', (select count(*) = 0 from public.policy_carrier_rates()));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.review_policy_carrier_rate('acct_rv1', 'r1', true) \g /dev/null
select pg_temp.check('R6 the admin checks it → Verified, seen by the agent too', (select bool_and(reviewed) from public.policy_carrier_rates('acct_rv1')));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('R6b … the agent sees it checked', (select bool_and(reviewed) from public.policy_carrier_rates()));
select public.enter_policy_carrier_rate('acct_rv1', 'r1', 0.12) is not null as x \g /dev/null
select pg_temp.check('R7 entering the same % keeps the check', (select bool_and(reviewed) from public.policy_carrier_rates('acct_rv1')));
select public.enter_policy_carrier_rate('acct_rv1', 'r1', 0.15) is not null as x \g /dev/null
select pg_temp.check('R8 a different % needs checking again', (select bool_and(not reviewed and rate = 0.15) from public.policy_carrier_rates('acct_rv1')));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.review_policy_carrier_rate('acct_rv1', 'r1', true) \g /dev/null
select public.review_policy_carrier_rate('acct_rv1', 'r1', false) \g /dev/null
select pg_temp.check('R9 the admin can untick it', (select bool_and(not reviewed) from public.policy_carrier_rates('acct_rv1')));
select pg_temp.check('R10 checking a policy without an entered % is refused', pg_temp.refused($$select public.review_policy_carrier_rate('acct_rv1', 'nope', true)$$));
select pg_temp.check('R11 the table itself stays unreadable', pg_temp.refused($$select * from public.policy_carrier_commission$$));
reset role;
select pg_temp.check('R12 audited', exists (select 1 from public.finance_audit_log where action = 'policy_carrier_rate_checked'));
rollback;
