-- 0083: agents name a new referral partner ("Other"); admins approve, merge or reject it. Run against a disposable
-- copy of a database with 0080, 0081 and 0083 applied (test users as in the agency RLS tests: admin …0d, agent …0a,
-- another agency's admin …0c). Fictional partners, clients and amounts only. One transaction, rolled back. One PASS/FAIL line each.
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
create temp table out (k text, v text);
grant all on out to authenticated;
grant usage on schema public to authenticated;

select pg_temp.as_user('') \g /dev/null
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('rr_a', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Referral Client A (sample)', '00000000-0000-0000-0000-00000000000a',
   jsonb_build_array(jsonb_build_object('id', 'q', 'marketName', 'Sample Mutual', 'status', 'bound', 'policies', jsonb_build_array(pg_temp.pol('p1', '2026-10-01', 30000))))),
  ('rr_b', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Referral Client B (sample)', '00000000-0000-0000-0000-00000000000a', '[]'),
  ('rr_c', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Referral Client C (sample)', '00000000-0000-0000-0000-00000000000a', '[]');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select public.set_agent_broker_fee_share('00000000-0000-0000-0000-00000000000a', 'percent', 0.5) \g /dev/null

-- 1. An agent names a new partner: it waits for approval; admins are told; the same name isn't added twice.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
insert into out select 'pal', public.request_referral_source('Pal Freight Brokers', 'rr_a')::text;
update public.submissions set referral_source = (select v from out where k = 'pal') where id = 'rr_a';
select pg_temp.check('R1 the agent sees it to pick, awaiting approval', (select status = 'pending' from public.referral_source_names() where id::text = (select v from out where k = 'pal')));
select pg_temp.check('R2 the same name again (any case) gives the same partner', public.request_referral_source('  pal freight brokers ', 'rr_b')::text = (select v from out where k = 'pal'));
reset role;
select id as item1 from public.admin_review_items where kind = 'new_referral_partner' \gset
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select pg_temp.check('R3 the agent can''t approve it', pg_temp.refused(format($$select public.resolve_referral_partner(%L::uuid, 'approve', 5000)$$, :'item1')));
select pg_temp.check('R4 while it awaits approval the agent''s split shows no amount', (select partner_pending and agent_cents is null from public.broker_fee_splits(null, null) where policy_id = 'p1'));
reset role;
select pg_temp.check('R5 one review item, linked to the account, and every admin notified',
  (select count(*) = 1 from public.admin_review_items where kind = 'new_referral_partner' and status = 'open' and submission_id = 'rr_a')
  and (select count(*) >= 1 from public.notifications n join public.admin_review_items i on i.id = n.review_item_id where i.kind = 'new_referral_partner' and n.user_id = '00000000-0000-0000-0000-00000000000d'));
set local role authenticated;

-- 2. Admins: the item lists the accounts using it; an admin's own "Other" is added straight away.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('R6 Admin Review shows the partner''s name and its account', (select detail ->> 'name' = 'Pal Freight Brokers' and jsonb_array_length(detail -> 'accounts') = 1 from public.admin_review_items() where kind = 'new_referral_partner'));
select pg_temp.check('R7 the admin''s split for it shows no partner, agent or agency amount yet', (select partner_pending and partner_cents is null and agent_cents is null and agency_cents is null from public.broker_fee_splits(null, null) where policy_id = 'p1'));
insert into out select 'adm', public.request_referral_source('Admin Added Partner', null)::text;
select pg_temp.check('R8 a partner an admin adds is approved at once, with no review item', (select status = 'approved' from public.referral_sources where id::text = (select v from out where k = 'adm'))
  and (select count(*) = 1 from public.admin_review_items() where kind = 'new_referral_partner'));

-- 3. Approve with the agreed amount: a normal partner; the agent hears back; the split counts.
select public.resolve_referral_partner((select id from public.admin_review_items() where kind = 'new_referral_partner' and status = 'open'), 'approve', 5000) \g /dev/null
select pg_temp.check('R9 approved with its amount', (select status = 'approved' and partner_fee_cents = 5000 from public.referral_sources where id::text = (select v from out where k = 'pal')));
select pg_temp.check('R10 the split now pays the partner, then the agent, then the agency', (select not partner_pending and partner_cents = 5000 and agent_cents = 12500 and agency_cents = 12500 from public.broker_fee_splits(null, null) where policy_id = 'p1'));
select pg_temp.check('R11 a decided item can''t be decided again', pg_temp.refused(format($$select public.resolve_referral_partner(%L::uuid, 'reject')$$, :'item1')));
reset role;
select pg_temp.check('R12 the agent was notified', (select count(*) = 1 from public.notifications where user_id = '00000000-0000-0000-0000-00000000000a' and type = 'referral_update' and message like '%approved%'));
set local role authenticated;

-- 4. Merge: another spelling of an existing partner; its accounts move over and it disappears.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
insert into out select 'pal2', public.request_referral_source('Pal Freight Brokers LLC', 'rr_b')::text;
update public.submissions set referral_source = (select v from out where k = 'pal2') where id = 'rr_b';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('R13 merging needs an approved partner to merge into', pg_temp.refused(format($$select public.resolve_referral_partner((select id from public.admin_review_items() where kind = 'new_referral_partner' and status = 'open'), 'merge', null, %L::uuid)$$, (select v from out where k = 'pal2'))));
select public.resolve_referral_partner((select id from public.admin_review_items() where kind = 'new_referral_partner' and status = 'open'), 'merge', null, (select v::uuid from out where k = 'pal')) \g /dev/null
select pg_temp.check('R14 merged: the account now has the existing partner and the new name is gone',
  (select referral_source = (select v from out where k = 'pal') from public.submissions where id = 'rr_b')
  and (select count(*) = 0 from public.referral_source_names() where id::text = (select v from out where k = 'pal2')));

-- 5. Reject: the account goes back to "not set".
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
insert into out select 'odd', public.request_referral_source('Unknown Pal', 'rr_c')::text;
update public.submissions set referral_source = (select v from out where k = 'odd') where id = 'rr_c';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select public.resolve_referral_partner((select id from public.admin_review_items() where kind = 'new_referral_partner' and status = 'open'), 'reject') \g /dev/null
select pg_temp.check('R15 rejected: the account''s referral is not set again and the name is gone',
  (select referral_source is null from public.submissions where id = 'rr_c') and (select count(*) = 0 from public.referral_source_names() where name = 'Unknown Pal'));
reset role;
select pg_temp.check('R16 the agent was told to pick again', (select count(*) = 1 from public.notifications where user_id = '00000000-0000-0000-0000-00000000000a' and type = 'referral_update' and message like '%Choose the client''s referral partner again%'));
set local role authenticated;

-- 5b. The partner is paid only on the client's very first policy: none when that one had no broker fee.
select pg_temp.as_user('') \g /dev/null
reset role;
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, referral_source, market_quotes) values
  ('rr_d', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Referral Client D (sample)', '00000000-0000-0000-0000-00000000000a', (select v from out where k = 'pal'),
   jsonb_build_array(jsonb_build_object('id', 'q', 'marketName', 'Sample Mutual', 'status', 'bound', 'policies', jsonb_build_array(pg_temp.pol('d1', '2026-08-01', 0), pg_temp.pol('d2', '2026-09-01', 30000), pg_temp.pol('d3', '2026-10-01', 20000)))));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('R15b first policy had no broker fee: the partner gets nothing; agent and agency split every fee',
  (select bool_and(partner_cents = 0) and count(*) = 2 and sum(agent_cents) = 25000 and sum(agency_cents) = 25000 from public.broker_fee_splits(null, null) where submission_id = 'rr_d'));
select pg_temp.check('R15c a client whose first policy had a fee: the partner is paid on it, then never again',
  (select partner_cents = 5000 from public.broker_fee_splits(null, null) where policy_id = 'p1'));

-- 5c. The first broker fee is less than the partner's amount: the partner still gets it all, the rest from the agent commission.
reset role;
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, referral_source, market_quotes) values
  ('rr_e', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Referral Client E (sample)', '00000000-0000-0000-0000-00000000000a', (select v from out where k = 'pal'),
   jsonb_build_array(jsonb_build_object('id', 'q', 'marketName', 'Sample Mutual', 'status', 'bound', 'policies', jsonb_build_array(pg_temp.pol('e1', '2026-08-01', 3000)))));
set local role authenticated;
select pg_temp.check('R15d broker fee $30 < partner $50: partner owed $50, $20 from the agent commission, no agent or agency share of the fee',
  (select partner_cents = 5000 and partner_shortfall_cents = 2000 and agent_cents = 0 and agency_cents = 0 from public.broker_fee_splits(null, null) where policy_id = 'e1'));
select pg_temp.check('R15e no shortfall when the fee covers the partner', (select partner_shortfall_cents = 0 from public.broker_fee_splits(null, null) where policy_id = 'p1'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select pg_temp.check('R15f the agent sees the shortfall (not the partner amount)', (select partner_shortfall_cents = 2000 and partner_cents is null from public.broker_fee_splits(null, null) where policy_id = 'e1'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null

-- 6. Another agency (…0c is an admin of another agency in the test data), and signed out.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c') \g /dev/null
insert into out select 'other_agency', public.request_referral_source('Other Agency Pal', null)::text;
select pg_temp.check('R17 another agency''s admin can''t decide on this agency''s partner', pg_temp.refused(format($$select public.resolve_referral_partner(%L::uuid, 'reject')$$, :'item1')));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select pg_temp.check('R17b a partner added in another agency never shows in this one', (select count(*) = 0 from public.referral_source_names() where name = 'Other Agency Pal'));
select pg_temp.as_user('') \g /dev/null
select pg_temp.check('R18 signed out can''t add one', pg_temp.refused($$select public.request_referral_source('Anon Pal', null)$$));
reset role;
select pg_temp.check('R19 anon can''t call the new functions', not has_function_privilege('anon', 'public.request_referral_source(text,text)', 'execute') and not has_function_privilege('anon', 'public.resolve_referral_partner(uuid,text,bigint,uuid)', 'execute'));
rollback;
