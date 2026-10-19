-- 0065 payouts: which records a run pays, approving and paying, one negative balance per agent across
-- weekly and monthly payouts (carried, recovered, written off — never twice), holds, adjustments,
-- undoing an approval, and who can see and do what. Run against a disposable copy of a database with 0064
-- and 0065 applied (test users as in the agency RLS tests: admin …0d, agents …0a and …0b; another
-- agency's admin …12). Fictional records and splits (25% and 40%) on fixed past dates, so the amounts don't
-- depend on today. One transaction, rolled back. Prints one PASS/FAIL line per check.
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
-- Runs an action in its own statement (a check reading the result in the same statement would still see the data from before it).
create or replace function pg_temp.act(sql text) returns void language plpgsql as $$ begin perform set_config('test.ok', (not pg_temp.refused(sql))::text, true); end $$;
create or replace function pg_temp.agency() returns uuid language sql as $$ select agency_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d' $$;
create temp table ids (code text primary key, id uuid not null);
grant select on ids to authenticated;
create or replace function pg_temp.id(c text) returns uuid language sql as $$ select id from ids where code = c $$;
-- A commission record, written straight in as the database owner (0064's own tests cover how records are made).
create or replace function pg_temp.rec(code text, kind text, agent text, rate numeric, net bigint, ev date, payable date, verified boolean,
                                       extra jsonb default '{}') returns uuid language plpgsql as $$
declare
  new_id uuid;
  st text := coalesce(extra ->> 'stream', case when kind in ('endorsement') then 'monthly' else 'weekly' end);
begin
  insert into public.commission_transactions (agency_id, submission_id, client_name, policy_id, kind, stream, origin, original_transaction_id, policy_number,
    carrier_name, carrier_key, event_date, payable_from, net_cents, agent_user_id, agent_name, agent_rate, agent_cents, carrier_rate, carrier_rate_source, carrier_cents,
    proof_status, verification_status, verified_at, review_flags, settlement, settled_at, settled_reason, rate_confirmed_at)
  values (pg_temp.agency(), 'acct_pay_' || code, 'Payout Test ' || code || ' (sample)', case when kind in ('policy', 'endorsement') then code end, kind, st,
    coalesce(extra ->> 'origin', 'recorded'), (extra ->> 'original')::uuid, 'PN-' || code, 'Sample Mutual', 'sample mutual', ev, payable, net,
    agent::uuid, 'Agent ' || right(agent, 2), rate, public.finance_apply_rate(public.finance_apply_rate(net, 0.1), rate), 0.12, 'carrier_rate', public.finance_apply_rate(net, 0.12),
    'has_proof', case when verified then 'verified' else 'unverified' end, case when verified then now() end,
    coalesce((select array_agg(x) from jsonb_array_elements_text(extra -> 'flags') x), '{}'),
    coalesce(extra ->> 'settlement', 'open'), case when extra ->> 'settlement' = 'settled_outside' then now() end,
    case when extra ->> 'settlement' = 'settled_outside' then 'Paid before RenewalIQ (sample)' end,
    case when extra ->> 'origin' = 'historical' and verified then now() end)
  returning id into new_id;
  insert into ids values (code, new_id);
  return new_id;
end $$;
grant usage on schema public to authenticated;

-- Agent …0a (A) at 25%, agent …0b (B) at 40%. The first weekly run is the binding week Mon 2026-09-07 – Sun 09-13, paid Fri 09-18.
-- a0 and b0: earlier policies, already paid before RenewalIQ (settled outside); their cancellations come later.
select pg_temp.rec('a0', 'policy', '00000000-0000-0000-0000-00000000000a', 0.25, 800000, '2026-08-03', '2026-08-03', true, '{"origin": "historical", "settlement": "settled_outside"}');
select pg_temp.rec('a1', 'policy', '00000000-0000-0000-0000-00000000000a', 0.25, 1000000, '2026-09-07', '2026-09-07', true);   -- $250.00
select pg_temp.rec('a2', 'policy', '00000000-0000-0000-0000-00000000000a', 0.25, 845050, '2026-09-11', '2026-09-11', true);    -- a Friday: $211.26
select pg_temp.rec('a3', 'policy', '00000000-0000-0000-0000-00000000000a', 0.25, 500000, '2026-09-02', '2026-09-02', true);    -- the week before, verified late: $125.00
select pg_temp.rec('a4', 'policy', '00000000-0000-0000-0000-00000000000a', 0.25, 300000, '2026-09-12', '2026-09-12', false);   -- not verified yet
select pg_temp.rec('a5', 'cancellation', '00000000-0000-0000-0000-00000000000a', 0.25, -200000, '2026-09-01', '2026-09-10', true, jsonb_build_object('original', pg_temp.id('a0'))); -- −$50.00
select pg_temp.rec('a6', 'policy', '00000000-0000-0000-0000-00000000000a', 0.25, 400000, '2026-09-13', '2026-09-13', true, '{"flags": ["changed_since_recorded"]}');
select pg_temp.rec('a7', 'policy', '00000000-0000-0000-0000-00000000000a', 0.25, 600000, '2026-09-08', '2026-09-08', false, '{"origin": "historical", "flags": ["historical"]}');
select pg_temp.rec('a8', 'policy', '00000000-0000-0000-0000-00000000000a', 0.25, 700000, '2026-09-08', '2026-09-08', false, '{"origin": "historical", "settlement": "settled_outside"}');
select pg_temp.rec('a9', 'policy', '00000000-0000-0000-0000-00000000000a', 0.25, 100000, '2026-09-09', '2026-09-09', true);     -- held out of the first run: $25.00
select pg_temp.rec('a10', 'cancellation', '00000000-0000-0000-0000-00000000000a', 0.25, -100000, '2026-09-04', '2026-09-15', true, jsonb_build_object('original', pg_temp.id('a0'))); -- approved after the week: −$25.00
select pg_temp.rec('a11', 'endorsement', '00000000-0000-0000-0000-00000000000a', 0.25, 50000, '2026-09-08', '2026-09-08', true, jsonb_build_object('original', pg_temp.id('a0')));
select pg_temp.rec('a12', 'policy', '00000000-0000-0000-0000-00000000000a', 0.25, 200000, '2026-09-16', '2026-09-16', true, '{"origin": "historical"}'); -- historical, reviewed: $50.00
select pg_temp.rec('b0', 'policy', '00000000-0000-0000-0000-00000000000b', 0.40, 1000000, '2026-08-04', '2026-08-04', true, '{"origin": "historical", "settlement": "settled_outside"}');
select pg_temp.rec('b1', 'policy', '00000000-0000-0000-0000-00000000000b', 0.40, 400000, '2026-09-08', '2026-09-08', true);     -- $160.00
select pg_temp.rec('b2', 'cancellation', '00000000-0000-0000-0000-00000000000b', 0.40, -1000000, '2026-09-01', '2026-09-09', true, jsonb_build_object('original', pg_temp.id('b0'))); -- −$400.00
select pg_temp.rec('b3', 'endorsement', '00000000-0000-0000-0000-00000000000b', 0.40, 200000, '2026-09-20', '2026-09-20', true, jsonb_build_object('original', pg_temp.id('b0'))); -- monthly: $80.00
select pg_temp.rec('b5', 'cancellation', '00000000-0000-0000-0000-00000000000b', 0.40, -50000, '2026-09-21', '2026-09-25', true, jsonb_build_object('original', pg_temp.id('b3'), 'stream', 'monthly')); -- endorsement cancelled: −$20.00, monthly
select pg_temp.rec('b4', 'policy', '00000000-0000-0000-0000-00000000000b', 0.40, 1000000, '2026-09-15', '2026-09-15', true);    -- next week: $400.00

\echo '== starting a run'
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('S1 an agent can''t start a run or read payout tables', pg_temp.refused($$select public.create_payout_run('weekly', '2026-09-07')$$)
  and (select count(*) = 0 from public.finance_payout_runs) and (select count(*) = 0 from public.finance_agent_balance_entries));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.act($$select public.create_payout_run('weekly', '2026-09-09')$$);
select pg_temp.check('S2 the first weekly run: a Wednesday picks its Monday–Sunday week', current_setting('test.ok')::boolean
  and (select period_start = '2026-09-07' and period_end = '2026-09-13' and pay_date = '2026-09-18' from public.finance_payout_runs where stream = 'weekly'));
reset role;
insert into ids select 'run1', id from public.finance_payout_runs where stream = 'weekly';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('S2b … a Friday binding (a2, Fri 09-11) is paid the following Friday (09-18), never the same day', public.commission_pay_date('weekly', '2026-09-11') = '2026-09-18');
select pg_temp.check('S3 one open weekly run at a time', pg_temp.refused($$select public.create_payout_run('weekly')$$));
select pg_temp.check('S4 the run is in the audit', (select count(*) = 1 from public.finance_audit_log where action = 'payout_run_created' and entity_id = pg_temp.id('run1')::text));

\echo '== what a run pays'
create temp view run1 as select public.payout_run_details(pg_temp.id('run1')) as d;
select pg_temp.check('W1 agent A''s payout: a1 + a2 (Friday) + a3 (verified late) + a5 (cancellation) = $250.00 + $211.26 + $125.00 − $50.00 = $536.26',
  (select (l ->> 'status') = 'draft' and (l ->> 'itemCount')::int = 5 and (l ->> 'recordsCents')::bigint = 53626 + 2500
   from run1, jsonb_array_elements(d -> 'lines') l where l ->> 'agent' = '00000000-0000-0000-0000-00000000000a'));
select pg_temp.check('W1b … (a9, $25.00, is in it until held)', exists (select 1 from run1, jsonb_array_elements(d -> 'lines') l, jsonb_array_elements(l -> 'items') i
  where l ->> 'agent' = '00000000-0000-0000-0000-00000000000a' and (i ->> 'transactionId')::uuid = pg_temp.id('a9')));
select pg_temp.check('W2 a3 is marked as from an earlier week', (select (i ->> 'late')::boolean from run1, jsonb_array_elements(d -> 'lines') l, jsonb_array_elements(l -> 'items') i
  where (i ->> 'transactionId')::uuid = pg_temp.id('a3')));
select pg_temp.check('W3 never in it: unverified (a4), flagged (a6), historical not reviewed (a7), settled outside (a8), next week''s cancellation (a10), endorsements (a11)',
  not exists (select 1 from run1, jsonb_array_elements(d -> 'lines') l, jsonb_array_elements(l -> 'items') i
               where (i ->> 'transactionId')::uuid in (pg_temp.id('a4'), pg_temp.id('a6'), pg_temp.id('a7'), pg_temp.id('a8'), pg_temp.id('a10'), pg_temp.id('a11'))));
select pg_temp.check('W4 waiting, with why: a4 Missing Proof / Pending, a6 flagged, a7 Historical – needs review (a8 settled and a10 not due: not listed)',
  (select array_agg(w ->> 'policyNumber' order by w ->> 'policyNumber') = array['PN-a4', 'PN-a6', 'PN-a7'] from run1, jsonb_array_elements(d -> 'waiting') w)
  and (select (w ->> 'status') = 'historical_review' from run1, jsonb_array_elements(d -> 'waiting') w where w ->> 'policyNumber' = 'PN-a7')
  and (select w -> 'flags' ? 'changed_since_recorded' from run1, jsonb_array_elements(d -> 'waiting') w where w ->> 'policyNumber' = 'PN-a6'));
select pg_temp.check('W5 agent B: $160.00 − $400.00 = −$240.00, nothing to pay, all of it carried', (select (l ->> 'lineCents')::bigint = -24000 and (l ->> 'payCents')::bigint = 0
  and (l ->> 'carriedCents')::bigint = -24000 from run1, jsonb_array_elements(d -> 'lines') l where l ->> 'agent' = '00000000-0000-0000-0000-00000000000b'));
select pg_temp.check('W6 no carrier figures on a payout screen', not exists (select 1 from run1, jsonb_array_elements(d -> 'lines') l, jsonb_array_elements(l -> 'items') i
  where i ? 'carrierCents' or i ? 'carrierRate'));

\echo '== holds'
select pg_temp.check('H1 holding needs a reason', pg_temp.refused($$select public.hold_payout_record(pg_temp.id('run1'), pg_temp.id('a9'), '')$$));
select pg_temp.check('H1b … only a record this run pays can be held', pg_temp.refused($$select public.hold_payout_record(pg_temp.id('run1'), pg_temp.id('a4'), 'x')$$));
select pg_temp.check('H1c … and never a cancellation (what the agent owes always counts)', pg_temp.refused($$select public.hold_payout_record(pg_temp.id('run1'), pg_temp.id('a5'), 'x')$$));
select pg_temp.act($$select public.hold_payout_record(pg_temp.id('run1'), pg_temp.id('a9'), 'Client disputes the premium (sample)')$$);
select pg_temp.check('H2 a9 held out of this run', current_setting('test.ok')::boolean
  and (select (l ->> 'recordsCents')::bigint = 53626 and (l ->> 'itemCount')::int = 4 from run1, jsonb_array_elements(d -> 'lines') l where l ->> 'agent' = '00000000-0000-0000-0000-00000000000a')
  and (select w ->> 'holdReason' like 'Client disputes%' from run1, jsonb_array_elements(d -> 'waiting') w where w ->> 'policyNumber' = 'PN-a9'));

\echo '== approving'
select pg_temp.check('P1 the amount the admin saw must still be right', pg_temp.refused($$select public.approve_payout(pg_temp.id('run1'), '00000000-0000-0000-0000-00000000000a', 53627, 4)$$)
  and pg_temp.refused($$select public.approve_payout(pg_temp.id('run1'), '00000000-0000-0000-0000-00000000000a', 53626, 5)$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('P2 an agent can''t approve (not even their own)', pg_temp.refused($$select public.approve_payout(pg_temp.id('run1'), '00000000-0000-0000-0000-00000000000a', 53626, 4)$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.act($$select public.approve_payout(pg_temp.id('run1'), '00000000-0000-0000-0000-00000000000a', 53626, 4, 'Checked against binders (sample)')$$);
select pg_temp.check('P3 A approved: $536.26 to pay, 4 records', current_setting('test.ok')::boolean
  and (select status = 'approved' and pay_cents = 53626 and item_count = 4 and recovered_cents = 0 and carried_cents = 0 from public.finance_payouts where agent_user_id = '00000000-0000-0000-0000-00000000000a'));
reset role;
insert into ids select 'payA1', id from public.finance_payouts where agent_user_id = '00000000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('P4 approving A again is refused', pg_temp.refused($$select public.approve_payout(pg_temp.id('run1'), '00000000-0000-0000-0000-00000000000a', 0, 0)$$));
select pg_temp.check('P5 the run now shows A as approved, with the records as paid', (select (l ->> 'status') = 'approved' and jsonb_array_length(l -> 'items') = 4 from run1, jsonb_array_elements(d -> 'lines') l
  where l ->> 'agent' = '00000000-0000-0000-0000-00000000000a'));
select pg_temp.act($$select public.approve_payout(pg_temp.id('run1'), '00000000-0000-0000-0000-00000000000b', 0, 2)$$);
select pg_temp.check('P6 B approved: −$240.00 carried, nothing to pay', current_setting('test.ok')::boolean
  and (select pay_cents = 0 and carried_cents = -24000 from public.finance_payouts where agent_user_id = '00000000-0000-0000-0000-00000000000b'));
reset role;
insert into ids select 'payB1', id from public.finance_payouts where agent_user_id = '00000000-0000-0000-0000-00000000000b';
insert into ids select 'carryB', id from public.finance_agent_balance_entries where kind = 'carried' and agent_user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check('P7 B''s balance: one carried amount of −$240.00, from that payout', (select count(*) = 1 and sum(amount_cents) = -24000 and bool_and(payout_id = pg_temp.id('payB1'))
  from public.finance_agent_balance_entries where agent_user_id = '00000000-0000-0000-0000-00000000000b'));
select pg_temp.check('P8 the same commission is never paid twice (even written straight into the table)', pg_temp.refused($$
  with p as (insert into public.finance_payouts (agency_id, run_id, agent_user_id, item_count, records_cents, adjustments_cents, line_cents, balance_before_cents, recovered_cents, carried_cents, pay_cents)
             values (pg_temp.agency(), pg_temp.id('run1'), '00000000-0000-0000-0000-000000000010', 1, 25000, 0, 25000, 0, 0, 0, 25000) returning id)
  insert into public.finance_payout_items (agency_id, payout_id, transaction_id, agent_cents) select pg_temp.agency(), p.id, pg_temp.id('a1'), 25000 from p$$));
select pg_temp.check('P9 an approved payout''s amounts can''t be changed or deleted', pg_temp.refused($$update public.finance_payouts set pay_cents = 1 where id = pg_temp.id('payA1')$$)
  and pg_temp.refused($$delete from public.finance_payouts where id = pg_temp.id('payA1')$$) and pg_temp.refused($$delete from public.finance_payout_items$$));
select pg_temp.check('P10 a paid record can''t then be marked settled outside RenewalIQ', pg_temp.refused($$update public.commission_transactions set settlement = 'settled_outside', settled_at = now(), settled_reason = 'x' where id = pg_temp.id('a1')$$));

\echo '== one balance across weekly and monthly payouts'
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.act($$select public.create_payout_run('monthly', '2026-09-15')$$);
select pg_temp.check('M1 the September endorsement run, paid the first Friday of October (10-02)', current_setting('test.ok')::boolean
  and (select period_start = '2026-09-01' and period_end = '2026-09-30' and pay_date = '2026-10-02' from public.finance_payout_runs where stream = 'monthly'));
reset role;
insert into ids select 'mrun', id from public.finance_payout_runs where stream = 'monthly';
create temp view mrun as select public.payout_run_details(pg_temp.id('mrun')) as d;
grant select on mrun to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('M2 B''s monthly payout: endorsement $80.00 and its cancellation −$20.00 (monthly) = $60.00, all of it recovering the weekly −$240.00',
  (select (l ->> 'recordsCents')::bigint = 6000 and (l ->> 'balanceBeforeCents')::bigint = -24000 and (l ->> 'recoveredCents')::bigint = 6000 and (l ->> 'payCents')::bigint = 0
   from mrun, jsonb_array_elements(d -> 'lines') l where l ->> 'agent' = '00000000-0000-0000-0000-00000000000b'));
select pg_temp.check('M2b … A''s endorsement (a11, $12.50) is in the monthly run, not the weekly one', (select (l ->> 'recordsCents')::bigint = 1250 from mrun, jsonb_array_elements(d -> 'lines') l
  where l ->> 'agent' = '00000000-0000-0000-0000-00000000000a'));
select pg_temp.check('M3 approved: $60.00 recovered, nothing paid', not pg_temp.refused($$select public.approve_payout(pg_temp.id('mrun'), '00000000-0000-0000-0000-00000000000b', 0, 2)$$));
reset role;
select pg_temp.check('M4 the recovery points at the carried amount and the payout that recovered it; $180.00 left', (select count(*) = 1 and bool_and(amount_cents = 6000 and applies_to = pg_temp.id('carryB'))
  from public.finance_agent_balance_entries where kind = 'recovered') and public.finance_carried_left(pg_temp.id('carryB')) = 18000);
select pg_temp.check('M5 never recovered twice: more than is left is refused, even written straight in', pg_temp.refused($$insert into public.finance_agent_balance_entries (agency_id, agent_user_id, kind, amount_cents, payout_id, applies_to)
  values (pg_temp.agency(), '00000000-0000-0000-0000-00000000000b', 'recovered', 18001, (select id from public.finance_payouts where run_id = pg_temp.id('mrun')), pg_temp.id('carryB'))$$));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('M6 undoing B''s weekly payout is refused once part of what it carried was recovered', pg_temp.refused($$select public.cancel_payout_approval(pg_temp.id('payB1'), 'x')$$));

\echo '== paying'
select pg_temp.check('D1 the payment date is required, and not in the future', pg_temp.refused($$select public.mark_payout_paid(pg_temp.id('payA1'), null)$$)
  and pg_temp.refused($$select public.mark_payout_paid(pg_temp.id('payA1'), current_date + 1)$$));
select pg_temp.act($$select public.mark_payout_paid(pg_temp.id('payA1'), '2026-09-18')$$);
select pg_temp.check('D2 paid on 09-18, without a reference', current_setting('test.ok')::boolean
  and (select status = 'paid' and paid_on = '2026-09-18' and paid_reference is null from public.finance_payouts where id = pg_temp.id('payA1')));
select pg_temp.check('D3 nothing to pay (B, carried): can''t be marked paid', pg_temp.refused($$select public.mark_payout_paid(pg_temp.id('payB1'), '2026-09-18')$$));
select pg_temp.check('D4 a paid payout can''t be undone or paid again', pg_temp.refused($$select public.cancel_payout_approval(pg_temp.id('payA1'), 'x')$$)
  and pg_temp.refused($$select public.mark_payout_paid(pg_temp.id('payA1'), '2026-09-19')$$));
select pg_temp.check('D5 closing the run (every agent approved)', not pg_temp.refused($$select public.close_payout_run(pg_temp.id('run1'))$$));
select pg_temp.check('D6 a closed run takes nothing more', pg_temp.refused($$select public.approve_payout(pg_temp.id('run1'), '00000000-0000-0000-0000-000000000010', 0, 0)$$)
  and pg_temp.refused($$select public.add_payout_adjustment(pg_temp.id('run1'), '00000000-0000-0000-0000-00000000000a', 100, 'x')$$));

\echo '== write-offs'
select pg_temp.check('B1 writing off needs a reason, and no more than is left ($180.00)', pg_temp.refused($$select public.write_off_agent_balance(pg_temp.id('carryB'), 1000, '')$$)
  and pg_temp.refused($$select public.write_off_agent_balance(pg_temp.id('carryB'), 18001, 'x')$$));
select pg_temp.check('B2 $10.00 written off: $170.00 left', not pg_temp.refused($$select public.write_off_agent_balance(pg_temp.id('carryB'), 1000, 'Agreed with the agent: carrier error on the cancellation (sample)')$$));
reset role;
select pg_temp.check('B2b … B''s balance is −$170.00', public.finance_agent_balance(pg_temp.agency(), '00000000-0000-0000-0000-00000000000b') = -17000);

\echo '== the next run'
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('N1 runs follow one another', pg_temp.refused($$select public.create_payout_run('weekly', '2026-09-28')$$)
  and not pg_temp.refused($$select public.create_payout_run('weekly')$$));
reset role;
insert into ids select 'run2', id from public.finance_payout_runs where stream = 'weekly' and period_start = '2026-09-14';
-- a4 gets verified after its payday.
update public.commission_transactions set verification_status = 'verified', verified_at = now() where id = pg_temp.id('a4');
create temp view run2 as select public.payout_run_details(pg_temp.id('run2')) as d;
grant select on run2 to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('N2 week 09-14 – 09-20, paid 09-25', (select (d -> 'run' ->> 'periodStart') = '2026-09-14' and (d -> 'run' ->> 'payDate') = '2026-09-25' from run2));
select pg_temp.check('N3 A: the held a9 ($25.00), the cancellation approved after last week (a10, −$25.00), a4 verified late ($75.00), the reviewed historical a12 ($50.00) = $125.00',
  (select (l ->> 'recordsCents')::bigint = 12500 and (l ->> 'itemCount')::int = 4 from run2, jsonb_array_elements(d -> 'lines') l where l ->> 'agent' = '00000000-0000-0000-0000-00000000000a'));
select pg_temp.check('N3b … none of last week''s paid records again', not exists (select 1 from run2, jsonb_array_elements(d -> 'lines') l, jsonb_array_elements(l -> 'items') i
  where (i ->> 'transactionId')::uuid in (pg_temp.id('a1'), pg_temp.id('a2'), pg_temp.id('a3'), pg_temp.id('a5'))));
select pg_temp.check('N4 adjustments need a reason', pg_temp.refused($$select public.add_payout_adjustment(pg_temp.id('run2'), '00000000-0000-0000-0000-00000000000a', 1000, '')$$));
select pg_temp.act($$select public.add_payout_adjustment(pg_temp.id('run2'), '00000000-0000-0000-0000-00000000000a', 1000, 'Referral bonus (sample)')$$);
select pg_temp.check('N4b A + $10.00 adjustment: $135.00', current_setting('test.ok')::boolean
  and (select (l ->> 'payCents')::bigint = 13500 from run2, jsonb_array_elements(d -> 'lines') l where l ->> 'agent' = '00000000-0000-0000-0000-00000000000a'));
select pg_temp.act($$select public.add_payout_adjustment(pg_temp.id('run2'), '00000000-0000-0000-0000-00000000000a', -500, 'Entered by mistake (sample)')$$);
select pg_temp.check('N4c an adjustment voided before approval (with a reason) no longer counts', current_setting('test.ok')::boolean
  and pg_temp.refused($$select public.void_payout_adjustment((select id from public.finance_payout_adjustments where amount_cents = -500), '')$$)
  and not pg_temp.refused($$select public.void_payout_adjustment((select id from public.finance_payout_adjustments where amount_cents = -500), 'Typed twice (sample)')$$));
select pg_temp.check('N4d … A still $135.00', (select (l ->> 'payCents')::bigint = 13500 from run2, jsonb_array_elements(d -> 'lines') l where l ->> 'agent' = '00000000-0000-0000-0000-00000000000a'));
select pg_temp.act($$select public.hold_payout_record(pg_temp.id('run2'), pg_temp.id('a4'), 'Checking the binder (sample)')$$);
select pg_temp.check('N4e a hold released (with a reason) puts the record back', current_setting('test.ok')::boolean
  and not pg_temp.refused($$select public.release_payout_hold((select id from public.finance_payout_holds where transaction_id = pg_temp.id('a4') and released_at is null), 'Binder checked (sample)')$$));
select pg_temp.check('N4f … A still $135.00 with 4 records', (select (l ->> 'payCents')::bigint = 13500 and (l ->> 'itemCount')::int = 4 from run2, jsonb_array_elements(d -> 'lines') l where l ->> 'agent' = '00000000-0000-0000-0000-00000000000a'));
select pg_temp.check('N5 B: $400.00, less the $170.00 still owed = $230.00 to pay', (select (l ->> 'recordsCents')::bigint = 40000 and (l ->> 'recoveredCents')::bigint = 17000 and (l ->> 'payCents')::bigint = 23000
  from run2, jsonb_array_elements(d -> 'lines') l where l ->> 'agent' = '00000000-0000-0000-0000-00000000000b'));
select pg_temp.act($$select public.approve_payout_run(pg_temp.id('run2'),
  '[{"agent": "00000000-0000-0000-0000-00000000000a", "payCents": 13500, "items": 4}, {"agent": "00000000-0000-0000-0000-00000000000b", "payCents": 23000, "items": 1}]'::jsonb)$$);
select pg_temp.check('N6 "Approve all ready" approves exactly the lines shown', current_setting('test.ok')::boolean
  and (select count(*) = 2 from public.finance_payouts where run_id = pg_temp.id('run2') and status = 'approved'));
reset role;
select pg_temp.check('N7 B now owes nothing; the carried −$240.00 is fully accounted for ($60.00 + $10.00 + $170.00)', public.finance_agent_balance(pg_temp.agency(), '00000000-0000-0000-0000-00000000000b') = 0
  and public.finance_carried_left(pg_temp.id('carryB')) = 0
  and (select sum(amount_cents) = 24000 from public.finance_agent_balance_entries where applies_to = pg_temp.id('carryB') and voided_at is null));
select pg_temp.check('N8 the reviewed historical record (a12) is now paid, so it can''t be marked settled outside', exists (select 1 from public.finance_payout_items where transaction_id = pg_temp.id('a12') and active)
  and pg_temp.refused($$update public.commission_transactions set settlement = 'settled_outside', settled_at = now(), settled_reason = 'x' where id = pg_temp.id('a12')$$));

\echo '== undoing an approval (before it''s paid)'
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('U1 the reason is required', pg_temp.refused($$select public.cancel_payout_approval((select id from public.finance_payouts where run_id = pg_temp.id('run2') and agent_user_id = '00000000-0000-0000-0000-00000000000b' and status = 'approved'), '')$$));
select pg_temp.act($$select public.cancel_payout_approval((select id from public.finance_payouts where run_id = pg_temp.id('run2') and agent_user_id = '00000000-0000-0000-0000-00000000000b' and status = 'approved'), 'Wrong week (sample)')$$);
select pg_temp.check('U2 undone: B''s records and the $170.00 are free again', current_setting('test.ok')::boolean
  and (select (l ->> 'status') = 'draft' and (l ->> 'payCents')::bigint = 23000 from run2, jsonb_array_elements(d -> 'lines') l where l ->> 'agent' = '00000000-0000-0000-0000-00000000000b'));
reset role;
select pg_temp.check('U2b … kept as an undone payout, its records released and its recovery voided', (select count(*) = 1 from public.finance_payouts where run_id = pg_temp.id('run2') and status = 'cancelled')
  and not exists (select 1 from public.finance_payout_items where transaction_id = pg_temp.id('b4') and active)
  and public.finance_agent_balance(pg_temp.agency(), '00000000-0000-0000-0000-00000000000b') = -17000);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('U3 approved again: the same $230.00', not pg_temp.refused($$select public.approve_payout(pg_temp.id('run2'), '00000000-0000-0000-0000-00000000000b', 23000, 1)$$));
select pg_temp.check('U4 every step is in the audit', (select count(*) filter (where action = 'payout_approved') = 6 and count(*) filter (where action = 'payout_paid') = 1
  and count(*) filter (where action = 'payout_approval_undone') = 1 and count(*) filter (where action = 'balance_written_off') = 1
  and count(*) filter (where action = 'payout_record_held') = 2 and count(*) filter (where action = 'payout_hold_released') = 1
  and count(*) filter (where action = 'payout_adjustment') = 2 and count(*) filter (where action = 'payout_adjustment_voided') = 1 and count(*) filter (where action = 'payout_run_closed') = 1
  from public.finance_audit_log where action like 'payout%' or action like 'balance%'));

\echo '== what agents see'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('G1 B sees their three payouts (weekly 09-18, weekly 09-25, monthly 10-02) — not A''s', (select count(*) = 3 from public.my_payouts())
  and (select array_agg(stream order by pay_date) = array['weekly', 'weekly', 'monthly'] from public.my_payouts()));
select pg_temp.check('G2 … their balance, with where each amount came from', (select count(*) filter (where kind = 'carried') = 1 and count(*) filter (where kind = 'recovered') = 2
  and count(*) filter (where kind = 'written_off') = 1 and bool_and(kind <> 'carried' or (stream = 'weekly' and period_start = '2026-09-07' and left_cents = 0)) from public.my_commission_balance()));
select pg_temp.check('G3 … the records in a payout, agent commission only (no carrier columns)', (select count(*) = 2 and sum(agent_cents) = -24000 from public.my_payout_lines(pg_temp.id('payB1')))
  and not exists (select 1 from pg_proc p, unnest(p.proargnames) a where p.proname in ('my_payouts', 'my_payout_lines', 'my_commission_balance') and a ilike '%carrier%'));
select pg_temp.check('G4 … and nothing of A''s payouts', (select count(*) = 0 from public.my_payout_lines(pg_temp.id('payA1'))));
select pg_temp.check('G5 an agent can''t read run details, hold, adjust or write off', pg_temp.refused($$select public.payout_run_details(pg_temp.id('run2'))$$)
  and pg_temp.refused($$select public.add_payout_adjustment(pg_temp.id('run2'), '00000000-0000-0000-0000-00000000000b', 100, 'x')$$)
  and pg_temp.refused($$select public.write_off_agent_balance(pg_temp.id('carryB'), 1, 'x')$$)
  and (select count(*) = 0 from public.finance_payouts) and (select count(*) = 0 from public.finance_payout_items));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('G6 A''s adjustment shows in their payout, with its reason', (select count(*) = 1 from public.my_payout_lines((select id from public.my_payouts() where pay_date = '2026-09-25'))
  where line_type = 'adjustment' and agent_cents = 1000 and reason like 'Referral%'));

\echo '== other agency, timing, anonymous'
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check('O1 another agency''s admin sees none of our runs or payouts and can''t act on them', (select count(*) = 0 from public.finance_payout_runs where agency_id = pg_temp.agency())
  and pg_temp.refused($$select public.payout_run_details(pg_temp.id('run2'))$$)
  and pg_temp.refused($$select public.approve_payout(pg_temp.id('mrun'), '00000000-0000-0000-0000-00000000000a', 1250, 1)$$)
  and pg_temp.refused($$select public.mark_payout_paid((select id from public.finance_payouts where run_id = pg_temp.id('run2') limit 1), current_date)$$));
select pg_temp.act($$select public.create_payout_run('weekly', current_date)$$);
select pg_temp.check('O2 their own run for the current week: can''t be approved or closed before the week is over', current_setting('test.ok')::boolean
  and pg_temp.refused($$select public.close_payout_run((select id from public.finance_payout_runs where stream = 'weekly' and closed_at is null))$$)
  and pg_temp.refused($$select public.approve_payout((select id from public.finance_payout_runs where stream = 'weekly' and closed_at is null), '00000000-0000-0000-0000-000000000012', 0, 0)$$));
select pg_temp.check('O3 a run for a period that hasn''t started is refused', pg_temp.refused($$select public.create_payout_run('monthly', current_date + 40)$$));
reset role;
set local role anon;
select pg_temp.check('O4 anonymous: nothing', pg_temp.refused($$select 1 from public.finance_payouts$$) and pg_temp.refused($$select * from public.my_payouts()$$)
  and pg_temp.refused($$select public.create_payout_run('weekly')$$));
reset role;
select pg_temp.check('O5 the records themselves were never changed by paying them', (select agent_cents = 25000 and verification_status = 'verified' from public.commission_transactions where id = pg_temp.id('a1'))
  and (select count(*) = 0 from public.finance_audit_log where action = 'sync_error'));
rollback;
