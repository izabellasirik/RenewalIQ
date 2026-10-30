-- 0083: "Other" referral partners and how a partner is paid. Run against a disposable copy of a database with 0080,
-- 0081 and 0083 applied (test users as in the agency RLS tests: admin …0d, agent …0a, another agency's admin …0c).
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
create or replace function pg_temp.pol(id text, bound text, fee bigint) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'policyNumber', 'RR-' || id, 'carrier', 'Sample Mutual', 'businessType', 'new', 'boundDate', bound, 'effectiveDate', bound,
    'netPremiumCents', 500000, 'taxesCents', 0, 'feesCents', 0, 'brokerFeeCents', fee, 'createdAt', bound, 'updatedAt', bound)
$$;
create or replace function pg_temp.market(variadic p jsonb[]) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', 'q', 'marketName', 'Sample Mutual', 'status', 'bound', 'policies', to_jsonb(p)))
$$;
create temp table out (k text, v text);
grant all on out to authenticated;
grant usage on schema public to authenticated;

select pg_temp.as_user('') \g /dev/null
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('ro_a', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Other Client A (sample)', '00000000-0000-0000-0000-00000000000a', pg_temp.market(pg_temp.pol('a1', '2026-10-01', 30000), pg_temp.pol('a2', '2026-10-10', 20000))),
  ('ro_b', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Other Client B (sample)', '00000000-0000-0000-0000-00000000000a', pg_temp.market(pg_temp.pol('b1', '2026-10-01', 3000))),
  ('ro_c', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Other Client C (sample)', '00000000-0000-0000-0000-00000000000a', pg_temp.market(pg_temp.pol('c1', '2026-08-01', 0), pg_temp.pol('c2', '2026-09-01', 30000))),
  ('ro_d', '00000000-0000-0000-0000-00000000000d', pg_temp.agency(), 'Admin Client D (sample)', '00000000-0000-0000-0000-00000000000d', '[]');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select public.set_agent_broker_fee_share('00000000-0000-0000-0000-00000000000a', 'percent', 0.5) \g /dev/null

-- 1. An agent chooses Other: name + amount, for that client only; it counts right away; admins are told.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select public.set_other_referral('ro_a', 'Lone Star Referrals', 5000) \g /dev/null
update public.submissions set referral_source = 'other' where id = 'ro_a';
select pg_temp.check('O1 the agent sees the client''s Other partner', (select name = 'Lone Star Referrals' and partner_fee_cents = 5000 from public.account_other_referrals where submission_id = 'ro_a'));
select pg_temp.check('O2 it isn''t added to the agency''s partner list', (select count(*) = 0 from public.referral_source_names() where name = 'Lone Star Referrals'));
select pg_temp.check('O3 the split counts right away: partner on the first policy only, the rest shared', (select agent_cents = 12500 and partner_shortfall_cents = 0 from public.broker_fee_splits(null, null) where policy_id = 'a1')
  and (select agent_cents = 10000 from public.broker_fee_splits(null, null) where policy_id = 'a2'));
select pg_temp.check('O4 the agent can''t add a partner to the list', pg_temp.refused($$select public.save_referral_source(null, 'Agent Pal', 100, true)$$));
select pg_temp.check('O5 nor decide on it', pg_temp.refused($$select public.resolve_other_referral((select gen_random_uuid()), 'ok')$$));
reset role;
select pg_temp.check('O6 one Admin Review item for the account, and every admin notified',
  (select count(*) = 1 from public.admin_review_items where kind = 'other_referral' and status = 'open' and submission_id = 'ro_a' and detail ->> 'name' = 'Lone Star Referrals')
  and (select count(*) >= 1 from public.notifications n join public.admin_review_items i on i.id = n.review_item_id where i.kind = 'other_referral' and n.user_id = '00000000-0000-0000-0000-00000000000d' and n.message like '% added Other partner Lone Star Referrals ($50.00) for Other Client A (sample).'));
select id as item_a from public.admin_review_items where kind = 'other_referral' and submission_id = 'ro_a' \gset
set local role authenticated;

-- 2. The agent changes it: the newer one replaces the open item.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select public.set_other_referral('ro_a', 'Lone Star Referrals', 6000) \g /dev/null
reset role;
select pg_temp.check('O7 a change by the agent replaces the open item', (select count(*) = 1 from public.admin_review_items where kind = 'other_referral' and status = 'open' and submission_id = 'ro_a' and (detail ->> 'partner_fee_cents')::bigint = 6000));
select id as item_a from public.admin_review_items where kind = 'other_referral' and submission_id = 'ro_a' and status = 'open' \gset
set local role authenticated;

-- 3. Admin: change the amount — the split follows; the agent is told.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('O8 Admin Review shows the name and amount', (select detail ->> 'current_name' = 'Lone Star Referrals' and (detail ->> 'current_fee_cents')::bigint = 6000 from public.admin_review_items() where id = :'item_a'));
select public.resolve_other_referral(:'item_a', 'change', 4000) \g /dev/null
select pg_temp.check('O9 changed to $40: the split follows', (select agent_cents = 13000 from public.broker_fee_splits(null, null) where policy_id = 'a1') and (select partner_cents = 4000 from public.broker_fee_splits(null, null) where policy_id = 'a1'));
select pg_temp.check('O10 decided once only', pg_temp.refused(format($$select public.resolve_other_referral(%L::uuid, 'ok')$$, :'item_a')));
reset role;
select pg_temp.check('O11 the agent was told about the change', (select count(*) = 1 from public.notifications where user_id = '00000000-0000-0000-0000-00000000000a' and type = 'referral_update' and message = 'Lone Star Referrals amount changed to $40.00 (Other Client A (sample)).'));
set local role authenticated;

-- 4. The broker fee is less than the partner's amount: the partner gets it all, the rest from the agent commission.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select public.set_other_referral('ro_b', 'Pal Freight', 5000) \g /dev/null
update public.submissions set referral_source = 'other' where id = 'ro_b';
select pg_temp.check('O12 fee $30 < partner $50: $20 comes out of the agent commission', (select partner_shortfall_cents = 2000 and agent_cents = 0 from public.broker_fee_splits(null, null) where policy_id = 'b1'));

-- 5. The first policy had no broker fee: the partner gets nothing for that client.
select public.set_other_referral('ro_c', 'Pal Freight', 5000) \g /dev/null
update public.submissions set referral_source = 'other' where id = 'ro_c';
select pg_temp.check('O13 first policy without a broker fee: no partner amount, the fee is shared', (select agent_cents = 15000 and partner_shortfall_cents = 0 from public.broker_fee_splits(null, null) where policy_id = 'c2'));

-- 6. Admin: add to the partner list (the client now uses it), and reject (back to not set).
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select public.resolve_other_referral((select id from public.admin_review_items() where kind = 'other_referral' and status = 'open' and submission_id = 'ro_b'), 'add') \g /dev/null
select pg_temp.check('O14 added: Pal Freight is a listed partner at $50 and the client uses it',
  (select partner_fee_cents = 5000 from public.referral_sources where name = 'Pal Freight')
  and (select referral_source = (select id::text from public.referral_sources where name = 'Pal Freight') from public.submissions where id = 'ro_b')
  and (select count(*) = 0 from public.account_other_referrals where submission_id = 'ro_b'));
select public.resolve_other_referral((select id from public.admin_review_items() where kind = 'other_referral' and status = 'open' and submission_id = 'ro_c'), 'reject') \g /dev/null
select pg_temp.check('O15 rejected: the client''s referral is not set again', (select referral_source is null from public.submissions where id = 'ro_c') and (select count(*) = 0 from public.account_other_referrals where submission_id = 'ro_c'));
reset role;
select pg_temp.check('O16 the agent was told to choose again', (select count(*) = 1 from public.notifications where user_id = '00000000-0000-0000-0000-00000000000a' and type = 'referral_update' and message like '%Choose another referral partner.'));
set local role authenticated;

-- 7. An admin's own Other doesn't go to review; New Submission's not-yet-saved account is accepted.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select public.set_other_referral('ro_d', 'Admin Pal', 1000) \g /dev/null
select pg_temp.check('O17 an admin''s Other isn''t sent to review', (select count(*) = 0 from public.admin_review_items() where kind = 'other_referral' and submission_id = 'ro_d'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select public.set_other_referral('acct_not_saved_yet', 'New Pal', 2500) \g /dev/null
reset role;
select pg_temp.check('O18 an account about to be saved (New Submission) can be given one (seen once the account is saved)', (select count(*) = 1 from public.account_other_referrals where submission_id = 'acct_not_saved_yet'));
set local role authenticated;

-- 8. Others.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c') \g /dev/null
select pg_temp.check('O19 another agency can''t touch this agency''s account or see its partner', pg_temp.refused($$select public.set_other_referral('ro_a', 'Hijack', 1)$$)
  and (select count(*) = 0 from public.account_other_referrals where submission_id = 'ro_a'));
select pg_temp.as_user('') \g /dev/null
select pg_temp.check('O20 signed out can''t set one', pg_temp.refused($$select public.set_other_referral('ro_a', 'Anon', 1)$$));
reset role;
select pg_temp.check('O21 anon can''t call the new functions', not has_function_privilege('anon', 'public.set_other_referral(text,text,bigint)', 'execute') and not has_function_privilege('anon', 'public.resolve_other_referral(uuid,text,bigint)', 'execute'));
rollback;
