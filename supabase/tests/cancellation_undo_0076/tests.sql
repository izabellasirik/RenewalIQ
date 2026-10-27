-- 0076: undoing a cancellation (same week, or approved by an admin after it). Run against a disposable copy of a database with 0058, 0063, 0064,
-- 0067, 0075 and 0076 applied (test users as in the agency RLS tests: admin …0d, agents …0a and …0b, outsider …0c).
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
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.cancel_policy_commission(:'orig', 'partial', '2026-09-01', 'Two trucks sold (sample)', 400000) is not null as x \g /dev/null
select pg_temp.check('U1 the agent sees the cancellation on the account, undoable this week', (select count(*) = 1 and bool_and(can_undo_now and direct and undone_at is null and refund_net_cents = 400000 and policy_id = 'cx1') from public.policy_cancellations('acct_cx')));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('U2 another agent sees nothing and can''t undo', (select count(*) = 0 from public.policy_cancellations('acct_cx'))
  and pg_temp.refused(format($$select public.undo_policy_cancellation(%L)$$, (select id from public.commission_cancellations where transaction_id = :'orig' limit 1))));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('U3 same week: the agent undoes it', (select public.undo_policy_cancellation((select cancellation_id from public.policy_cancellations('acct_cx') limit 1)) = 'undone'));
reset role;
select pg_temp.check('U4 its negative record no longer counts (void, kept), the whole $10,000 is back', exists (select 1 from public.commission_transactions where original_transaction_id = :'orig' and kind = 'cancellation' and verification_status = 'void')
  and public.finance_remaining_net(:'orig') = 1000000);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('U5 undoing twice is refused; the policy can be cancelled again', pg_temp.refused(format($$select public.undo_policy_cancellation(%L)$$, (select cancellation_id from public.policy_cancellations('acct_cx') limit 1)))
  and not pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'full', '2026-10-01', 'Whole policy (sample)', null)$$, :'orig')));
-- Make the latest cancellation two weeks old.
reset role;
set local session_replication_role = replica;
update public.commission_cancellations set decided_at = now() - interval '14 days' where transaction_id = :'orig' and status = 'approved' and id not in (select cancellation_id from public.commission_cancellation_reviews where undone_at is not null);
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select cancellation_id as late from public.policy_cancellations('acct_cx') where undone_at is null limit 1 \gset
select pg_temp.check('U6 after that week the agent can''t undo directly …', (select not can_undo_now from public.policy_cancellations('acct_cx') where cancellation_id = :'late')
  and public.undo_policy_cancellation(:'late', 'Client kept the policy (sample)') = 'requested');
select pg_temp.check('U6b … it becomes a request (not undone yet)', (select undo_requested_at is not null and undone_at is null from public.policy_cancellations('acct_cx') where cancellation_id = :'late'));
select pg_temp.check('U7 the agent can''t decline', pg_temp.refused(format($$select public.decline_cancellation_undo(%L)$$, :'late')));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.decline_cancellation_undo(:'late') \g /dev/null
select pg_temp.check('U8 the admin declines: the cancellation stays', (select undo_requested_at is null and undone_at is null from public.policy_cancellations('acct_cx') where cancellation_id = :'late'));
select pg_temp.check('U9 the admin can undo it any time', public.undo_policy_cancellation(:'late') = 'undone');
reset role;
select pg_temp.check('U10 new cancellations are recorded without admin verification (unverified)', not exists (select 1 from public.commission_transactions where original_transaction_id = :'orig' and kind = 'cancellation' and verification_status = 'verified'));
select pg_temp.check('U11 audited', exists (select 1 from public.finance_audit_log where action = 'cancellation_undone') and exists (select 1 from public.finance_audit_log where action = 'cancellation_undo_requested'));
rollback;
