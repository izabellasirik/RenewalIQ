-- 0073: the carrier % entered on each policy / endorsement. Run against a disposable copy of a database with
-- 0058, 0063, 0064 and 0067 applied, then 0073 (test users as in the agency RLS tests: admin …0d, agents …0a
-- and …0b, outsider …0c). Fictional data and rates only. One transaction, rolled back. One PASS/FAIL line each.
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
create or replace function pg_temp.agency() returns uuid language sql as $$ select agency_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d' $$;
create or replace function pg_temp.entry(id text, net bigint, bound text, carrier text) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'policyNumber', 'PN-' || id, 'carrier', carrier, 'businessType', 'new', 'boundDate', bound,
    'netPremiumCents', net, 'taxesCents', 0, 'feesCents', 0, 'createdAt', now()::text, 'updatedAt', now()::text)
$$;
create or replace function pg_temp.market(entries jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', 'q_p', 'marketName', 'Sample Market', 'status', 'bound', 'policies', entries))
$$;
create or replace function pg_temp.t(policy text) returns public.commission_transactions language sql as $$
  select * from public.commission_transactions where policy_id = policy and replaced_by is null order by created_at desc limit 1
$$;
grant usage on schema public to authenticated;
select set_config('request.jwt.claim.sub', '', true);

-- Fictional: agent …0a 25%, agent …0b 40%; the admin's rate for Sample Mutual is 12%; Other Specialty has none.
insert into public.agent_commission_rates (agency_id, user_id, rate) values
  (pg_temp.agency(), '00000000-0000-0000-0000-00000000000a', 0.25), (pg_temp.agency(), '00000000-0000-0000-0000-00000000000b', 0.40)
  on conflict (agency_id, user_id) do update set rate = excluded.rate;
insert into public.carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, effective_from) values
  (pg_temp.agency(), 'sample mutual', 'Sample Mutual', 0.12, '2026-01-01');
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_p1', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Carrier Pct One (sample)', '00000000-0000-0000-0000-00000000000a', '[]'),
  ('acct_p2', '00000000-0000-0000-0000-00000000000b', pg_temp.agency(), 'Carrier Pct Two (sample)', '00000000-0000-0000-0000-00000000000b', '[]');
create temp table out (r text);
grant all on out to authenticated;

set local role authenticated;
-- 1. The assigned agent enters 10% before saving the policy: the record uses it, flagged because the admin's rate is 12%.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into out select public.enter_policy_carrier_rate('acct_p1', 'p1', 0.10);
reset role;
update public.submissions set market_quotes = pg_temp.market(jsonb_build_array(pg_temp.entry('p1', 1000000, '2026-03-06', 'Sample Mutual'))) where id = 'acct_p1';
select pg_temp.check('P1 entered before the policy is saved → "saved"', (select r = 'saved' from out limit 1));
select pg_temp.check('P2 record uses the entered 10%: $10,000 → $1,000 carrier, agent 25% → $250', (select carrier_rate = 0.10 and carrier_rate_source = 'policy_rate' and carrier_cents = 100000 and agent_cents = 25000 from pg_temp.t('p1')));
select pg_temp.check('P3 differs from the admin''s 12% → flagged carrier_rate_differs (not blocking)', (select 'carrier_rate_differs' = any (review_flags) and not ('no_carrier_rate' = any (review_flags)) from pg_temp.t('p1'))
  and public.finance_blocking_flags(array['carrier_rate_differs']) = '{}');

-- 2. A policy saved first, for a carrier with no rate: waiting; entering 12% fills it.
update public.submissions set market_quotes = pg_temp.market(jsonb_build_array(pg_temp.entry('p1', 1000000, '2026-03-06', 'Sample Mutual'), pg_temp.entry('p2', 500000, '2026-03-06', 'Other Specialty'))) where id = 'acct_p1';
select pg_temp.check('P4 no % yet: no commission, waiting', (select 'no_carrier_rate' = any (review_flags) and agent_cents is null from pg_temp.t('p2')));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
truncate out; insert into out select public.enter_policy_carrier_rate('acct_p1', 'p2', 0.12);
reset role;
select pg_temp.check('P5 → "applied": $5,000 × 12% = $600, agent $150, no longer waiting, no mismatch (no admin rate)', (select r = 'applied' from out limit 1)
  and (select carrier_rate = 0.12 and carrier_cents = 60000 and agent_cents = 15000 and not ('no_carrier_rate' = any (review_flags)) and not ('carrier_rate_differs' = any (review_flags)) from pg_temp.t('p2')));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.enter_policy_carrier_rate('acct_p1', 'p2', 0.15) is not null as x \g /dev/null
reset role;
select pg_temp.check('P6 entering it again while unverified updates the record (15% → $750, agent $187.50)', (select carrier_rate = 0.15 and carrier_cents = 75000 and agent_cents = 18750 from pg_temp.t('p2')));
select pg_temp.check('P7 audited', exists (select 1 from public.finance_audit_log where action = 'policy_carrier_rate_set'));

-- 3. Who may set it.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('P8 another agent (not assigned) is refused', pg_temp.refused($$select public.enter_policy_carrier_rate('acct_p1', 'p1', 0.2)$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check('P9 someone outside the agency is refused', pg_temp.refused($$select public.enter_policy_carrier_rate('acct_p1', 'p1', 0.2)$$));
select pg_temp.as_user('');
select pg_temp.check('P10 signed out is refused', pg_temp.refused($$select public.enter_policy_carrier_rate('acct_p1', 'p1', 0.2)$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('P11 an admin may set it on any agency account', not pg_temp.refused($$select public.enter_policy_carrier_rate('acct_p2', 'x1', 0.11)$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('P12 0% and above 50% are refused; 50% is allowed',
  pg_temp.refused($$select public.enter_policy_carrier_rate('acct_p1', 'p9', 0)$$) and pg_temp.refused($$select public.enter_policy_carrier_rate('acct_p1', 'p9', 0.51)$$)
  and pg_temp.refused($$select public.enter_policy_carrier_rate('acct_p1', 'p9', null)$$) and not pg_temp.refused($$select public.enter_policy_carrier_rate('acct_p1', 'p9', 0.5)$$));
select pg_temp.check('P13 the entered % can''t be read or written directly (only through the function)',
  pg_temp.refused($$select * from public.policy_carrier_commission$$) and pg_temp.refused($$insert into public.policy_carrier_commission values (null, 'acct_p1', 'zz', 0.3, null, now())$$));
select pg_temp.check('P14 the record''s amounts still can''t be edited directly', pg_temp.refused($$update public.commission_transactions set carrier_rate = 0.3 where policy_id = 'p1'$$));
reset role;

-- 4. A verified record keeps its rate.
update public.commission_transactions set verification_status = 'verified', verified_at = now() where id = (pg_temp.t('p1')).id;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
truncate out; insert into out select public.enter_policy_carrier_rate('acct_p1', 'p1', 0.3);
reset role;
select pg_temp.check('P15 verified → "locked", rate and amounts unchanged, entered % unchanged', (select r = 'locked' from out limit 1)
  and (select carrier_rate = 0.10 and agent_cents = 25000 from pg_temp.t('p1'))
  and (select rate = 0.10 from public.policy_carrier_commission where submission_id = 'acct_p1' and policy_id = 'p1'));

-- 5. A policy without an entered % works exactly as before (the admin's rate).
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_p3', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Carrier Pct Three (sample)', '00000000-0000-0000-0000-00000000000a',
   pg_temp.market(jsonb_build_array(pg_temp.entry('p3', 1000000, '2026-03-06', 'Sample Mutual'))));
select pg_temp.check('P16 no entered % → the carrier''s 12%, source carrier_rate, agent 25% → $300', (select carrier_rate = 0.12 and carrier_rate_source = 'carrier_rate' and agent_cents = 30000 from pg_temp.t('p3')));
rollback;
