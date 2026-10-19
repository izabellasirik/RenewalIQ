-- 0067: the agent's commission is their split of the carrier commission (net × carrier % × split). Run
-- against a disposable copy of a database with 0058, 0063, 0064 and 0067 applied (0065 optional; test users
-- as in the agency RLS tests: admin …0d, agents …0a and …0b). Fictional data and rates only. One
-- transaction, rolled back. Prints one PASS/FAIL line per check.
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
create or replace function pg_temp.entry(id text, kind text, net bigint, bound text, carrier text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'kind', case when kind = 'endorsement' then 'endorsement' end, 'policyNumber', 'PN-' || id, 'carrier', carrier,
    'businessType', 'new', 'boundDate', bound, 'netPremiumCents', net, 'taxesCents', 0, 'feesCents', 0, 'createdAt', now()::text, 'updatedAt', now()::text) || extra
$$;
create or replace function pg_temp.market(entries jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', 'q_test', 'marketName', 'Sample Market', 'status', 'bound', 'policies', entries))
$$;
create or replace function pg_temp.t(policy text) returns public.commission_transactions language sql as $$
  select * from public.commission_transactions where policy_id = policy and replaced_by is null order by created_at desc limit 1
$$;
grant usage on schema public to authenticated;
select set_config('request.jwt.claim.sub', '', true);

-- Fictional rates: agent …0a 25%, agent …0b 40%; Sample Mutual 12% from 2026-01-01 and 15% from 2026-07-01.
-- Other Specialty and Late Carrier have no rate.
insert into public.agent_commission_rates (agency_id, user_id, rate) values
  (pg_temp.agency(), '00000000-0000-0000-0000-00000000000a', 0.25), (pg_temp.agency(), '00000000-0000-0000-0000-00000000000b', 0.40)
  on conflict (agency_id, user_id) do update set rate = excluded.rate;
insert into public.carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, effective_from) values
  (pg_temp.agency(), 'sample mutual', 'Sample Mutual', 0.12, '2026-01-01'), (pg_temp.agency(), 'sample mutual', 'Sample Mutual', 0.15, '2026-07-01');

insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_g_1', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Split Test One (sample)', '00000000-0000-0000-0000-00000000000a',
   pg_temp.market(jsonb_build_array(
     pg_temp.entry('g1', 'policy', 1000000, '2026-03-06', 'Sample Mutual', '{"attachments": [{"id": "f1", "name": "binder.pdf"}]}'),
     pg_temp.entry('g2', 'policy', 1000000, '2026-08-03', 'Sample Mutual'),
     pg_temp.entry('g3', 'endorsement', 200000, '2026-08-10', 'Sample Mutual', '{"forPolicyId": "g1"}'),
     pg_temp.entry('g4', 'policy', 500000, '2026-03-06', 'Other Specialty'),
     pg_temp.entry('g5', 'policy', 300000, '2026-02-01', 'Late Carrier')))),
  ('acct_g_2', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Split Test Two (sample)', null,
   pg_temp.market(jsonb_build_array(pg_temp.entry('g6', 'policy', 400000, '2026-03-06', 'Sample Mutual'), pg_temp.entry('g7', 'policy', 600000, '2026-03-06', 'Other Specialty'))));

select pg_temp.check('G1 $10,000 net, carrier 12% → $1,200 carrier commission; agent 25% of it → $300', (select carrier_rate = 0.12 and carrier_cents = 120000 and agent_rate = 0.25 and agent_cents = 30000 from pg_temp.t('g1')));
select pg_temp.check('G2 the carrier % in force on the bound date: 15% from 2026-07-01 → $1,500, agent $375', (select carrier_rate = 0.15 and carrier_cents = 150000 and agent_cents = 37500 from pg_temp.t('g2')));
select pg_temp.check('G3 an endorsement uses the carrier % on its own endorsed date (15%): $2,000 → $300, agent $75', (select carrier_rate = 0.15 and carrier_cents = 30000 and agent_cents = 7500 from pg_temp.t('g3')));
select pg_temp.check('G4 a carrier without a % set: no commission, flagged "not set" (not 10%)', (select carrier_rate = 0 and carrier_cents = 0 and agent_cents is null and carrier_rate_source = 'default'
  and 'no_carrier_rate' = any (review_flags) and not ('default_carrier_rate' = any (review_flags)) from pg_temp.t('g4')));
select pg_temp.check('G4b … and it blocks verification and payment', public.finance_blocking_flags(array['no_carrier_rate', 'historical']) = array['no_carrier_rate']);

-- A later rate for Sample Mutual (20% from 2026-03-01) doesn't change what's recorded.
insert into public.carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, effective_from) values (pg_temp.agency(), 'sample mutual', 'Sample Mutual', 0.20, '2026-03-01');
update public.agent_commission_rates set rate = 0.40 where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check('G5 a later carrier % or split change leaves recorded commissions as they are', (select carrier_rate = 0.12 and agent_rate = 0.25 and agent_cents = 30000 from pg_temp.t('g1'))
  and (select carrier_rate = 0.15 and agent_cents = 37500 from pg_temp.t('g2')));
update public.agent_commission_rates set rate = 0.25 where user_id = '00000000-0000-0000-0000-00000000000a';

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('G6 a record without a carrier % can''t be verified', pg_temp.refused($$select public.verify_commission((select id from public.commission_transactions where policy_id = 'g4' and replaced_by is null), 'x')$$));
-- The admin sets Other Specialty 8% from 2026-01-01 (before both of its policies) and Late Carrier 9% from 2026-05-01 (after its policy).
select pg_temp.check('G7 the admin sets the missing carrier %', not pg_temp.refused($$select public.set_carrier_commission_rate('Other Specialty', 0.08, '2026-01-01')$$)
  and not pg_temp.refused($$select public.set_carrier_commission_rate('Late Carrier', 0.09, '2026-05-01')$$));
reset role;
select pg_temp.check('G7b … the waiting record gets it: $5,000 × 8% = $400, agent 25% → $100, flag cleared', (select carrier_rate = 0.08 and carrier_rate_source = 'carrier_rate' and carrier_rate_id is not null
  and carrier_cents = 40000 and agent_cents = 10000 and not ('no_carrier_rate' = any (review_flags)) from pg_temp.t('g4')));
select pg_temp.check('G7c … audited', (select count(*) >= 1 from public.finance_audit_log where action = 'carrier_rate_filled' and detail ->> 'carrier' = 'other specialty'));
select pg_temp.check('G7d a % from a date after the policy''s doesn''t apply to it: still not set', (select 'no_carrier_rate' = any (review_flags) and agent_cents is null and carrier_cents = 0 from pg_temp.t('g5')));
select pg_temp.check('G7e a record without an agent gets the carrier % (its agent commission waits for the agent)', (select carrier_rate = 0.08 and carrier_cents = 48000 and agent_cents is null
  and 'no_agent' = any (review_flags) and not ('no_carrier_rate' = any (review_flags)) from pg_temp.t('g7')));

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('G8 the admin fills in the agent and split: $4,000 × 12% = $480 × 40% = $192', not pg_temp.refused($$select public.resolve_commission_agent((select id from public.commission_transactions where policy_id = 'g6' and replaced_by is null), '00000000-0000-0000-0000-00000000000b', 0.40, 'Agent B wrote it (sample)')$$));
reset role;
select pg_temp.check('G8b … on the record', (select agent_user_id = '00000000-0000-0000-0000-00000000000b' and agent_rate = 0.40 and agent_cents = 19200 and carrier_rate = 0.12 from pg_temp.t('g6')));

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('G9 the policy is verified', not pg_temp.refused($$select public.verify_commission((select id from public.commission_transactions where policy_id = 'g1' and replaced_by is null))$$));
select pg_temp.check('G10 a correction ($10,000 → $12,000) uses the original 12% and 25%: +$240 carrier, +$60 agent',
  not pg_temp.refused($$select public.correct_commission((select id from public.commission_transactions where policy_id = 'g1' and replaced_by is null), 1200000, 'Carrier invoice (sample)')$$));
reset role;
select pg_temp.check('G10b … on a separate record', (select carrier_cents = 24000 and agent_cents = 6000 and carrier_rate = 0.12 and agent_rate = 0.25 from public.commission_transactions
  where kind = 'correction' and original_transaction_id = (pg_temp.t('g1')).id));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('G11 a cancellation is requested and approved: $4,000 returned', not pg_temp.refused($$select public.approve_commission_cancellation(
  public.request_commission_cancellation((select id from public.commission_transactions where policy_id = 'g1' and replaced_by is null), 'partial', '2026-10-10', 'Two units sold (sample)'),
  400000, 48000, 'Per carrier statement (sample)', 'Notice to follow (sample)')$$));
reset role;
select pg_temp.check('G11b … the agent gives back exactly what $4,000 earned them at the ORIGINAL 12% and 25% (not today''s 20%): −$4,000 × 12% × 25% = −$120',
  (select agent_cents = -12000 and carrier_rate = 0.12 and agent_rate = 0.25 from public.commission_transactions where kind = 'cancellation' and original_transaction_id = (pg_temp.t('g1')).id));

-- What the agent sees.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('G12 an agent sees their commission with its carrier %', (select carrier_rate = 0.12 and agent_cents = 30000 from public.my_commissions() where policy_id = 'g1'));
select pg_temp.check('G12b … and "not set" as no carrier %', (select carrier_rate is null and agent_cents is null from public.my_commissions() where policy_id = 'g5'));
select pg_temp.check('G12c … never another agent''s records', not exists (select 1 from public.my_commissions() where policy_id = 'g6'));
select pg_temp.check('G12d … and no carrier commission amounts', not exists (select 1 from pg_proc p, unnest(p.proargnames) a where p.proname = 'my_commissions' and a = 'carrier_cents'));
select pg_temp.check('G12e agents still can''t read the carrier rates table', pg_temp.refused($$select count(*) from public.carrier_commission_rates$$) or (select count(*) = 0 from public.carrier_commission_rates));
select pg_temp.check('G12f agents can''t call the fill or the formula functions', pg_temp.refused($$select public.finance_agent_cents(100, 0.1, 0.1)$$));
reset role;

select pg_temp.check('G13 the old formula (net × 10% × split) is gone', to_regprocedure('public.finance_agent_cents(bigint, numeric)') is null);
select pg_temp.check('G14 a recorded commission still can''t be edited directly', pg_temp.refused($$update public.commission_transactions set agent_cents = 1 where policy_id = 'g2'$$)
  and pg_temp.refused($$update public.commission_transactions set carrier_rate = 0.5 where policy_id = 'g2'$$));
select pg_temp.check('G15 no sync errors', (select count(*) = 0 from public.finance_audit_log where action = 'sync_error'));
rollback;
