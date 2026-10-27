-- 0075: the agent cancels a policy directly. Run against a disposable copy of a database with 0058, 0063, 0064,
-- 0067 and 0075 applied (test users as in the agency RLS tests: admin …0d, agents …0a and …0b, outsider …0c).
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
create or replace function pg_temp.entry(id text, net bigint) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'policyNumber', 'PN-' || id, 'carrier', 'Sample Mutual', 'businessType', 'new', 'boundDate', '2026-03-06',
    'netPremiumCents', net, 'taxesCents', 0, 'feesCents', 0, 'createdAt', now()::text, 'updatedAt', now()::text)
$$;
create or replace function pg_temp.t(policy text) returns public.commission_transactions language sql as $$
  select * from public.commission_transactions where policy_id = policy and replaced_by is null order by created_at desc limit 1
$$;
grant usage on schema public to authenticated;
select set_config('request.jwt.claim.sub', '', true);
insert into public.agent_commission_rates (agency_id, user_id, rate) values (pg_temp.agency(), '00000000-0000-0000-0000-00000000000a', 0.25)
  on conflict (agency_id, user_id) do update set rate = excluded.rate;
insert into public.carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, effective_from) values (pg_temp.agency(), 'sample mutual', 'Sample Mutual', 0.12, '2026-01-01');
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_cx', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Cancel Test (sample)', '00000000-0000-0000-0000-00000000000a',
   jsonb_build_array(jsonb_build_object('id', 'q_cx', 'marketName', 'Sample Market', 'status', 'bound', 'policies', jsonb_build_array(pg_temp.entry('cx1', 1000000), pg_temp.entry('cx2', 500000), pg_temp.entry('cx3', 250000)))));
create temp table ids (k text, v text);
grant all on ids to authenticated;
select (pg_temp.t('cx1')).id as orig \gset
select (pg_temp.t('cx2')).id as orig2 \gset
select (pg_temp.t('cx3')).id as orig3 \gset
select (pg_temp.t('cx1')).agent_cents as orig_agent \gset

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('C1 another agent can''t cancel it', pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'partial', '2026-09-01', 'x', 400000)$$, :'orig')));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check('C2 someone outside the agency can''t', pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'partial', '2026-09-01', 'x', 400000)$$, :'orig')));
select pg_temp.as_user('');
select pg_temp.check('C3 signed out can''t', pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'partial', '2026-09-01', 'x', 400000)$$, :'orig')));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('C4 a refund of 0, no reason or no date is refused',
  pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'partial', '2026-09-01', 'x', 0)$$, :'orig'))
  and pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'partial', '2026-09-01', '  ', 400000)$$, :'orig'))
  and pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'partial', null, 'x', 400000)$$, :'orig')));
insert into ids select 'c1', public.cancel_policy_commission(:'orig', 'partial', '2026-09-01', 'Client sold two trucks (sample)', 400000)::text;
reset role;
select pg_temp.check('C5 the assigned agent cancels directly: $4,000 refund → carrier −$480, agent −$120', exists (
  select 1 from public.commission_transactions x where x.id = (select v::uuid from ids where k = 'c1')
    and x.kind = 'cancellation' and x.net_cents = -400000 and x.carrier_cents = -48000 and x.agent_cents = -12000 and x.original_transaction_id = :'orig'));
select pg_temp.check('C6 the cancellation is recorded as done (no admin approval) and waits for an admin check', exists (
  select 1 from public.commission_cancellations c join public.commission_cancellation_reviews r on r.cancellation_id = c.id
   where c.transaction_id = :'orig' and c.status = 'approved' and c.returned_net_cents = 400000 and r.reviewed_at is null));
select pg_temp.check('C7 the original record is unchanged', (select agent_cents = :orig_agent and net_cents = 1000000 from pg_temp.t('cx1')));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('C8 a partial refund over what''s left ($6,000) is refused', pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'partial', '2026-10-01', 'x', 700000)$$, :'orig')));
select pg_temp.check('C9 full with no amount sent is worked out and applied', not pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'full', '2026-10-01', 'Cancelled (sample)', null)$$, :'orig')));
select pg_temp.check('C9b … and then nothing is left to cancel', pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'full', '2026-10-02', 'again', null)$$, :'orig')));
select public.cancel_policy_commission(:'orig3', 'full', '2026-03-01', 'Whole policy before it started (sample)', null) is not null as x \g /dev/null
reset role;
select pg_temp.check('C16 full with no amount: the whole $2,500 is refunded → carrier −$300, agent −$75', exists (
  select 1 from public.commission_transactions x where x.original_transaction_id = :'orig3' and x.kind = 'cancellation' and x.net_cents = -250000 and x.carrier_cents = -30000 and x.agent_cents = -7500));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('C17 a partial cancellation still needs an amount', pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'partial', '2026-10-01', 'x', null)$$, :'orig2')));
select pg_temp.check('C10 the agent can''t see or tick the admin check', (select count(*) = 0 from public.agent_cancellation_reviews())
  and pg_temp.refused(format($$select public.review_agent_cancellation(%L, true)$$, (select id from public.commission_cancellations where transaction_id = :'orig' limit 1))));
select public.request_commission_cancellation(:'orig2', 'full', '2026-09-01', 'Waiting the old way (sample)') is not null as x \g /dev/null
select pg_temp.check('C11 a policy with a request already waiting for an admin can''t also be cancelled directly',
  pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'full', '2026-09-01', 'x', 100000)$$, :'orig2')));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('C12 the admin sees all three as Needs Review', (select count(*) = 3 and bool_and(not reviewed) from public.agent_cancellation_reviews()));
select public.review_agent_cancellation((select cancellation_id from public.agent_cancellation_reviews() limit 1), true) \g /dev/null
select pg_temp.check('C13 the admin ticks one → Verified', (select count(*) = 1 from public.agent_cancellation_reviews() where reviewed));
select pg_temp.check('C14 the review table itself stays unreadable', pg_temp.refused($$select * from public.commission_cancellation_reviews$$));
reset role;
select pg_temp.check('C15 audited', exists (select 1 from public.finance_audit_log where action = 'policy_cancelled'));
rollback;
