-- 0079: a policy / endorsement deleted in Markets & Quotes stops counting in Analytics. Run against a disposable copy of a
-- database with 0058, 0063, 0064, 0067, 0075, 0076 (0077) and 0079 applied (test users as in the agency RLS tests).
-- Fictional data and rates only. One transaction, rolled back. One PASS/FAIL line each.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
create or replace function pg_temp.agency() returns uuid language sql as $$ select agency_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d' $$;
create or replace function pg_temp.pol(id text, net bigint, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'policyNumber', 'RM-' || id, 'carrier', 'Sample Mutual', 'businessType', 'new', 'boundDate', '2026-03-06',
    'effectiveDate', '2026-03-06', 'netPremiumCents', net, 'taxesCents', 0, 'feesCents', 0, 'createdAt', 'x', 'updatedAt', 'x') || extra
$$;
create or replace function pg_temp.quotes(entries jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', 'q_rm', 'marketName', 'Sample Market', 'status', 'bound', 'policies', entries))
$$;
create or replace function pg_temp.t(policy text) returns public.commission_transactions language sql as $$
  select * from public.commission_transactions where submission_id = 'acct_rm' and policy_id = policy and replaced_by is null order by created_at desc limit 1
$$;
-- What a policy still adds to the totals: it and its corrections / cancellations that aren't void.
create or replace function pg_temp.counting(policy text) returns table (net bigint, carrier bigint, agent bigint) language sql as $$
  select coalesce(sum(x.net_cents), 0), coalesce(sum(x.carrier_cents), 0), coalesce(sum(x.agent_cents), 0) from public.commission_transactions x
   where x.verification_status <> 'void' and x.replaced_by is null and (x.id = (pg_temp.t(policy)).id or (x.original_transaction_id = (pg_temp.t(policy)).id and x.kind in ('correction', 'cancellation')))
$$;
grant usage on schema public to authenticated;
select set_config('request.jwt.claim.sub', '', true) \g /dev/null
insert into public.agent_commission_rates (agency_id, user_id, rate) values (pg_temp.agency(), '00000000-0000-0000-0000-00000000000a', 0.25)
  on conflict (agency_id, user_id) do update set rate = excluded.rate;
insert into public.carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, effective_from) values (pg_temp.agency(), 'sample mutual', 'Sample Mutual', 0.12, '2026-01-01');
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_rm', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Removal Test (sample)', '00000000-0000-0000-0000-00000000000a',
   pg_temp.quotes(jsonb_build_array(pg_temp.pol('r1', 1000000), pg_temp.pol('r2', 500000), pg_temp.pol('r3', 800000),
     pg_temp.pol('r4', 200000, '{"kind":"endorsement","forPolicyId":"r2"}'), pg_temp.pol('r5', 300000))));
select pg_temp.check('M0 five records counting', (select count(*) = 5 from public.commission_transactions where submission_id = 'acct_rm' and verification_status <> 'void'));

-- 1. A policy entered by mistake is deleted.
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('r1', 1000000, '{"removedAt":"2026-10-28"}'), pg_temp.pol('r2', 500000), pg_temp.pol('r3', 800000),
  pg_temp.pol('r4', 200000, '{"kind":"endorsement","forPolicyId":"r2"}'), pg_temp.pol('r5', 300000))) where id = 'acct_rm';
select pg_temp.check('M1 deleted → its record is voided (kept, with the reason); it adds $0', (pg_temp.t('r1')).verification_status = 'void'
  and (pg_temp.t('r1')).void_reason = 'Deleted in Markets & Quotes' and (select net = 0 and carrier = 0 and agent = 0 from pg_temp.counting('r1')));
select pg_temp.check('M2 the other policies on the account still count', (select count(*) = 4 from public.commission_transactions where submission_id = 'acct_rm' and verification_status <> 'void'));

-- 2. A policy with a cancellation (unverified): both leave the totals.
select (pg_temp.t('r2')).id as r2 \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true) \g /dev/null
set local role authenticated;
select public.cancel_policy_commission(:'r2', 'partial', '2026-09-01', 'Two trucks sold (sample)', 100000) is not null as x \g /dev/null
reset role;
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('r1', 1000000, '{"removedAt":"2026-10-28"}'), pg_temp.pol('r2', 500000, '{"removedAt":"2026-10-28"}'),
  pg_temp.pol('r3', 800000), pg_temp.pol('r4', 200000, '{"kind":"endorsement","forPolicyId":"r2"}'), pg_temp.pol('r5', 300000))) where id = 'acct_rm';
select pg_temp.check('M3 policy + its cancellation voided → $0', (select net = 0 and carrier = 0 from pg_temp.counting('r2'))
  and not exists (select 1 from public.commission_transactions where original_transaction_id = (pg_temp.t('r2')).id and kind = 'cancellation' and verification_status <> 'void'));
select pg_temp.check('M4 its endorsement (not deleted) still counts', (pg_temp.t('r4')).verification_status <> 'void');

-- 3. A verified policy can't be voided: one reversing correction balances it to $0.
update public.commission_transactions set verification_status = 'verified', verified_at = now(), verification_reason = 'checked (sample)' where id = (pg_temp.t('r3')).id;
select pg_temp.counting('r3') as before \gset
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('r1', 1000000, '{"removedAt":"2026-10-28"}'), pg_temp.pol('r2', 500000, '{"removedAt":"2026-10-28"}'),
  pg_temp.pol('r3', 800000, '{"removedAt":"2026-10-28"}'), pg_temp.pol('r4', 200000, '{"kind":"endorsement","forPolicyId":"r2"}'), pg_temp.pol('r5', 300000))) where id = 'acct_rm';
select pg_temp.check('M5 verified → stays verified, one reversing correction (−$8,000 net, −$960 carrier), adds $0',
  (pg_temp.t('r3')).verification_status = 'verified'
  and (select count(*) = 1 and bool_and(net_cents = -800000 and carrier_cents = -96000 and recorded_snapshot ->> 'reversed' = 'removed')
         from public.commission_transactions where original_transaction_id = (pg_temp.t('r3')).id and kind = 'correction')
  and (select net = 0 and carrier = 0 and agent = 0 from pg_temp.counting('r3')));
update public.submissions set updated_at = now(), market_quotes = market_quotes || '[]'::jsonb where id = 'acct_rm';
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('r1', 1000000, '{"removedAt":"2026-10-28"}'), pg_temp.pol('r2', 500000, '{"removedAt":"2026-10-28"}'),
  pg_temp.pol('r3', 800000, '{"removedAt":"2026-10-28"}'), pg_temp.pol('r4', 200000, '{"kind":"endorsement","forPolicyId":"r2","notes":"edited"}'), pg_temp.pol('r5', 300000))) where id = 'acct_rm';
select pg_temp.check('M6 saving again adds no second reversal', (select count(*) = 1 from public.commission_transactions where original_transaction_id = (pg_temp.t('r3')).id and kind = 'correction'));

-- 4. An endorsement deleted; a policy whose whole market is deleted.
update public.submissions set market_quotes = jsonb_build_array(jsonb_build_object('id', 'q_rm2', 'marketName', 'Other', 'status', 'quoted', 'policies', '[]'::jsonb)) where id = 'acct_rm';
select pg_temp.check('M7 the market (with r4, r5) deleted → the endorsement and the policy leave the totals too',
  (pg_temp.t('r4')).verification_status = 'void' and (pg_temp.t('r5')).verification_status = 'void');
select pg_temp.check('M8 nothing on the account counts any more', (select coalesce(sum(net_cents), 0) = 0 from public.commission_transactions where submission_id = 'acct_rm' and verification_status <> 'void'));
select pg_temp.check('M9 audited', (select count(*) >= 4 from public.finance_audit_log where action = 'removed_from_totals'));

-- 5. Earlier deletions (made before 0079): the cleanup preview lists them, applying clears them.
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_rm_old', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Old Deletion (sample)', '00000000-0000-0000-0000-00000000000a', pg_temp.quotes(jsonb_build_array(pg_temp.pol('o1', 400000))));
alter table public.submissions disable trigger finance_sync_zremoved;
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('o1', 400000, '{"removedAt":"2026-09-01"}'))) where id = 'acct_rm_old';
alter table public.submissions enable trigger finance_sync_zremoved;
select pg_temp.check('M10 a deletion from before still counts (flagged removed)', exists (select 1 from public.commission_transactions where submission_id = 'acct_rm_old' and verification_status <> 'void' and 'removed' = any (review_flags)));
select public.finance_remove_entry(x, 'Deleted in Markets & Quotes (cleanup of earlier deletions)') as r from public.commission_transactions x
  join public.submissions s on s.id = x.submission_id
 where x.submission_id = 'acct_rm_old' and x.policy_id is not null and x.replaced_by is null and x.kind in ('policy', 'endorsement')
   and not exists (select 1 from public.finance_entries(s.market_quotes) e where e.entry ->> 'id' = x.policy_id and e.entry ->> 'removedAt' is null) \g /dev/null
select pg_temp.check('M11 the cleanup takes it out of the totals', not exists (select 1 from public.commission_transactions where submission_id = 'acct_rm_old' and verification_status <> 'void'));
select pg_temp.check('M12 users can''t call the helper', not has_function_privilege('authenticated', 'public.finance_remove_entry(public.commission_transactions,text)', 'execute'));
rollback;
