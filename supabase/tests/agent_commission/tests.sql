-- 0058 agent commission: who can read and set rates, the change history, and the policy-number check.
-- Run against a disposable copy of a database with 0058 applied (agencies and users as in the agency RLS
-- tests: Adriatic Agency — Denis admin, Roman and Agent B agents; Other Co — QA1 admin). Fictional data.
-- Everything runs in one transaction and is rolled back. Prints one PASS/FAIL line per check.
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

-- Fixture (as the SQL editor): a fictional account of Roman's in Adriatic Agency with a policy, a removed
-- one, and an endorsement with another number.
insert into submissions (id, user_id, organization_id, named_insured, assigned_user_id)
select 'acct_ac_multi', p.user_id, p.agency_id, 'Sample Haulers (commission test)', p.user_id
  from profiles p where p.user_id = '00000000-0000-0000-0000-00000000000a';
update submissions set market_quotes = '[{"id":"q_ac1","marketName":"Prairie Mutual (sample)","status":"bound","notes":[],"policies":[
  {"id":"p1","carrier":"Prairie Mutual (sample)","policyNumber":"SMP-AL-1001","businessType":"new","boundDate":"2026-10-01","netPremiumCents":1000000,"taxesCents":0,"feesCents":0},
  {"id":"p2","carrier":"Prairie Mutual (sample)","policyNumber":"SMP-OLD-9","businessType":"new","boundDate":"2026-10-01","netPremiumCents":1,"taxesCents":0,"feesCents":0,"removedAt":"2026-10-02T00:00:00Z"},
  {"id":"e1","kind":"endorsement","carrier":"Prairie Mutual (sample)","policyNumber":"SMP-END-7","businessType":"new","boundDate":"2026-10-05","netPremiumCents":-5000,"taxesCents":0,"feesCents":0}]}]'::jsonb
 where id = 'acct_ac_multi';

grant usage on schema public to authenticated;
set local role authenticated;

\echo '== rates: admins set them; agents can't'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('A1 the admin sets Roman''s rate (10%)', not pg_temp.refused($$select public.set_agent_commission_rate('00000000-0000-0000-0000-00000000000a', 0.10)$$));
select pg_temp.check('A2 the admin sets Agent B''s rate (12.5%)', not pg_temp.refused($$select public.set_agent_commission_rate('00000000-0000-0000-0000-00000000000b', 0.125)$$));
select pg_temp.check('A3 the admin changes Roman''s rate (to 15%)', not pg_temp.refused($$select public.set_agent_commission_rate('00000000-0000-0000-0000-00000000000a', 0.15)$$));
select pg_temp.check('A4 a rate over 100% is refused', pg_temp.refused($$select public.set_agent_commission_rate('00000000-0000-0000-0000-00000000000a', 1.5)$$));
select pg_temp.check('A5 a negative rate is refused', pg_temp.refused($$select public.set_agent_commission_rate('00000000-0000-0000-0000-00000000000a', -0.1)$$));
select pg_temp.check('A6 someone from another agency can''t be given a rate', pg_temp.refused($$select public.set_agent_commission_rate('00000000-0000-0000-0000-000000000012', 0.1)$$));
select pg_temp.check('A7 the admin reads every rate in the agency', (select count(*) from agent_commission_rates) = 2);
select pg_temp.check('A8 the admin reads the change history (3 changes)', (select count(*) from agent_commission_rate_history) = 3);
select pg_temp.check('A9 history keeps old and new values', exists (select 1 from agent_commission_rate_history where user_id = '00000000-0000-0000-0000-00000000000a' and old_rate = 0.10 and new_rate = 0.15 and changed_by = '00000000-0000-0000-0000-00000000000d'));

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('B1 an agent can''t set a rate (not even their own)', pg_temp.refused($$select public.set_agent_commission_rate('00000000-0000-0000-0000-00000000000a', 0.9)$$));
select pg_temp.check('B2 an agent sees only their own rate', (select string_agg(rate::text, ',') from agent_commission_rates) = '0.150000');
select pg_temp.check('B3 an agent can''t write the table directly', pg_temp.refused($$update agent_commission_rates set rate = 0.9$$) and pg_temp.refused($$insert into agent_commission_rates (agency_id, user_id, rate) values (public.current_agency_id(), auth.uid(), 0.9)$$));
select pg_temp.check('B4 an agent can''t read the history', (select count(*) from agent_commission_rate_history) = 0);
select pg_temp.check('B5 an agent can''t delete a rate', pg_temp.refused($$delete from agent_commission_rates$$));

select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check('C1 another agency''s admin sees none of these rates', (select count(*) from agent_commission_rates) = 0);
select pg_temp.check('C2 … and can''t set them', pg_temp.refused($$select public.set_agent_commission_rate('00000000-0000-0000-0000-00000000000a', 0.5)$$));

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('A10 the admin clears a rate', not pg_temp.refused($$select public.set_agent_commission_rate('00000000-0000-0000-0000-00000000000b', null)$$));
-- (a separate statement: a check in the same statement wouldn't see the change)
select pg_temp.check('A11 … it''s gone, and the history records the clearing', (select count(*) from agent_commission_rates) = 1 and exists (select 1 from agent_commission_rate_history where user_id = '00000000-0000-0000-0000-00000000000b' and new_rate is null));

\echo '== policy numbers: one policy, agency-wide'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('D0 Agent B can''t open Roman''s account', not exists (select 1 from submissions where id = 'acct_ac_multi'));
select pg_temp.check('D1 Agent B (can''t open Roman''s account) learns the number is taken on another client', public.policy_number_taken('Prairie Mutual (sample)', 'smp al 1001', 'acct_ac_other'));
select pg_temp.check('D2 a different carrier: not taken', not public.policy_number_taken('Other Carrier (sample)', 'SMP-AL-1001', 'acct_ac_other'));
select pg_temp.check('D3 a removed policy doesn''t count', not public.policy_number_taken('Prairie Mutual (sample)', 'SMP-OLD-9', 'acct_ac_other'));
select pg_temp.check('D4 an endorsement''s number doesn''t count as a policy', not public.policy_number_taken('Prairie Mutual (sample)', 'SMP-END-7', 'acct_ac_other'));
select pg_temp.check('D5 the same account is left out (editing its own policy)', not public.policy_number_taken('Prairie Mutual (sample)', 'SMP-AL-1001', 'acct_ac_multi'));
select pg_temp.check('D6 a blank number is never taken', not public.policy_number_taken('Prairie Mutual (sample)', ' - ', 'acct_ac_other'));
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check('D7 another agency doesn''t see it', not public.policy_number_taken('Prairie Mutual (sample)', 'SMP-AL-1001', 'x'));

reset role;
set local role anon;
select pg_temp.check('E1 anonymous: can''t read rates', pg_temp.refused($$select 1 from public.agent_commission_rates$$));
select pg_temp.check('E2 anonymous: can''t call the policy-number check', pg_temp.refused($$select public.policy_number_taken('a', 'b', 'c')$$));
select pg_temp.check('E3 anonymous: can''t set a rate', pg_temp.refused($$select public.set_agent_commission_rate('00000000-0000-0000-0000-00000000000a', 0.5)$$));
reset role;
rollback;
