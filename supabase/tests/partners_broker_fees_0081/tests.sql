-- 0081: partnerships, referral sources and broker fee splits. Run against a disposable copy of a database with
-- 0011, 0058, 0064 and 0081 applied (test users as in the agency RLS tests: admin …0d, agents …0a and …0b).
-- Fictional partners, clients and amounts only. One transaction, rolled back. One PASS/FAIL line each.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
create or replace function pg_temp.refused(sql text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return true;
end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, true); end $$;
create or replace function pg_temp.agency() returns uuid language sql as $$ select agency_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d' $$;
create or replace function pg_temp.pol(id text, bound text, fee bigint, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'policyNumber', 'BF-' || id, 'carrier', 'Sample Mutual', 'businessType', 'new', 'boundDate', bound, 'effectiveDate', bound,
    'netPremiumCents', 500000, 'taxesCents', 0, 'feesCents', 0, 'brokerFeeCents', fee, 'createdAt', bound, 'updatedAt', bound) || extra
$$;
create temp table out (k text, v text);
grant all on out to authenticated;
grant usage on schema public to authenticated;

set local role authenticated;
-- 1. Partnerships: admins manage them; names unique; "No referral" is reserved; agents can't.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
insert into out select 'safety', public.save_referral_source(null, 'Safety', 5000, true)::text;
insert into out select 'dxp', public.save_referral_source(null, 'DXP agency', null, true)::text;
select pg_temp.check('B1 admin adds partners (Safety $50, DXP agency with no amount)', (select count(*) = 2 from out));
select pg_temp.check('B1b a second "safety" and "No referral" are refused', pg_temp.refused($$select public.save_referral_source(null, ' safety ', 1000, true)$$)
  and pg_temp.refused($$select public.save_referral_source(null, 'No referral', null, true)$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select pg_temp.check('B2 an agent can''t add a partner', pg_temp.refused($$select public.save_referral_source(null, 'Agent Pal', 100, true)$$));
select pg_temp.check('B2b … sees the names to pick from, never the amounts', (select count(*) = 2 from public.referral_source_names())
  and (select count(*) = 0 from public.referral_sources));

-- 2. Broker fee shares: set by an admin ($ or %); agents read only their own.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select public.set_agent_broker_fee_share('00000000-0000-0000-0000-00000000000a', 'percent', 0.5) \g /dev/null
select public.set_agent_broker_fee_share('00000000-0000-0000-0000-00000000000d', 'amount', 10000) \g /dev/null
select pg_temp.check('B3 admin sets Agent A 50%, themselves $100; a % over 100 is refused', (select count(*) = 2 from public.agent_broker_fee_shares)
  and pg_temp.refused($$select public.set_agent_broker_fee_share('00000000-0000-0000-0000-00000000000a', 'percent', 1.5)$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select pg_temp.check('B3b an agent sees only their own share and can''t change shares', (select count(*) = 1 and bool_and(user_id = '00000000-0000-0000-0000-00000000000a') from public.agent_broker_fee_shares)
  and pg_temp.refused($$select public.set_agent_broker_fee_share('00000000-0000-0000-0000-00000000000a', 'percent', 1)$$));
reset role;

-- 3. Agent A's client, referred by Safety: two policies with a broker fee, an endorsement, a deleted policy.
select pg_temp.as_user('') \g /dev/null
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, referral_source, market_quotes) values
  ('bf_a', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Broker Fee Client A (sample)', '00000000-0000-0000-0000-00000000000a', (select v from out where k = 'safety'),
   jsonb_build_array(jsonb_build_object('id', 'q', 'marketName', 'Sample Mutual', 'status', 'bound', 'policies', jsonb_build_array(
     pg_temp.pol('a1', '2026-09-01', 35000), pg_temp.pol('a2', '2026-10-01', 20000),
     pg_temp.pol('a3', '2026-10-05', 9900, '{"kind":"endorsement","forPolicyId":"a1"}'), pg_temp.pol('a4', '2026-10-06', 50000, '{"removedAt":"2026-10-07"}'))))),
  ('bf_b', '00000000-0000-0000-0000-00000000000d', pg_temp.agency(), 'Broker Fee Client B (sample)', '00000000-0000-0000-0000-00000000000d', 'none',
   jsonb_build_array(jsonb_build_object('id', 'q', 'marketName', 'Sample Mutual', 'status', 'bound', 'policies', jsonb_build_array(pg_temp.pol('b1', '2026-10-10', 35000), pg_temp.pol('b2', '2026-10-11', 5000)))));
select pg_temp.check('B4 an account''s referral must be a source id or "none"', pg_temp.refused($$update public.submissions set referral_source = 'Safety' where id = 'bf_a'$$));

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('B5 admin: $350 → Safety $50 (first policy only), Agent A 50% of $300 = $150, agency $150',
  (select partner_name = 'Safety' and partner_cents = 5000 and agent_cents = 15000 and agency_cents = 15000 and broker_fee_cents = 35000 from public.broker_fee_splits('2026-09-01', '2026-10-31') where policy_id = 'a1'));
select pg_temp.check('B6 the client''s second policy: no partner share again; $200 → agent $100, agency $100',
  (select partner_cents = 0 and agent_cents = 10000 and agency_cents = 10000 from public.broker_fee_splits('2026-09-01', '2026-10-31') where policy_id = 'a2'));
select pg_temp.check('B7 endorsements and deleted policies have no broker fee split', not exists (select 1 from public.broker_fee_splits('2026-09-01', '2026-10-31') where policy_id in ('a3', 'a4')));
select pg_temp.check('B8 no referral: the admin (as the agent) gets the agreed $100, agency the rest ($250); a $50 fee gives the agent at most $50',
  (select partner_cents = 0 and agent_cents = 10000 and agency_cents = 25000 from public.broker_fee_splits(null, null) where policy_id = 'b1')
  and (select agent_cents = 5000 and agency_cents = 0 from public.broker_fee_splits(null, null) where policy_id = 'b2'));
select pg_temp.check('B9 the date range applies to the bound date (October: no a1, but a2 still pays no partner)',
  (select count(*) = 0 from public.broker_fee_splits('2026-10-01', '2026-10-31') where policy_id = 'a1')
  and (select partner_cents = 0 from public.broker_fee_splits('2026-10-01', '2026-10-31') where policy_id = 'a2'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select pg_temp.check('B10 Agent A sees only their policies and share — no partner or agency amounts',
  (select count(*) = 2 and bool_and(partner_name is null and partner_cents is null and agency_cents is null and agent_cents > 0) from public.broker_fee_splits(null, null)));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c') \g /dev/null
select pg_temp.check('B11 someone outside the agency sees nothing', (select count(*) = 0 from public.broker_fee_splits(null, null)) and (select count(*) = 0 from public.referral_source_names()));
select pg_temp.as_user('') \g /dev/null
select pg_temp.check('B12 signed out sees nothing', (select count(*) = 0 from public.broker_fee_splits(null, null)));
reset role;
select pg_temp.check('B13 anon can''t call them', not has_function_privilege('anon', 'public.broker_fee_splits(date,date)', 'execute') and not has_function_privilege('anon', 'public.referral_source_names()', 'execute'));
rollback;
