-- 0085: the referral fee chosen on each policy; agents see the partners' amounts. Run against a disposable copy of a
-- database with 0080, 0081, 0083 and 0085 applied (test users: admin …0d, agent …0a, another agency's admin …0c).
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
create or replace function pg_temp.pol(id text, bound text, fee bigint, choice text default null) returns jsonb language sql as $$
  select case when choice is null then x else x || jsonb_build_object('referralPartner', choice) end from (select jsonb_build_object('id', id, 'policyNumber', 'RR-' || id, 'carrier', 'Sample Mutual', 'businessType', 'new', 'boundDate', bound, 'effectiveDate', bound,
    'netPremiumCents', 500000, 'taxesCents', 0, 'feesCents', 0, 'brokerFeeCents', fee, 'createdAt', bound, 'updatedAt', bound) as x) y
$$;
create or replace function pg_temp.market(variadic p jsonb[]) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', 'q', 'marketName', 'Sample Mutual', 'status', 'bound', 'policies', to_jsonb(p)))
$$;

select pg_temp.as_user('') \g /dev/null
insert into public.referral_sources (agency_id, name, partner_fee_cents, active) values
  (pg_temp.agency(), 'Sample Safety', 7500, true), (pg_temp.agency(), 'Old Partner', 4000, false);
insert into public.referral_sources (agency_id, name, partner_fee_cents, active)
  select agency_id, 'Elsewhere Partner', 9000, true from public.profiles where user_id = '00000000-0000-0000-0000-00000000000c';
select id as safety from public.referral_sources where name = 'Sample Safety' \gset
select id as oldp from public.referral_sources where name = 'Old Partner' \gset
select id as elsewhere from public.referral_sources where name = 'Elsewhere Partner' \gset
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, referral_source, market_quotes) values
  -- First policy: the partner; the renewal: No referral fee.
  ('rp_a', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Per Policy A (sample)', '00000000-0000-0000-0000-00000000000a', :'safety',
    pg_temp.market(pg_temp.pol('pa1', '2026-10-01', 40000, :'safety'), pg_temp.pol('pa2', '2027-10-01', 40000, 'none'))),
  -- No referral fee on the first policy; the partner chosen on a later one.
  ('rp_b', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Per Policy B (sample)', '00000000-0000-0000-0000-00000000000a', :'safety',
    pg_temp.market(pg_temp.pol('pb1', '2026-10-01', 40000, 'none'), pg_temp.pol('pb2', '2026-11-01', 40000, :'safety'))),
  -- Saved before 0085 (no choice): the 0083 rule.
  ('rp_c', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Legacy C (sample)', '00000000-0000-0000-0000-00000000000a', :'safety',
    pg_temp.market(pg_temp.pol('pc1', '2026-10-01', 40000), pg_temp.pol('pc2', '2026-11-01', 40000))),
  -- Other partner on the policy; another agency's partner; an inactive partner chosen / legacy.
  ('rp_d', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Other D (sample)', '00000000-0000-0000-0000-00000000000a', 'other',
    pg_temp.market(pg_temp.pol('pd1', '2026-10-01', 40000, 'other'))),
  ('rp_e', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Elsewhere E (sample)', '00000000-0000-0000-0000-00000000000a', :'elsewhere',
    pg_temp.market(pg_temp.pol('pe1', '2026-10-01', 40000, :'elsewhere'), pg_temp.pol('pe0', '2026-09-01', 40000))),
  ('rp_f', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Inactive F (sample)', '00000000-0000-0000-0000-00000000000a', :'oldp',
    pg_temp.market(pg_temp.pol('pf1', '2026-10-01', 40000, :'oldp'))),
  ('rp_g', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Inactive legacy G (sample)', '00000000-0000-0000-0000-00000000000a', :'oldp',
    pg_temp.market(pg_temp.pol('pg1', '2026-10-01', 40000))),
  ('rp_h', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Short H (sample)', '00000000-0000-0000-0000-00000000000a', :'safety',
    pg_temp.market(pg_temp.pol('ph1', '2026-10-01', 5000, :'safety')));
insert into public.account_other_referrals (submission_id, agency_id, name, partner_fee_cents) values ('rp_d', pg_temp.agency(), 'Afina (sample)', 7500);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select public.set_agent_broker_fee_share('00000000-0000-0000-0000-00000000000a', 'percent', 0.5) \g /dev/null

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
create temp view s as select * from public.broker_fee_splits(null, null);
select pg_temp.check('P1 an agent sees the partners'' amounts', (select partner_fee_cents = 7500 from public.referral_source_names() where name = 'Sample Safety'));
select pg_temp.check('P2 first policy with the partner: $400 - $75 = $325, half = $162.50', (select agent_cents = 16250 and partner_cents = 7500 from s where policy_id = 'pa1'));
select pg_temp.check('P3 renewal with No referral fee: half of $400 = $200', (select agent_cents = 20000 and partner_cents = 0 from s where policy_id = 'pa2'));
select pg_temp.check('P4 No referral fee on the first policy: nothing to the partner', (select agent_cents = 20000 and partner_cents = 0 from s where policy_id = 'pb1'));
select pg_temp.check('P5 the partner chosen on a later policy is paid there', (select agent_cents = 16250 and partner_cents = 7500 from s where policy_id = 'pb2'));
select pg_temp.check('P6 saved before 0085: partner on the very first policy only', (select agent_cents = 16250 from s where policy_id = 'pc1') and (select agent_cents = 20000 from s where policy_id = 'pc2'));
select pg_temp.check('P7 Other on the policy: the client''s Other amount', (select agent_cents = 16250 and partner_name = 'Afina (sample)' from s where policy_id = 'pd1'));
select pg_temp.check('P8 another agency''s partner never counts', (select agent_cents = 20000 and partner_cents = 0 from s where policy_id = 'pe1') and (select agent_cents = 20000 from s where policy_id = 'pe0'));
select pg_temp.check('P9 an inactive partner chosen on the policy is paid; on an old policy it isn''t', (select partner_cents = 4000 from s where policy_id = 'pf1') and (select partner_cents = 0 from s where policy_id = 'pg1'));
select pg_temp.check('P10 fee $50 < partner $75: $25 comes out of the agent commission', (select partner_shortfall_cents = 2500 and agent_cents = 0 from s where policy_id = 'ph1'));
select pg_temp.check('P11 the agent sees the partner but not the agency''s part', (select partner_name = 'Sample Safety' and agency_cents is null from s where policy_id = 'pa1'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('P12 the admin sees the agency''s part', (select agency_cents = 16250 from public.broker_fee_splits(null, null) where policy_id = 'pa1'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c') \g /dev/null
select pg_temp.check('P13 another agency sees none of it', (select count(*) = 0 from public.broker_fee_splits(null, null) where submission_id like 'rp_%')
  and (select count(*) = 0 from public.referral_source_names() where name = 'Sample Safety'));
reset role;
select pg_temp.check('P14 signed out can''t call either function', not has_function_privilege('anon', 'public.referral_source_names()', 'execute') and not has_function_privilege('anon', 'public.broker_fee_splits(date,date)', 'execute'));
rollback;
