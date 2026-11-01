-- 0088: an agent's raise doesn't change commissions on policies written before it. Run against a disposable copy of a
-- database with 0058, 0063, 0064, 0067, 0073, 0075, 0076, 0077 and 0088 applied (admin …0d, agent …0a).
-- Fictional data and rates only. One transaction, rolled back. One PASS/FAIL line each.
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
create or replace function pg_temp.entry(id text, net bigint, extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'policyNumber', 'PN-' || id, 'carrier', 'Sample Mutual', 'businessType', 'new', 'boundDate', '2025-12-20',
    'netPremiumCents', net, 'taxesCents', 0, 'feesCents', 0, 'createdAt', now()::text, 'updatedAt', now()::text) || extra
$$;
create or replace function pg_temp.t(policy text) returns public.commission_transactions language sql as $$
  select * from public.commission_transactions where policy_id = policy and replaced_by is null order by created_at desc limit 1
$$;
create or replace function pg_temp.cx(orig uuid) returns public.commission_transactions language sql as $$
  select * from public.commission_transactions where original_transaction_id = orig and kind = 'cancellation' and verification_status <> 'void' order by created_at desc limit 1
$$;
grant usage on schema public to authenticated;
select set_config('request.jwt.claim.sub', '', true);
-- The agent is at 30% when the policy is written.
insert into public.agent_commission_rates (agency_id, user_id, rate) values (pg_temp.agency(), '00000000-0000-0000-0000-00000000000a', 0.30)
  on conflict (agency_id, user_id) do update set rate = excluded.rate;
insert into public.carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, effective_from) values (pg_temp.agency(), 'sample mutual', 'Sample Mutual', 0.10, '2025-01-01');
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_kr', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Keeps Rate Test (sample)', '00000000-0000-0000-0000-00000000000a',
   jsonb_build_array(jsonb_build_object('id', 'q_kr', 'marketName', 'Sample Market', 'status', 'bound', 'policies', jsonb_build_array(
     pg_temp.entry('kr1', 1000000, '{"effectiveDate": "2026-01-01", "expirationDate": "2027-01-01"}')))));
select pg_temp.check('K1 the policy is recorded at 30%: $10,000 × 10% × 30% = $300', (select agent_rate = 0.30 and agent_cents = 30000 from pg_temp.t('kr1')));
-- Promoted to 40%.
update public.agent_commission_rates set rate = 0.40 where user_id = '00000000-0000-0000-0000-00000000000a' and agency_id = pg_temp.agency();
-- An endorsement on the old policy, and a new policy.
update public.submissions set market_quotes = jsonb_build_array(jsonb_build_object('id', 'q_kr', 'marketName', 'Sample Market', 'status', 'bound', 'policies', jsonb_build_array(
     pg_temp.entry('kr1', 1000000, '{"effectiveDate": "2026-01-01", "expirationDate": "2027-01-01"}'),
     pg_temp.entry('kr1e', 200000, '{"kind": "endorsement", "boundDate": "2026-06-01", "forPolicyId": "kr1"}'),
     pg_temp.entry('kr2', 1000000, '{"boundDate": "2026-06-01", "effectiveDate": "2026-06-01"}'))))
 where id = 'acct_kr';
select pg_temp.check('K2 the old policy keeps 30%', (select agent_rate = 0.30 and agent_cents = 30000 from pg_temp.t('kr1')));
select pg_temp.check('K3 an endorsement on the old policy uses its 30%: $2,000 × 10% × 30% = $60', (select agent_rate = 0.30 and agent_cents = 6000 from pg_temp.t('kr1e')));
select pg_temp.check('K4 a new policy uses 40%: $10,000 × 10% × 40% = $400', (select agent_rate = 0.40 and agent_cents = 40000 from pg_temp.t('kr2')));
select (pg_temp.t('kr1')).id as p1 \gset
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.cancel_policy_commission(:'p1', 'partial', '2026-07-01', 'Two trucks sold (sample)', 500000) is not null as x \g /dev/null
reset role;
select pg_temp.check('K5 cancelling the old policy refunds at 30%: −$5,000 × 10% × 30% = −$150', (select agent_rate = 0.30 and agent_cents = -15000 from pg_temp.cx(:'p1')));
select pg_temp.check('K6 the account''s commission list gives each record''s agent %', (select bool_and(agent_rate is not null) from public.account_commission_statuses('acct_kr')) is not false);
rollback;
