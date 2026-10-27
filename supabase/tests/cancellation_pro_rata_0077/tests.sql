-- 0077: a full cancellation refunds the unused days. Run against a disposable copy of a database with 0058, 0063, 0064,
-- 0067, 0075, 0076 and 0077 applied (test users as in the agency RLS tests: admin …0d, agents …0a and …0b).
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
insert into public.agent_commission_rates (agency_id, user_id, rate) values (pg_temp.agency(), '00000000-0000-0000-0000-00000000000a', 0.25)
  on conflict (agency_id, user_id) do update set rate = excluded.rate;
insert into public.carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, effective_from) values (pg_temp.agency(), 'sample mutual', 'Sample Mutual', 0.12, '2025-01-01');
-- pr1: $12,000, Jan 1 2026 → Jan 1 2027 (365 days). pr2: the same with a $3,000 endorsement from Jul 2 2026.
-- pr3: no expiration entered. pr4: no effective date (bound Dec 20 2025). pr5: a 6-month policy.
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_pr', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Pro Rata Test (sample)', '00000000-0000-0000-0000-00000000000a',
   jsonb_build_array(jsonb_build_object('id', 'q_pr', 'marketName', 'Sample Market', 'status', 'bound', 'policies', jsonb_build_array(
     pg_temp.entry('pr1', 1200000, '{"effectiveDate": "2026-01-01", "expirationDate": "2027-01-01"}'),
     pg_temp.entry('pr2', 1200000, '{"effectiveDate": "2026-01-01", "expirationDate": "2027-01-01"}'),
     pg_temp.entry('pr2e', 300000, '{"kind": "endorsement", "boundDate": "2026-06-25", "effectiveDate": "2026-07-02", "forPolicyId": "pr2"}'),
     pg_temp.entry('pr3', 1200000, '{"effectiveDate": "2026-01-01"}'),
     pg_temp.entry('pr4', 1200000, '{}'),
     pg_temp.entry('pr5', 600000, '{"effectiveDate": "2026-01-01", "expirationDate": "2026-07-01"}')))));
select (pg_temp.t('pr1')).id as p1 \gset
select (pg_temp.t('pr2')).id as p2 \gset
select (pg_temp.t('pr2e')).id as p2e \gset
select (pg_temp.t('pr3')).id as p3 \gset
select (pg_temp.t('pr4')).id as p4 \gset
select (pg_temp.t('pr5')).id as p5 \gset
select pg_temp.check('R0 the endorsement is linked to its policy', (pg_temp.t('pr2e')).original_transaction_id = :'p2');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('R1 preview, cancelled Apr 1 2026: 90 days used, 275 of 365 unused → $12,000 × 275 / 365 = $9,041.10',
  (select refund_net_cents = 904110 and term_days = 365 and unused_days = 275 and term_start = '2026-01-01' and term_end = '2027-01-01' and remaining_net_cents = 1200000
     from public.cancellation_refund_preview(:'p1', '2026-04-01')));
select pg_temp.check('R1b an entered amount above what''s left is refused', pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'full', '2026-04-01', 'x', 999999999)$$, :'p1')));
select public.cancel_policy_commission(:'p1', 'full', '2026-04-01', 'Client sold the business (sample)', null) is not null as x \g /dev/null
reset role;
select pg_temp.check('R2 full cancellation with no amount records −$9,041.10, commission back on that, days kept',
  (select net_cents = -904110 and carrier_cents = -108493 and recorded_snapshot -> 'proRata' ->> 'unusedDays' = '275' and recorded_snapshot -> 'proRata' ->> 'termDays' = '365' from pg_temp.cx(:'p1'))
  and public.finance_remaining_net(:'p1') = 295890);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('R3 a fully cancelled policy can''t be cancelled again (full or partial)',
  pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'full', '2026-05-01', 'again', null)$$, :'p1'))
  and pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'partial', '2026-05-01', 'again', 1000)$$, :'p1')));
select pg_temp.check('R4 after undoing it, it can be cancelled again on another date (Jul 1: 184 unused → $6,049.32)',
  public.undo_policy_cancellation((select cancellation_id from public.policy_cancellations('acct_pr') where policy_id = 'pr1' limit 1)) = 'undone'
  and not pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'full', '2026-07-01', 'Moved coverage (sample)', null)$$, :'p1')));
reset role;
select pg_temp.check('R4b … recorded −$6,049.32', (pg_temp.cx(:'p1')).net_cents = -604932);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('R4c the agent enters the carrier''s own amount ($5,800) instead: recorded as entered, worked-out amount kept',
  public.undo_policy_cancellation((select cancellation_id from public.policy_cancellations('acct_pr') where policy_id = 'pr1' and undone_at is null limit 1)) = 'undone'
  and not pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'full', '2026-07-01', 'Carrier short-rate (sample)', 580000)$$, :'p1')));
reset role;
select pg_temp.check('R4d … −$5,800, calculated $6,049.32 noted, still a full cancellation', (select net_cents = -580000 and recorded_snapshot -> 'proRata' ->> 'calculatedNetCents' = '604932'
  and recorded_snapshot -> 'proRata' ->> 'entered' = 'true' and recorded_snapshot ->> 'cancelType' = 'full' from pg_temp.cx(:'p1')));

-- A policy with an endorsement and an earlier partial cancellation.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.cancel_policy_commission(:'p2', 'partial', '2026-04-01', 'Two trucks sold (sample)', 200000) is not null as x \g /dev/null
select pg_temp.check('R5 full on Oct 1 2026 (92 days left): policy $3,024.66 + endorsement $1,508.20 (92 of its 183 days) − the partial''s unused $669.09 = $3,863.77',
  (select refund_net_cents = 386377 and unused_days = 92 from public.cancellation_refund_preview(:'p2', '2026-10-01')));
select pg_temp.check('R6 the endorsement alone, Oct 1: $3,000 × 92 / 183 = $1,508.20 (its own term from Jul 2)',
  (select refund_net_cents = 150820 and term_start = '2026-07-02' and term_end = '2027-01-01' and term_days = 183 from public.cancellation_refund_preview(:'p2e', '2026-10-01')));
select pg_temp.check('R7 on or before the start everything left is refunded; on or after expiration nothing',
  (select refund_net_cents = 1300000 from public.cancellation_refund_preview(:'p2', '2025-12-31'))
  and (select refund_net_cents = 0 and unused_days = 0 from public.cancellation_refund_preview(:'p2', '2027-01-01'))
  and pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'full', '2027-02-01', 'too late', null)$$, :'p2')));
select public.cancel_policy_commission(:'p2', 'full', '2026-10-01', 'Closed (sample)', null) is not null as x \g /dev/null
select pg_temp.check('R8 the policy is fully cancelled → its endorsement can''t be cancelled separately',
  pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'full', '2026-10-01', 'x', null)$$, :'p2e')));
select pg_temp.check('R9 no expiration entered: one year (Jan 1 → Jan 1, 365 days)',
  (select refund_net_cents = 904110 and term_end = '2027-01-01' from public.cancellation_refund_preview(:'p3', '2026-04-01')));
select pg_temp.check('R10 no effective date: from the bound date (Dec 20 2025 → Dec 20 2026, 365 days; Apr 1 → 263 unused → $8,646.58)',
  (select term_start = '2025-12-20' and unused_days = 263 and refund_net_cents = 864658 from public.cancellation_refund_preview(:'p4', '2026-04-01')));
select pg_temp.check('R11 a 6-month term divides by its own 181 days ($6,000 × 91 / 181 = $3,016.57)',
  (select term_days = 181 and unused_days = 91 and refund_net_cents = 301657 from public.cancellation_refund_preview(:'p5', '2026-04-01')));
select pg_temp.check('R12 partial cancellations still take the amount entered', not pg_temp.refused(format($$select public.cancel_policy_commission(%L, 'partial', '2026-04-01', 'One truck (sample)', 50000)$$, :'p5')));
reset role;
select pg_temp.check('R12b … recorded as entered', (pg_temp.cx(:'p5')).net_cents = -50000);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('R13 another agent can''t preview', pg_temp.refused(format($$select * from public.cancellation_refund_preview(%L, '2026-04-01')$$, :'p3')));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('R14 an admin can', not pg_temp.refused(format($$select * from public.cancellation_refund_preview(%L, '2026-04-01')$$, :'p3')));
select pg_temp.as_user('');
select pg_temp.check('R15 signed out is refused', pg_temp.refused(format($$select * from public.cancellation_refund_preview(%L, '2026-04-01')$$, :'p3')));
reset role;
select pg_temp.check('R16 the helpers aren''t callable by users', not has_function_privilege('authenticated', 'public.finance_pro_rata_refund(uuid, date)', 'execute'));
rollback;
