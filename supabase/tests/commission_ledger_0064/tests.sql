-- 0064 commission records: recording and freezing, proof and verification, corrections, cancellations,
-- historical records, settled outside RenewalIQ, carrier receipts, payout dates, who can see and do what,
-- and that nothing can be changed or deleted behind the functions. Run against a disposable copy of a
-- database with 0058, 0063 and 0064 applied (test users as in the agency RLS tests: one agency with an
-- admin (…0d) and agents (…0a, …0b); another agency with its admin (…12)). Fictional data and rates
-- only. One transaction, rolled back. Prints one PASS/FAIL line per check.
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
-- A policy / endorsement as the app stores it on a market.
create or replace function pg_temp.entry(id text, kind text, net bigint, bound text, carrier text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'kind', case when kind = 'endorsement' then 'endorsement' end, 'policyNumber', 'PN-' || id, 'carrier', carrier,
    'businessType', 'new', 'boundDate', bound, 'netPremiumCents', net, 'taxesCents', 0, 'feesCents', 0, 'createdAt', now()::text, 'updatedAt', now()::text) || extra
$$;
create or replace function pg_temp.market(entries jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', 'q_test', 'marketName', 'Sample Market', 'status', 'bound', 'policies', entries))
$$;
create or replace function pg_temp.save(sub text, entries jsonb) returns void language sql as $$ update public.submissions set market_quotes = pg_temp.market(entries) where id = sub $$;
create or replace function pg_temp.t(policy text) returns public.commission_transactions language sql as $$
  select * from public.commission_transactions where policy_id = policy and replaced_by is null order by created_at desc limit 1
$$;
create or replace function pg_temp.audit(action text, entity_id text) returns bigint language sql as $$ select count(*) from public.finance_audit_log where action = $1 and entity_id = $2 $$;
grant usage on schema public to authenticated;

-- Fictional rates: agent …0a 25%, agent …0b 40%; Sample Mutual 12% from 2026-01-01 and 15% from 2026-07-01.
insert into public.agent_commission_rates (agency_id, user_id, rate) values
  (pg_temp.agency(), '00000000-0000-0000-0000-00000000000a', 0.25), (pg_temp.agency(), '00000000-0000-0000-0000-00000000000b', 0.40)
  on conflict (agency_id, user_id) do update set rate = excluded.rate;
insert into public.carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, effective_from) values
  (pg_temp.agency(), 'sample mutual', 'Sample Mutual', 0.12, '2026-01-01'), (pg_temp.agency(), 'sample mutual', 'Sample Mutual', 0.15, '2026-07-01');

\echo '== recording freezes the agent, split, rate and amounts'
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_led_1', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Ledger Test One (sample)', '00000000-0000-0000-0000-00000000000a',
   pg_temp.market(jsonb_build_array(pg_temp.entry('p1', 'policy', 1000000, '2026-03-06', 'Sample Mutual'), pg_temp.entry('p2', 'policy', 1000000, '2026-08-03', 'Sample  MUTUAL'),
                                    pg_temp.entry('p3', 'policy', 500000, '2026-03-06', 'Other Specialty'))));
-- Ids captured as the database owner, for the checks run as agents (who can't read the records).
select set_config('test.p1', (pg_temp.t('p1')).id::text, true), set_config('test.p2', (pg_temp.t('p2')).id::text, true);
select pg_temp.check('R1 a new policy is recorded: $10,000 net, agent 25%, carrier 12% on its bound date', (select kind = 'policy' and stream = 'weekly' and origin = 'recorded' and net_cents = 1000000
  and agent_user_id = '00000000-0000-0000-0000-00000000000a' and agent_rate = 0.25 and carrier_rate = 0.12 and carrier_rate_source = 'carrier_rate' and carrier_cents = 120000
  and agent_cents = 25000 and verification_status = 'unverified' and proof_status = 'missing_proof' from pg_temp.t('p1')));
select pg_temp.check('R1b agent commission = net × 10% × split, independent of the carrier''s 12% ($250, not 25% of $1,200)', (pg_temp.t('p1')).agent_cents = 25000);
select pg_temp.check('R2 the rate in force on the bound date: 15% from 2026-07-01 (carrier typed differently)', (select carrier_rate = 0.15 and carrier_cents = 150000 from pg_temp.t('p2')));
select pg_temp.check('R3 a carrier without a rate uses 10%, flagged', (select carrier_rate = 0.1 and carrier_rate_source = 'default' and 'default_carrier_rate' = any (review_flags) and carrier_cents = 50000 from pg_temp.t('p3')));
select pg_temp.check('R3b status: Missing Proof', (select public.finance_status(x) = 'missing_proof' from pg_temp.t('p1') x));
select pg_temp.check('R3c the recording is in the audit', pg_temp.audit('recorded', (pg_temp.t('p1')).id::text) = 1);
-- Rates, split and assigned agent change; the account is saved again with a note and a proof document.
update public.agent_commission_rates set rate = 0.5 where user_id = '00000000-0000-0000-0000-00000000000a';
insert into public.carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, effective_from) values (pg_temp.agency(), 'sample mutual', 'Sample Mutual', 0.2, '2026-03-01');
update public.submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000b' where id = 'acct_led_1';
select pg_temp.save('acct_led_1', jsonb_build_array(
  pg_temp.entry('p1', 'policy', 1000000, '2026-03-06', 'Sample Mutual', '{"notes": "paid in full", "attachments": [{"id": "f1", "name": "binder.pdf"}]}'),
  pg_temp.entry('p2', 'policy', 1000000, '2026-08-03', 'Sample  MUTUAL'), pg_temp.entry('p3', 'policy', 500000, '2026-03-06', 'Other Specialty')));
select pg_temp.check('R4 later rate, split and agent changes don''t touch a record', (select agent_user_id = '00000000-0000-0000-0000-00000000000a' and agent_rate = 0.25 and agent_cents = 25000
  and carrier_rate = 0.12 and carrier_cents = 120000 from pg_temp.t('p1')));
select pg_temp.check('R5 proof attached: Pending Verification', (select proof_status = 'has_proof' and public.finance_status(x) = 'pending_verification' from pg_temp.t('p1') x));
select pg_temp.check('R6 saved again: still one record per policy', (select count(*) = 3 from public.commission_transactions where submission_id = 'acct_led_1'));

\echo '== changes on the account after recording'
select pg_temp.save('acct_led_1', jsonb_build_array(
  pg_temp.entry('p1', 'policy', 1100000, '2026-03-06', 'Sample Mutual', '{"attachments": [{"id": "f1", "name": "binder.pdf"}]}'),
  pg_temp.entry('p2', 'policy', 1000000, '2026-08-03', 'Sample  MUTUAL'), pg_temp.entry('p3', 'policy', 500000, '2026-03-06', 'Other Specialty')));
select pg_temp.check('R7 the net premium edited on the account: flagged, record unchanged', (select 'changed_since_recorded' = any (review_flags) and net_cents = 1000000 from pg_temp.t('p1')));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('R7b … verification is blocked until it''s resolved', pg_temp.refused($$select public.verify_commission((pg_temp.t('p1')).id)$$));
select pg_temp.check('R8 acknowledging needs a note', pg_temp.refused($$select public.acknowledge_commission_changes((pg_temp.t('p1')).id, ' ')$$));
reset role;
select pg_temp.save('acct_led_1', jsonb_build_array(
  pg_temp.entry('p1', 'policy', 1000000, '2026-03-06', 'Sample Mutual', '{"policyNumber": "PN-p1-A", "attachments": [{"id": "f1", "name": "binder.pdf"}]}'),
  pg_temp.entry('p2', 'policy', 1000000, '2026-08-03', 'Sample  MUTUAL'), pg_temp.entry('p3', 'policy', 500000, '2026-03-06', 'Other Specialty')));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('R8b the admin acknowledges a policy-number change; the record keeps its amounts', not pg_temp.refused($$select public.acknowledge_commission_changes((pg_temp.t('p1')).id, 'Number completed from the binder (sample)')$$)
  and (select not ('changed_since_recorded' = any (review_flags)) and net_cents = 1000000 from pg_temp.t('p1')));

\echo '== verification'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('V1 an agent can''t verify', pg_temp.refused($$select public.verify_commission(current_setting('test.p1')::uuid)$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('V2 without proof: refused without a reason', pg_temp.refused($$select public.verify_commission((pg_temp.t('p3')).id)$$));
select pg_temp.check('V3 … verified as an exception with a reason', not pg_temp.refused($$select public.verify_commission((pg_temp.t('p3')).id, 'Carrier confirmed by phone; binder to follow (sample)')$$)
  and (select verification_status = 'verified' and verified_without_proof and verification_reason <> '' from pg_temp.t('p3')));
select pg_temp.check('V4 with proof: verified', not pg_temp.refused($$select public.verify_commission((pg_temp.t('p1')).id)$$) and (select public.finance_status(x) = 'verified' from pg_temp.t('p1') x));
select pg_temp.check('V5 verifying twice is refused', pg_temp.refused($$select public.verify_commission((pg_temp.t('p1')).id)$$));
select pg_temp.check('V6 a verified record can''t be voided (correct or cancel instead)', pg_temp.refused($$select public.void_commission((pg_temp.t('p1')).id, 'x')$$));
reset role;
select pg_temp.check('V7 both verifications are in the audit (one as without proof)', pg_temp.audit('verified', (pg_temp.t('p1')).id::text) = 1 and pg_temp.audit('verified_without_proof', (pg_temp.t('p3')).id::text) = 1);

\echo '== records are frozen, even for the database owner'
select pg_temp.check('F1 amounts can''t be edited', pg_temp.refused($$update public.commission_transactions set agent_cents = 1 where policy_id = 'p1'$$));
select pg_temp.check('F2 the agent can''t be reassigned', pg_temp.refused($$update public.commission_transactions set agent_user_id = '00000000-0000-0000-0000-00000000000b' where policy_id = 'p1'$$));
select pg_temp.check('F3 a verification can''t be undone', pg_temp.refused($$update public.commission_transactions set verification_status = 'unverified', verified_at = null where policy_id = 'p1'$$));
select pg_temp.check('F4 records can''t be deleted', pg_temp.refused($$delete from public.commission_transactions where policy_id = 'p1'$$));
select pg_temp.check('F5 the audit can''t be changed or deleted', pg_temp.refused($$update public.finance_audit_log set reason = 'x'$$) and pg_temp.refused($$delete from public.finance_audit_log$$));

\echo '== corrections'
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('C1 a correction needs a reason', pg_temp.refused($$select public.correct_commission((pg_temp.t('p1')).id, 1200000, '')$$));
select pg_temp.check('C2 a correction of an unverified record is refused (record it again instead)', pg_temp.refused($$select public.correct_commission((pg_temp.t('p2')).id, 1200000, 'x')$$));
select pg_temp.check('C3 correcting $10,000 → $12,000 adds a separate record', not pg_temp.refused($$select public.correct_commission((pg_temp.t('p1')).id, 1200000, 'Carrier invoice shows $12,000 (sample)')$$));
reset role;
select pg_temp.check('C3b … +$2,000 net, +$50 agent and +$240 carrier, at the original 25% and 12% (not today''s 50% and 20%)', (select net_cents = 200000 and agent_cents = 5000 and carrier_cents = 24000
  and agent_user_id = '00000000-0000-0000-0000-00000000000a' and stream = 'weekly' and verification_status = 'verified' and payable_from = current_date
  from public.commission_transactions where kind = 'correction' and original_transaction_id = (pg_temp.t('p1')).id));
select pg_temp.check('C3c … the original is unchanged', (select net_cents = 1000000 and agent_cents = 25000 from pg_temp.t('p1')));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('C4 correcting to the amount already recorded is refused', pg_temp.refused($$select public.correct_commission((pg_temp.t('p1')).id, 1200000, 'again')$$));
reset role;

\echo '== endorsements must be linked to their policy'
select pg_temp.save('acct_led_1', jsonb_build_array(
  pg_temp.entry('p1', 'policy', 1200000, '2026-03-06', 'Sample Mutual', '{"policyNumber": "PN-p1-A", "attachments": [{"id": "f1", "name": "binder.pdf"}]}'),
  pg_temp.entry('p2', 'policy', 1000000, '2026-08-03', 'Sample  MUTUAL'), pg_temp.entry('p3', 'policy', 500000, '2026-03-06', 'Other Specialty'),
  pg_temp.entry('e1', 'endorsement', -200000, '2026-10-05', 'Sample Mutual', '{"forPolicyId": "p1"}'),
  pg_temp.entry('e2', 'endorsement', 300000, '2026-10-06', 'Sample Mutual')));
select pg_temp.check('E1 a linked endorsement: monthly, linked to its policy, negative allowed', (select kind = 'endorsement' and stream = 'monthly' and net_cents = -200000
  and original_transaction_id = (pg_temp.t('p1')).id and not ('unlinked_endorsement' = any (review_flags)) from pg_temp.t('e1')));
select pg_temp.check('E1b … frozen with the agent assigned when it was recorded (…0b at 40%): −$2,000 × 10% × 40% = −$80', (select agent_user_id = '00000000-0000-0000-0000-00000000000b' and agent_rate = 0.4 and agent_cents = -8000 from pg_temp.t('e1')));
select pg_temp.check('E1c … the account no longer carries the corrected $12,000 as a change (accepted by the correction)', not ('changed_since_recorded' = any ((pg_temp.t('p1')).review_flags)));
select pg_temp.check('E2 an endorsement without its policy is flagged, never linked automatically', (select original_transaction_id is null and 'unlinked_endorsement' = any (review_flags) from pg_temp.t('e2')));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('E2b … and can''t be verified', pg_temp.refused($$select public.verify_commission((pg_temp.t('e2')).id, 'x')$$));
select pg_temp.check('E3 linking needs a policy on the same account', pg_temp.refused($$select public.link_commission_endorsement((pg_temp.t('e2')).id, (pg_temp.t('e1')).id)$$));
select pg_temp.check('E3b the admin links it', not pg_temp.refused($$select public.link_commission_endorsement((pg_temp.t('e2')).id, (pg_temp.t('p1')).id)$$)
  and (select original_transaction_id = (pg_temp.t('p1')).id and not ('unlinked_endorsement' = any (review_flags)) from pg_temp.t('e2')));
reset role;

\echo '== void, record again'
-- (A new account is assigned to whoever creates it; this one's agent is then cleared before its policies are added.)
insert into public.submissions (id, user_id, organization_id, named_insured) values ('acct_led_2', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Ledger Test Two (sample)');
update public.submissions set assigned_user_id = null where id = 'acct_led_2';
select pg_temp.save('acct_led_2', jsonb_build_array(pg_temp.entry('n1', 'policy', 400000, '2026-09-01', 'Sample Mutual'), pg_temp.entry('n2', 'policy', 200000, '2026-09-01', 'Sample Mutual')));
select pg_temp.check('N1 no agent on the account: recorded, flagged, no agent commission', (select agent_user_id is null and agent_cents is null and 'no_agent' = any (review_flags) from pg_temp.t('n1')));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('N1b … and can''t be verified', pg_temp.refused($$select public.verify_commission((pg_temp.t('n1')).id, 'x')$$));
reset role;
update public.submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000a' where id = 'acct_led_2';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('N2 recorded again with the current agent — only because it had none', not pg_temp.refused($$select public.rerecord_commission((pg_temp.t('n1')).id, 'Agent assigned after binding (sample)', true)$$)
  and (select agent_user_id = '00000000-0000-0000-0000-00000000000a' and agent_rate = 0.5 and agent_cents = 20000 and not ('no_agent' = any (review_flags)) from pg_temp.t('n1')));
select pg_temp.check('N2b … the first record is kept, voided and pointing to the new one', (select count(*) = 1 from public.commission_transactions where policy_id = 'n1' and verification_status = 'void' and replaced_by = (pg_temp.t('n1')).id));
select pg_temp.check('N3 a record with an agent keeps it: "current agent" is refused', pg_temp.refused($$select public.rerecord_commission((pg_temp.t('n1')).id, 'x', true)$$));
select pg_temp.check('N4 voiding needs a reason', pg_temp.refused($$select public.void_commission((pg_temp.t('n2')).id, '')$$));
select pg_temp.check('N4b … voided with one', not pg_temp.refused($$select public.void_commission((pg_temp.t('n2')).id, 'Entered twice by mistake (sample)')$$) and (pg_temp.t('n2')).verification_status = 'void');
reset role;
select pg_temp.save('acct_led_2', jsonb_build_array(pg_temp.entry('n1', 'policy', 400000, '2026-09-01', 'Sample Mutual'), pg_temp.entry('n2', 'policy', 200000, '2026-09-01', 'Sample Mutual', '{"notes": "x"}')));
select pg_temp.check('N5 a voided record isn''t recorded again by a later save', (select count(*) = 1 from public.commission_transactions where policy_id = 'n2'));
select pg_temp.save('acct_led_2', jsonb_build_array(pg_temp.entry('n1', 'policy', 450000, '2026-09-02', 'Sample Mutual'), pg_temp.entry('n2', 'policy', 200000, '2026-09-01', 'Sample Mutual')));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('N6 an unverified record whose amount changed is recorded again from the account, keeping agent and split', not pg_temp.refused($$select public.rerecord_commission((pg_temp.t('n1')).id, 'Net premium corrected before verification (sample)')$$)
  and (select net_cents = 450000 and event_date = '2026-09-02' and agent_rate = 0.5 and not ('changed_since_recorded' = any (review_flags)) from pg_temp.t('n1')));
reset role;
select pg_temp.save('acct_led_2', jsonb_build_array(pg_temp.entry('n1', 'policy', 450000, '2026-09-02', 'Sample Mutual', '{"removedAt": "2026-10-01T00:00:00Z"}')));
select pg_temp.check('N7 removed from the account: flagged, every record kept (n1 recorded three times, two voided; n2 voided)', (select 'removed' = any (review_flags) from pg_temp.t('n1'))
  -- From 0079 a deleted policy also leaves the totals: its current record is voided too (all four).
  and (select count(*) = 4 and count(*) filter (where verification_status = 'void') = case when to_regprocedure('public.finance_remove_entry(public.commission_transactions,text)') is null then 3 else 4 end
         from public.commission_transactions where submission_id = 'acct_led_2'));

\echo '== historical records'
insert into public.finance_historical_entries (agency_id, submission_id, policy_id) values (pg_temp.agency(), 'acct_led_h', 'h1'), (pg_temp.agency(), 'acct_led_h', 'h2');
insert into public.agent_commission_rate_history (agency_id, user_id, old_rate, new_rate, changed_at) values (pg_temp.agency(), '00000000-0000-0000-0000-00000000000a', null, 0.4, '2025-01-01');
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_led_h', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Ledger Test Old (sample)', '00000000-0000-0000-0000-00000000000a',
   pg_temp.market(jsonb_build_array(pg_temp.entry('h1', 'policy', 800000, '2025-06-02', 'Sample Mutual'), pg_temp.entry('h2', 'endorsement', 100000, '2025-08-01', 'Sample Mutual'))));
select pg_temp.check('H1 entries that existed before records began aren''t recorded on save', (select count(*) = 0 from public.commission_transactions where submission_id = 'acct_led_h'));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('H2 an agent can''t preview or run the backfill', pg_temp.refused($$select public.finance_backfill_preview()$$) and pg_temp.refused($$select public.finance_backfill_historical()$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('H3 the preview counts what would be recorded (2 to record: 1 policy, 1 endorsement without a link)', (select (x ->> 'to_record')::int >= 2 and (x ->> 'endorsements_without_link')::int >= 1 from public.finance_backfill_preview() x));
select pg_temp.check('H4 the admin runs the backfill', not pg_temp.refused($$select public.finance_backfill_historical()$$));
select pg_temp.check('H4b … recorded as Historical – needs review: flagged, the split from the history (40% on 2025-06-02), carrier 10% uncertain', (select origin = 'historical'
  and 'historical' = any (review_flags) and 'uncertain_carrier_rate' = any (review_flags) and 'uncertain_agent' = any (review_flags) and not ('uncertain_agent_rate' = any (review_flags))
  and agent_rate = 0.4 and carrier_rate = 0.1 and carrier_rate_source = 'historical' and public.finance_status(x) = 'historical_review' from pg_temp.t('h1') x));
select pg_temp.check('H4c … the old endorsement is flagged for linking', 'unlinked_endorsement' = any ((pg_temp.t('h2')).review_flags));
select pg_temp.check('H5 never verified with today''s rates: verification is refused until reviewed', pg_temp.refused($$select public.verify_commission((pg_temp.t('h1')).id, 'x')$$));
select pg_temp.check('H6 confirming needs the rate evidence', pg_temp.refused($$select public.confirm_historical_commission((pg_temp.t('h1')).id, '00000000-0000-0000-0000-00000000000a', 0.4, 0.11, '')$$));
select pg_temp.check('H6b … and an agent of the agency', pg_temp.refused($$select public.confirm_historical_commission((pg_temp.t('h1')).id, '00000000-0000-0000-0000-000000000012', 0.4, 0.11, 'x')$$));
select pg_temp.check('H7 the admin confirms agent, split and carrier rate with evidence', not pg_temp.refused($$select public.confirm_historical_commission((pg_temp.t('h1')).id, '00000000-0000-0000-0000-00000000000a', 0.4, 0.11, '2025 agreement, schedule A (sample)')$$)
  and (select agent_rate = 0.4 and agent_cents = 32000 and carrier_rate = 0.11 and carrier_cents = 88000 and carrier_rate_source = 'confirmed' and rate_evidence <> ''
       and not ('uncertain_carrier_rate' = any (review_flags)) from pg_temp.t('h1')));
select pg_temp.check('H7b … confirmed rates can''t be confirmed again', pg_temp.refused($$select public.confirm_historical_commission((pg_temp.t('h1')).id, '00000000-0000-0000-0000-00000000000a', 0.5, 0.5, 'again')$$));
select pg_temp.check('H8 then it can be verified (no proof: with a reason)', not pg_temp.refused($$select public.verify_commission((pg_temp.t('h1')).id, 'Historical policy, binder archived (sample)')$$));
reset role;
select pg_temp.check('H9 a second backfill records nothing new', (select (x ->> 'recorded')::int = 0 from public.finance_backfill_historical(pg_temp.agency()) x));

\echo '== settled outside RenewalIQ (historical only, explicit)'
insert into public.finance_historical_entries (agency_id, submission_id, policy_id) values (pg_temp.agency(), 'acct_led_s', 's1'), (pg_temp.agency(), 'acct_led_s', 's2');
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_led_s', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Ledger Test Paid (sample)', '00000000-0000-0000-0000-00000000000a',
   pg_temp.market(jsonb_build_array(pg_temp.entry('s1', 'policy', 100000, '2025-02-03', 'Sample Mutual'), pg_temp.entry('s2', 'policy', 200000, '2025-02-04', 'Sample Mutual'))));
select public.finance_backfill_historical(pg_temp.agency());
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('S1 the confirmed count must match', pg_temp.refused($$select public.settle_commissions_outside(array[(pg_temp.t('s1')).id, (pg_temp.t('s2')).id], 'Paid in 2025 (sample)', 1)$$));
select pg_temp.check('S2 a reason is required', pg_temp.refused($$select public.settle_commissions_outside(array[(pg_temp.t('s1')).id, (pg_temp.t('s2')).id], '', 2)$$));
select pg_temp.check('S3 non-historical records can''t be settled outside', pg_temp.refused($$select public.settle_commissions_outside(array[(pg_temp.t('s1')).id, (pg_temp.t('p2')).id], 'x', 2)$$));
select pg_temp.check('S4 both settled, with the reason', (select public.settle_commissions_outside(array[(pg_temp.t('s1')).id, (pg_temp.t('s2')).id], 'Paid by cheque in 2025 (sample)', 2) = 2));
select pg_temp.check('S4b … shown as settled outside RenewalIQ', (select count(*) = 2 from public.commission_transactions x where x.submission_id = 'acct_led_s' and x.settlement = 'settled_outside' and public.finance_status(x) = 'settled_outside'));
select pg_temp.check('S5 settled ones can''t be settled again or verified', pg_temp.refused($$select public.settle_commissions_outside(array[(pg_temp.t('s1')).id], 'again', 1)$$)
  and pg_temp.refused($$select public.verify_commission((pg_temp.t('s1')).id, 'x')$$));
reset role;
select pg_temp.check('S6 one audit entry per settled record', pg_temp.audit('settled_outside', (pg_temp.t('s1')).id::text) = 1 and pg_temp.audit('settled_outside', (pg_temp.t('s2')).id::text) = 1);

\echo '== cancellations'
insert into public.documents (id, submission_id, user_id, name, file_type, category, status) values ('doc_cancel_1', 'acct_led_1', '00000000-0000-0000-0000-00000000000a', 'cancellation-notice.pdf', 'pdf', 'other', 'processed');
insert into public.documents (id, submission_id, user_id, name, file_type, category, status) values ('doc_other_acct', 'acct_led_2', '00000000-0000-0000-0000-00000000000a', 'other.pdf', 'pdf', 'other', 'processed');
-- p1: $10,000 policy + $2,000 correction, endorsements −$2,000 (e1) and +$3,000 (e2): $13,000 left.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000010');
select pg_temp.check('X1 someone not on the account can''t request a cancellation', pg_temp.refused($$select public.request_commission_cancellation(current_setting('test.p1')::uuid, 'partial', '2026-10-10', 'x')$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('X2 a document from another account is refused', pg_temp.refused($$select public.request_commission_cancellation(current_setting('test.p1')::uuid, 'partial', '2026-10-10', 'x', null, array['doc_other_acct'])$$));
select pg_temp.check('X3 the account''s agent requests a partial cancellation with the notice', not pg_temp.refused($$select public.request_commission_cancellation(current_setting('test.p1')::uuid, 'partial', '2026-10-10', 'Two units sold (sample)', 450000, array['doc_cancel_1'])$$));
select pg_temp.check('X4 a second open request on the same policy is refused', pg_temp.refused($$select public.request_commission_cancellation(current_setting('test.p1')::uuid, 'full', '2026-10-10', 'again')$$));
select pg_temp.check('X5 an agent can''t approve', pg_temp.refused($$select public.approve_commission_cancellation((select id from public.my_commission_cancellations() limit 1), 400000, 48000)$$));
select pg_temp.check('X5b … but sees their request', (select count(*) = 1 and min(status) = 'requested' from public.my_commission_cancellations()));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select set_config('test.cancel', (select id::text from public.commission_cancellations where transaction_id = (pg_temp.t('p1')).id and status = 'requested'), true);
select pg_temp.check('X6 the admin waits for the carrier''s actual refund (nothing worked out yet)', not pg_temp.refused($$select public.mark_cancellation_awaiting_amount(current_setting('test.cancel')::uuid, 'Waiting for the carrier statement (sample)')$$)
  and (select count(*) = 0 from public.commission_transactions where kind = 'cancellation'));
select pg_temp.check('X7 the actual refund is required', pg_temp.refused($$select public.approve_commission_cancellation(current_setting('test.cancel')::uuid, null, 48000)$$));
select pg_temp.check('X7b … and the actual carrier adjustment', pg_temp.refused($$select public.approve_commission_cancellation(current_setting('test.cancel')::uuid, 400000, null)$$));
select pg_temp.check('X8 more than what''s left on the policy ($13,000) is refused', pg_temp.refused($$select public.approve_commission_cancellation(current_setting('test.cancel')::uuid, 1300001, 0)$$));
select pg_temp.check('X9 approved: $4,000 returned, carrier returns $480', not pg_temp.refused($$select public.approve_commission_cancellation(current_setting('test.cancel')::uuid, 400000, 48000, 'Per carrier statement (sample)')$$));
reset role;
select pg_temp.check('X9b … a negative record linked to the policy, with the ORIGINAL agent …0a and split 25% (not the current agent …0b, not today''s 50%): −$4,000 × 10% × 25% = −$100',
  (select kind = 'cancellation' and stream = 'weekly' and original_transaction_id = (pg_temp.t('p1')).id and net_cents = -400000 and agent_user_id = '00000000-0000-0000-0000-00000000000a'
     and agent_rate = 0.25 and agent_cents = -10000 and carrier_cents = -48000 and carrier_rate_source = 'actual' and verification_status = 'verified' and payable_from = current_date
     and event_date = '2026-10-10' and proof_status = 'has_proof'
   from public.commission_transactions where cancellation_id = current_setting('test.cancel')::uuid));
select pg_temp.check('X9c … the original policy is unchanged', (select net_cents = 1000000 and agent_cents = 25000 and verification_status = 'verified' from pg_temp.t('p1')));
select pg_temp.check('X9d … $9,000 left on the policy', public.finance_remaining_net((pg_temp.t('p1')).id) = 900000);
select pg_temp.check('X10 a decided request can''t be changed', pg_temp.refused($$update public.commission_cancellations set returned_net_cents = 1 where id = current_setting('test.cancel')::uuid$$)
  and pg_temp.refused($$delete from public.commission_cancellations$$));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('X11 the same request can''t be approved twice', pg_temp.refused($$select public.approve_commission_cancellation(current_setting('test.cancel')::uuid, 400000, 48000)$$));
select pg_temp.check('X12 a later full cancellation of the rest, without the notice: needs a reason', not pg_temp.refused($$select public.request_commission_cancellation((pg_temp.t('p1')).id, 'full', '2026-11-01', 'Client sold the business (sample)')$$)
  and pg_temp.refused($$select public.approve_commission_cancellation((select id from public.commission_cancellations where status = 'requested' and transaction_id = (pg_temp.t('p1')).id), 900000, 108000)$$));
select pg_temp.check('X12b … approved with the reason', not pg_temp.refused($$select public.approve_commission_cancellation((select id from public.commission_cancellations where status = 'requested' and transaction_id = (pg_temp.t('p1')).id), 900000, 108000, null, 'Notice by email, filed later (sample)')$$));
reset role;
select pg_temp.check('X12c … nothing left on the policy, the original still unchanged', public.finance_remaining_net((pg_temp.t('p1')).id) = 0 and (pg_temp.t('p1')).net_cents = 1000000);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('X13 a cancellation of an unverified policy waits for its verification', not pg_temp.refused($$select public.request_commission_cancellation((pg_temp.t('p2')).id, 'full', '2026-11-01', 'x')$$)
  and pg_temp.refused($$select public.approve_commission_cancellation((select id from public.commission_cancellations where transaction_id = (pg_temp.t('p2')).id), 100, 0, null, 'x')$$));
select pg_temp.check('X14 rejecting needs a note', pg_temp.refused($$select public.reject_commission_cancellation((select id from public.commission_cancellations where transaction_id = (pg_temp.t('p2')).id), '')$$)
  and not pg_temp.refused($$select public.reject_commission_cancellation((select id from public.commission_cancellations where transaction_id = (pg_temp.t('p2')).id), 'Policy is still in force (sample)')$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('X15 the requester can withdraw an open request', not pg_temp.refused($$select public.request_commission_cancellation(current_setting('test.p2')::uuid, 'partial', '2026-11-02', 'x')$$)
  and not pg_temp.refused($$select public.withdraw_commission_cancellation((select id from public.my_commission_cancellations() where status = 'requested' limit 1))$$));
reset role;

\echo '== carrier receipts (tracking only)'
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('K1 the admin records what the carrier paid', not pg_temp.refused($$select public.record_carrier_receipt((pg_temp.t('p1')).id, 120000, '2026-04-15', 'Statement 04-2026 (sample)')$$));
select pg_temp.check('K2 the record and its status don''t change', (select carrier_cents = 120000 and verification_status = 'verified' from pg_temp.t('p1')));
select pg_temp.check('K3 voiding a receipt needs a reason', pg_temp.refused($$select public.void_carrier_receipt((select id from public.commission_carrier_receipts limit 1), '')$$)
  and not pg_temp.refused($$select public.void_carrier_receipt((select id from public.commission_carrier_receipts limit 1), 'Entered on the wrong policy (sample)')$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('K4 an agent can''t record or read receipts', pg_temp.refused($$select public.record_carrier_receipt((select id from public.my_commissions() limit 1), 1, '2026-01-01')$$)
  and (select count(*) = 0 from public.commission_carrier_receipts));
reset role;
select pg_temp.check('K5 receipts can''t be edited or deleted', pg_temp.refused($$update public.commission_carrier_receipts set amount_cents = 1$$) and pg_temp.refused($$delete from public.commission_carrier_receipts$$));

\echo '== payout dates (Monday–Sunday, paid the following Friday; endorsements monthly)'
select pg_temp.check('P1 bound Friday 2026-10-16 → paid Friday 2026-10-23, never the same Friday', public.finance_pay_date(pg_temp.agency(), 'weekly', '2026-10-16') = '2026-10-23');
select pg_temp.check('P2 Monday 2026-10-12 and Sunday 2026-10-18 → 2026-10-23', public.finance_pay_date(pg_temp.agency(), 'weekly', '2026-10-12') = '2026-10-23' and public.finance_pay_date(pg_temp.agency(), 'weekly', '2026-10-18') = '2026-10-23');
select pg_temp.check('P3 Monday 2026-10-19 → 2026-10-30', public.finance_pay_date(pg_temp.agency(), 'weekly', '2026-10-19') = '2026-10-30');
select pg_temp.check('P4 endorsements in October 2026 → first Friday of November (2026-11-06)', public.finance_pay_date(pg_temp.agency(), 'monthly', '2026-10-01') = '2026-11-06' and public.finance_pay_date(pg_temp.agency(), 'monthly', '2026-10-31') = '2026-11-06');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('P5 an agent can''t change the schedule', pg_temp.refused($$select public.set_finance_payout_schedule(1, 5, 'day_of_month', 5, 15, 'x')$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('P6 the admin sets the monthly payday to the 15th (with a reason)', pg_temp.refused($$select public.set_finance_payout_schedule(1, 5, 'day_of_month', 5, 15, '')$$)
  and pg_temp.refused($$select public.set_finance_payout_schedule(1, 5, 'day_of_month', 5, 31, 'x')$$)
  and not pg_temp.refused($$select public.set_finance_payout_schedule(1, 5, 'day_of_month', 5, 15, 'Payday to be confirmed (sample)')$$));
select pg_temp.check('P6b … October endorsements → 2026-11-15', public.commission_pay_date('monthly', '2026-10-20') = '2026-11-15');
reset role;
select pg_temp.check('P6c … the change is in the audit, with before and after', (select count(*) = 1 from public.finance_audit_log where action = 'payout_schedule' and detail ? 'before' and detail ? 'after'));

\echo '== what agents see (never carrier rates or carrier commission)'
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('A1 an agent reads none of the tables directly', (select count(*) = 0 from public.commission_transactions) and (select count(*) = 0 from public.commission_cancellations)
  and (select count(*) = 0 from public.finance_audit_log) and (select count(*) = 0 from public.finance_settings));
select pg_temp.check('A2 my_commissions: only their own records (policy p1, its corrections and cancellations, …)', (select count(*) > 0 and bool_and(true) from public.my_commissions())
  and not exists (select 1 from public.my_commissions() m where m.policy_id in ('e1', 'e2')));
select pg_temp.check('A3 … with no carrier columns at all', not exists (select 1 from pg_proc p, unnest(p.proargnames) a where p.proname = 'my_commissions' and a ilike '%carrier_c%' or (p.proname = 'my_commissions' and a ilike '%carrier_rate%')));
select pg_temp.check('A4 … and the expected payout date (p1 bound 2026-03-06 → Friday 2026-03-13)', (select expected_pay_date = '2026-03-13' from public.my_commissions() where policy_id = 'p1'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('A5 the other agent sees the endorsements recorded while they were assigned', (select count(*) = 2 from public.my_commissions() where kind = 'endorsement'));
select pg_temp.check('A6 account statuses: an agent sees only their own records on an account', (select count(*) = 2 and bool_and(kind = 'endorsement') from public.account_commission_statuses('acct_led_1')));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select pg_temp.check('A7 someone else in the agency sees nothing', (select count(*) = 0 from public.account_commission_statuses('acct_led_1')) and (select count(*) = 0 from public.my_commissions()));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('A8 the admin sees all records on the account', (select count(*) >= 5 from public.account_commission_statuses('acct_led_1')));

\echo '== other agency, anonymous'
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check('O1 another agency''s admin sees none of our records', (select count(*) = 0 from public.commission_transactions where agency_id = pg_temp.agency()) and (select count(*) = 0 from public.finance_audit_log where agency_id = pg_temp.agency()));
select pg_temp.check('O2 … and can''t act on them', pg_temp.refused($$select public.void_commission(current_setting('test.p2')::uuid, 'x')$$)
  and pg_temp.refused($$select public.request_commission_cancellation(current_setting('test.p2')::uuid, 'full', '2026-11-01', 'x')$$)
  and pg_temp.refused($$select public.verify_commission('00000000-0000-0000-0000-000000000000'::uuid, 'x')$$));
reset role;
set local role anon;
select pg_temp.check('O3 anonymous: nothing', pg_temp.refused($$select 1 from public.commission_transactions$$) and pg_temp.refused($$select * from public.my_commissions()$$)
  and pg_temp.refused($$select public.verify_commission('00000000-0000-0000-0000-000000000000'::uuid)$$));
reset role;

\echo '== a missing agent or split, filled in by an admin (the record and the policy stay)'
select set_config('request.jwt.claim.sub', '', true);
insert into public.submissions (id, user_id, organization_id, named_insured) values ('acct_led_4', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Ledger Test Four (sample)');
update public.submissions set assigned_user_id = null where id = 'acct_led_4';
select pg_temp.save('acct_led_4', jsonb_build_array(pg_temp.entry('m1', 'policy', 400000, '2026-09-07', 'Sample Mutual')));
select set_config('test.m1', (pg_temp.t('m1')).id::text, true);
delete from public.agent_commission_rates where user_id = '00000000-0000-0000-0000-000000000010';
insert into public.submissions (id, user_id, organization_id, named_insured) values ('acct_led_4b', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Ledger Test Four B (sample)');
update public.submissions set assigned_user_id = '00000000-0000-0000-0000-000000000010' where id = 'acct_led_4b';
select pg_temp.save('acct_led_4b', jsonb_build_array(pg_temp.entry('m2', 'policy', 200000, '2026-09-08', 'Sample Mutual')));
select set_config('test.m2', (pg_temp.t('m2')).id::text, true);
select pg_temp.check('M1 recorded without an agent, and one with an agent but no split: both flagged', 'no_agent' = any ((pg_temp.t('m1')).review_flags)
  and (select agent_user_id = '00000000-0000-0000-0000-000000000010' and agent_rate is null and agent_cents is null and 'no_agent_rate' = any (review_flags) from pg_temp.t('m2')));
select pg_temp.check('M1b … no one can fill them in directly, not even the database owner', pg_temp.refused($$update public.commission_transactions set agent_user_id = '00000000-0000-0000-0000-00000000000a', agent_rate = 0.25 where id = current_setting('test.m1')::uuid$$));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('M2 an agent can''t resolve it', pg_temp.refused($$select public.resolve_commission_agent(current_setting('test.m1')::uuid, '00000000-0000-0000-0000-00000000000a', 0.25, 'x')$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('M3 the reason is required', pg_temp.refused($$select public.resolve_commission_agent(current_setting('test.m1')::uuid, '00000000-0000-0000-0000-00000000000a', 0.25, '')$$));
select pg_temp.check('M3b … and an agent of the agency', pg_temp.refused($$select public.resolve_commission_agent(current_setting('test.m1')::uuid, '00000000-0000-0000-0000-000000000012', 0.25, 'x')$$));
select pg_temp.check('M4 the admin fills in the agent and split: same record, $4,000 × 10% × 25% = $100, flags cleared',
  not pg_temp.refused($$select public.resolve_commission_agent(current_setting('test.m1')::uuid, '00000000-0000-0000-0000-00000000000a', 0.25, 'Agent confirmed from the binder email (sample)')$$)
  and (select id = current_setting('test.m1')::uuid and agent_user_id = '00000000-0000-0000-0000-00000000000a' and agent_rate = 0.25 and agent_cents = 10000
         and not (review_flags && array['no_agent', 'no_agent_rate']) and verification_status = 'unverified' and net_cents = 400000 from pg_temp.t('m1'))
  and (select count(*) = 1 from public.commission_transactions where policy_id = 'm1'));
select pg_temp.check('M5 once filled in, the agent and split stay', pg_temp.refused($$select public.resolve_commission_agent(current_setting('test.m1')::uuid, '00000000-0000-0000-0000-00000000000b', 0.4, 'x')$$));
select pg_temp.check('M6 a recorded agent can''t be swapped while adding the split', pg_temp.refused($$select public.resolve_commission_agent(current_setting('test.m2')::uuid, '00000000-0000-0000-0000-00000000000a', 0.35, 'x')$$));
select pg_temp.check('M6b … the split is added for the recorded agent: $2,000 × 10% × 35% = $70', not pg_temp.refused($$select public.resolve_commission_agent(current_setting('test.m2')::uuid, '00000000-0000-0000-0000-000000000010', 0.35, 'Split agreed for this agent (sample)')$$)
  and (select agent_user_id = '00000000-0000-0000-0000-000000000010' and agent_rate = 0.35 and agent_cents = 7000 from pg_temp.t('m2')));
select pg_temp.check('M7 then it can be verified (no proof: with a reason)', not pg_temp.refused($$select public.verify_commission(current_setting('test.m1')::uuid, 'Binder by email (sample)')$$));
select pg_temp.check('M7b … and a verified record can''t be resolved', pg_temp.refused($$select public.resolve_commission_agent(current_setting('test.m1')::uuid, '00000000-0000-0000-0000-00000000000a', 0.25, 'x')$$));
reset role;
select pg_temp.check('M8 the audit has the before and after, with the reason', (select count(*) = 1 and bool_and(reason like 'Agent confirmed%' and detail -> 'before' ->> 'agent' is null and detail -> 'after' ->> 'agentCents' = '10000')
  from public.finance_audit_log where action = 'agent_resolved' and entity_id = current_setting('test.m1')));

\echo '== endorsement cancellations (monthly, with the endorsement''s agent and split)'
select set_config('request.jwt.claim.sub', '', true);
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_led_5', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Ledger Test Five (sample)', '00000000-0000-0000-0000-00000000000a',
   pg_temp.market(jsonb_build_array(pg_temp.entry('q1', 'policy', 1000000, '2026-09-14', 'Sample Mutual', '{"attachments": [{"id": "fq1", "name": "binder.pdf"}]}'),
     pg_temp.entry('qe1', 'endorsement', 300000, '2026-09-20', 'Sample Mutual', '{"forPolicyId": "q1", "attachments": [{"id": "fq2", "name": "end.pdf"}]}'),
     pg_temp.entry('qe2', 'endorsement', 200000, '2026-09-22', 'Sample Mutual', '{"forPolicyId": "q1", "attachments": [{"id": "fq3", "name": "end2.pdf"}]}'))));
select set_config('test.q1', (pg_temp.t('q1')).id::text, true), set_config('test.qe1', (pg_temp.t('qe1')).id::text, true), set_config('test.qe2', (pg_temp.t('qe2')).id::text, true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.verify_commission(current_setting('test.q1')::uuid), public.verify_commission(current_setting('test.qe1')::uuid), public.verify_commission(current_setting('test.qe2')::uuid);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('Q1 the account''s agent requests a cancellation of an endorsement', not pg_temp.refused($$select public.request_commission_cancellation(current_setting('test.qe1')::uuid, 'full', '2026-10-01', 'Vehicle removed (sample)')$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('Q2 more than the endorsement''s $3,000 is refused', pg_temp.refused($$select public.approve_commission_cancellation((select id from public.commission_cancellations where transaction_id = current_setting('test.qe1')::uuid), 300001, 0, null, 'x')$$));
select pg_temp.check('Q3 approved with the actual amounts', not pg_temp.refused($$select public.approve_commission_cancellation((select id from public.commission_cancellations where transaction_id = current_setting('test.qe1')::uuid), 300000, 36000, null, 'Carrier email (sample)')$$));
reset role;
select pg_temp.check('Q3b … a monthly negative record linked to the endorsement, with its agent and split', (select x.kind = 'cancellation' and x.stream = 'monthly' and x.original_transaction_id = e.id
     and x.agent_user_id = e.agent_user_id and x.agent_rate = e.agent_rate and x.agent_cents = -public.finance_agent_cents(300000, e.agent_rate) and x.net_cents = -300000
   from public.commission_transactions x, pg_temp.t('qe1') e where x.original_transaction_id = e.id and x.kind = 'cancellation'));
select pg_temp.check('Q4 the policy still has its own $10,000 and the other endorsement''s $2,000 left', public.finance_remaining_net(current_setting('test.q1')::uuid) = 1200000);
select pg_temp.check('Q5 a policy cancellation stays weekly', (select stream = 'weekly' from public.commission_transactions where kind = 'cancellation' and original_transaction_id = (pg_temp.t('p1')).id limit 1));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.request_commission_cancellation(current_setting('test.q1')::uuid, 'full', '2026-10-05', 'Client closed (sample)');
select public.approve_commission_cancellation((select id from public.commission_cancellations where transaction_id = current_setting('test.q1')::uuid and status = 'requested'), 1200000, 144000, null, 'Carrier notice by email (sample)');
select pg_temp.check('Q6 after the whole policy is cancelled, its endorsement can''t be refunded again (nothing left on the policy)',
  not pg_temp.refused($$select public.request_commission_cancellation(current_setting('test.qe2')::uuid, 'full', '2026-10-06', 'x')$$)
  and pg_temp.refused($$select public.approve_commission_cancellation((select id from public.commission_cancellations where transaction_id = current_setting('test.qe2')::uuid and status = 'requested'), 1, 0, null, 'x')$$));
reset role;

\echo '== saving an account never fails because of records'
-- (New accounts are stamped with the signed-in user's agency; none is signed in here.)
select set_config('request.jwt.claim.sub', '', true);
insert into public.submissions (id, user_id, organization_id, named_insured, market_quotes) values ('acct_led_bad', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Ledger Test Odd (sample)',
  '[1, "x", {"id": "q1", "policies": "nope"}, {"id": "q2", "policies": [7, {"kind": "policy"}]}]'::jsonb);
select pg_temp.check('B1 an account with odd market data saves; nothing recorded', (select count(*) = 1 from public.submissions where id = 'acct_led_bad') and (select count(*) = 0 from public.commission_transactions where submission_id = 'acct_led_bad'));
select pg_temp.save('acct_led_bad', jsonb_build_array(pg_temp.entry('b1', 'policy', 0, 'not-a-date', '  ', '{"netPremiumCents": "lots"}')));
select pg_temp.check('B2 a malformed policy is recorded with flags (and can''t be verified)', (select 'invalid_amount' = any (review_flags) and 'invalid_date' = any (review_flags) and 'invalid_carrier' = any (review_flags) and net_cents = 0 from pg_temp.t('b1')));
insert into public.submissions (id, user_id, organization_id, named_insured, market_quotes) values ('acct_led_personal', '00000000-0000-0000-0000-00000000000a', null, 'Ledger Test Personal (sample)',
  pg_temp.market(jsonb_build_array(pg_temp.entry('pp1', 'policy', 100000, '2026-05-01', 'Sample Mutual'))));
select pg_temp.check('B3 a personal account (no agency) records nothing', (select count(*) = 0 from public.commission_transactions where submission_id = 'acct_led_personal'));
update public.submissions set organization_id = pg_temp.agency() where id = 'acct_led_personal';
select pg_temp.check('B4 shared with the agency later: its policies are historical (noted, not recorded)', (select count(*) = 0 from public.commission_transactions where submission_id = 'acct_led_personal')
  and exists (select 1 from public.finance_historical_entries where submission_id = 'acct_led_personal' and policy_id = 'pp1'));
delete from public.submissions where id = 'acct_led_2';
select pg_temp.check('B5 deleting an account keeps its records, flagged', (select count(*) = 4 and bool_and('account_deleted' = any (review_flags)) from public.commission_transactions where submission_id = 'acct_led_2'));
select pg_temp.check('B6 no sync errors were logged', (select count(*) = 0 from public.finance_audit_log where action = 'sync_error'));
rollback;
