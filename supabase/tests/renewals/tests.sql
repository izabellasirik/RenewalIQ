-- 0054 account renewals: constraints, compatibility with saves that don't know the new columns,
-- access (the account's existing agency permissions), and who may set renewals up (the guard: only
-- the assigned broker or an admin; someone helping on the account can only bind / un-bind).
--
-- Run against a disposable copy of a database with 0054 applied (agencies and users as in the agency RLS tests).
-- Everything runs in one transaction and is rolled back.
-- Prints one PASS/FAIL line per check.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, true); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;

-- Fixture (as the SQL editor): Roman's account in Adriatic Agency, with two tracked renewals; Ivy
-- (an agent) helps on it.
select pg_temp.as_user('');
insert into submissions (id, user_id, named_insured, organization_id, assigned_user_id, collaborator_ids, business_type, renewals)
select 'acct_sqlt_1', '00000000-0000-0000-0000-00000000000a', 'SQL Test Freight (sample)', a.id, '00000000-0000-0000-0000-00000000000a', array['00000000-0000-0000-0000-00000000000f'::uuid], 'renewal',
       '[{"id":"r1","main":true,"status":"open","leadDays":60,"createdAt":"2026-10-17T00:00:00Z","updatedAt":"2026-10-17T00:00:00Z"},
         {"id":"r2","renewalDate":"2027-03-01","label":"Cargo","status":"open","createdAt":"2026-10-17T00:00:00Z","updatedAt":"2026-10-17T00:00:00Z"}]'::jsonb
from agencies a where a.name = 'Adriatic Agency';
-- Its renewal / effective date (the main renewal's date), with one conflicting value read from a document.
insert into field_values (id, submission_id, user_id, section, field_key, value, confidence, is_missing, is_conflicting, extraction_method)
values ('acct_sqlt_1::business::effectiveDate', 'acct_sqlt_1', '00000000-0000-0000-0000-00000000000a', 'business', 'effectiveDate', '"2026-12-16"', 'manual', false, false, 'manual_entry'),
       ('acct_sqlt_1::transportation::dotNumber', 'acct_sqlt_1', '00000000-0000-0000-0000-00000000000a', 'transportation', 'dotNumber', '"1111111"', 'manual', false, false, 'manual_entry');
insert into field_alternates (id, field_value_id, user_id, value) values ('acct_sqlt_1::business::effectiveDate::alt::0', 'acct_sqlt_1::business::effectiveDate', '00000000-0000-0000-0000-00000000000a', '"2026-12-01"');
-- An account that doesn't track renewals (from before), same people.
insert into submissions (id, user_id, named_insured, organization_id, assigned_user_id, collaborator_ids)
select 'acct_sqlt_3', '00000000-0000-0000-0000-00000000000a', 'SQL Test Legacy (sample)', a.id, '00000000-0000-0000-0000-00000000000a', array['00000000-0000-0000-0000-00000000000f'::uuid]
from agencies a where a.name = 'Adriatic Agency';
insert into field_values (id, submission_id, user_id, section, field_key, value, confidence, is_missing, is_conflicting, extraction_method)
values ('acct_sqlt_3::business::effectiveDate', 'acct_sqlt_3', '00000000-0000-0000-0000-00000000000a', 'business', 'effectiveDate', '"2026-11-20"', 'manual', false, false, 'manual_entry');

\echo '== constraints'
do $$ begin
  begin update submissions set business_type = 'bogus' where id = 'acct_sqlt_1'; raise exception 'accepted'; exception when check_violation then null; end;
end $$;
select pg_temp.check('C1 business_type must be new_venture / renewal / null', true);
do $$ begin
  begin update submissions set renewals = '{}'::jsonb where id = 'acct_sqlt_1'; raise exception 'accepted'; exception when check_violation then null; end;
end $$;
select pg_temp.check('C2 renewals must be a JSON array', true);
do $$ begin
  begin update submissions set renewals = null where id = 'acct_sqlt_1'; raise exception 'accepted'; exception when not_null_violation then null; end;
end $$;
select pg_temp.check('C3 renewals is never null', true);
insert into submissions (id, user_id, named_insured) values ('acct_sqlt_2', '00000000-0000-0000-0000-00000000000a', 'Defaults (sample)');
select pg_temp.check('C4 a new row without the columns: renewals [] and business_type null', (select renewals = '[]'::jsonb and business_type is null from submissions where id = 'acct_sqlt_2'));

\echo '== the app before 0054 (it never sends these columns) keeps them'
-- What the earlier app's save does: an upsert of the columns it knows.
insert into submissions (id, user_id, named_insured, state, status, archived, market_quotes, account_notes)
values ('acct_sqlt_1', '00000000-0000-0000-0000-00000000000a', 'SQL Test Freight (renamed)', 'TX', 'new', false, '[]', '[]')
on conflict (id) do update set named_insured = excluded.named_insured, state = excluded.state, market_quotes = excluded.market_quotes, account_notes = excluded.account_notes;
select pg_temp.check('O1 an older-app save keeps business_type and renewals', (select business_type = 'renewal' and renewals->0->>'id' = 'r1' and named_insured = 'SQL Test Freight (renamed)' from submissions where id = 'acct_sqlt_1'));

grant all on all tables in schema public to authenticated;
set local role authenticated;

\echo '== access follows the account'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('A1 assigned broker reads the renewals', (select count(*) = 1 from submissions where id = 'acct_sqlt_1' and renewals->0->>'id' = 'r1'));
with u as (update submissions set renewals = jsonb_set(renewals, '{0,leadDays}', '30') where id = 'acct_sqlt_1' returning 1)
select pg_temp.check('A2 assigned broker changes the start date', (select count(*) = 1 from u));

\echo '== someone helping on the account (Ivy): can bind / un-bind, cannot set anything up'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select pg_temp.check('H1 the helper sees the account', (select count(*) = 1 from submissions where id = 'acct_sqlt_1'));
update submissions set renewals = jsonb_set(jsonb_set(renewals, '{0,leadDays}', '5'), '{1,renewalDate}', '"2026-11-01"') where id = 'acct_sqlt_1';
select pg_temp.check('H2 a helper’s change to start dates / renewal dates is not kept', (select renewals->0->>'leadDays' = '30' and renewals->1->>'renewalDate' = '2027-03-01' from submissions where id = 'acct_sqlt_1'));
update submissions set renewals = renewals || '[{"id":"rX","renewalDate":"2026-12-01","status":"open","createdAt":"x","updatedAt":"x"}]'::jsonb where id = 'acct_sqlt_1';
select pg_temp.check('H3 a renewal the helper adds is left out', (select jsonb_array_length(renewals) = 2 from submissions where id = 'acct_sqlt_1'));
update submissions set renewals = '[]'::jsonb where id = 'acct_sqlt_1';
select pg_temp.check('H4 renewals the helper removes stay', (select jsonb_array_length(renewals) = 2 from submissions where id = 'acct_sqlt_1'));
update submissions set business_type = 'new_venture' where id = 'acct_sqlt_1';
select pg_temp.check('H5 the helper cannot change new venture / renewal', (select business_type = 'renewal' from submissions where id = 'acct_sqlt_1'));
update submissions set renewals = jsonb_set(renewals, '{1,status}', '"not_renewing"') where id = 'acct_sqlt_1';
select pg_temp.check('H6 the helper cannot mark a renewal not renewing', (select renewals->1->>'status' = 'open' from submissions where id = 'acct_sqlt_1'));
update submissions set named_insured = 'SQL Test Freight (helper edit)',
  renewals = jsonb_set(jsonb_set(jsonb_set(renewals, '{1,status}', '"bound"'), '{1,boundQuoteId}', '"q9"'), '{1,leadDays}', '1') where id = 'acct_sqlt_1';
select pg_temp.check('H7 binding a market for a renewal works (its setup still kept), and the rest of the save lands', (select renewals->1->>'status' = 'bound' and renewals->1->>'boundQuoteId' = 'q9' and renewals->1->>'leadDays' is null and named_insured = 'SQL Test Freight (helper edit)' from submissions where id = 'acct_sqlt_1'));
update submissions set renewals = jsonb_set(renewals, '{0}', (renewals->0) || '{"status":"bound","boundQuoteId":"q1","renewalDate":"2030-01-01"}') where id = 'acct_sqlt_1';
select pg_temp.check('H8 binding the main renewal keeps the date it was for — the account’s, not one the helper sent', (select renewals->0->>'status' = 'bound' and renewals->0->>'renewalDate' = '2026-12-16' from submissions where id = 'acct_sqlt_1'));
update submissions set renewals = jsonb_set(renewals, '{0}', ((renewals->0) - 'boundQuoteId' - 'renewalDate') || '{"status":"open"}') where id = 'acct_sqlt_1';
select pg_temp.check('H9 un-binding reopens it (following the account’s date again)', (select renewals->0->>'status' = 'open' and not (renewals->0 ? 'renewalDate') from submissions where id = 'acct_sqlt_1'));

update submissions set done_actions = '{"renewal-acct_sqlt_1|2026-12-16|Renewal effective Dec 16":"2026-10-17T00:00:00Z","checklist-acct_sqlt_1|x|y":"2026-10-17T00:00:00Z"}' where id = 'acct_sqlt_1';
select pg_temp.check('H10 the helper cannot mark a renewal reminder done (other tasks: yes)', (select not (done_actions ? 'renewal-acct_sqlt_1|2026-12-16|Renewal effective Dec 16') and done_actions ? 'checklist-acct_sqlt_1|x|y' from submissions where id = 'acct_sqlt_1'));

\echo '== the main renewal date (the Risk Profile effective date) on an account that tracks renewals'
update field_values set value = '"2027-06-01"' where id = 'acct_sqlt_1::business::effectiveDate';
select pg_temp.check('E1 a helper’s direct change to the effective date is not kept', (select value #>> '{}' = '2026-12-16' from field_values where id = 'acct_sqlt_1::business::effectiveDate'));
delete from field_values where id = 'acct_sqlt_1::business::effectiveDate';
delete from field_alternates where id = 'acct_sqlt_1::business::effectiveDate::alt::0';
select pg_temp.check('E2 … nor deleting it (or its history)', (select count(*) = 1 from field_values where id = 'acct_sqlt_1::business::effectiveDate') and (select count(*) = 1 from field_alternates where field_value_id = 'acct_sqlt_1::business::effectiveDate'));
insert into field_values (id, submission_id, user_id, section, field_key, value, confidence, is_missing, is_conflicting, extraction_method)
values ('acct_sqlt_1::business::effectiveDate::x', 'acct_sqlt_1', '00000000-0000-0000-0000-00000000000f', 'business', 'effectiveDate', '"2027-06-01"', 'manual', false, false, 'manual_entry');
select pg_temp.check('E3 … nor adding a second one', (select count(*) = 1 from field_values where submission_id = 'acct_sqlt_1' and field_key = 'effectiveDate'));
update field_values set field_key = 'effectiveDate', section = 'business' where id = 'acct_sqlt_1::transportation::dotNumber';
select pg_temp.check('E4 … nor turning another field into it', (select field_key = 'dotNumber' from field_values where id = 'acct_sqlt_1::transportation::dotNumber'));
-- The app's own save (0028): every Risk Profile row replaced at once — a stale copy with an old effective
-- date and its history, plus a real change (the DOT number).
select public.replace_submission_children('acct_sqlt_1',
  '[{"id":"acct_sqlt_1::business::effectiveDate","submission_id":"acct_sqlt_1","user_id":"00000000-0000-0000-0000-00000000000f","section":"business","field_key":"effectiveDate","value":"2026-10-01","confidence":"manual","is_missing":false,"is_conflicting":false,"extraction_method":"manual_entry"},
    {"id":"acct_sqlt_1::transportation::dotNumber","submission_id":"acct_sqlt_1","user_id":"00000000-0000-0000-0000-00000000000f","section":"transportation","field_key":"dotNumber","value":"2222222","confidence":"manual","is_missing":false,"is_conflicting":false,"extraction_method":"manual_entry"}]',
  '[{"id":"acct_sqlt_1::business::effectiveDate::alt::0","field_value_id":"acct_sqlt_1::business::effectiveDate","user_id":"00000000-0000-0000-0000-00000000000f","value":"2026-09-01"}]',
  '[]', '[]', '[]', '[]');
select pg_temp.check('E5 a helper’s whole-account save goes through: the DOT number changes …', (select value #>> '{}' = '2222222' from field_values where id = 'acct_sqlt_1::transportation::dotNumber'));
select pg_temp.check('E6 … the effective date and its history stay as they were', (select value #>> '{}' = '2026-12-16' from field_values where id = 'acct_sqlt_1::business::effectiveDate') and (select string_agg(value #>> '{}', ',') = '2026-12-01' from field_alternates where field_value_id = 'acct_sqlt_1::business::effectiveDate'));
-- A stale whole-row save of the account (an older copy of the renewals) by the helper.
update submissions set named_insured = 'SQL Test Freight (stale save)', renewals = '[{"id":"r1","main":true,"status":"open","leadDays":45,"createdAt":"x","updatedAt":"x"}]' where id = 'acct_sqlt_1';
select pg_temp.check('E7 a helper’s stale save: the account change lands, the renewals stay as the broker left them', (select named_insured = 'SQL Test Freight (stale save)' and jsonb_array_length(renewals) = 2 and renewals->0->>'leadDays' = '30' from submissions where id = 'acct_sqlt_1'));

\echo '== an account that does not track renewals: unchanged'
update field_values set value = '"2026-12-24"' where id = 'acct_sqlt_3::business::effectiveDate';
select pg_temp.check('L1 a helper still edits its effective date as before', (select value #>> '{}' = '2026-12-24' from field_values where id = 'acct_sqlt_3::business::effectiveDate'));
update submissions set business_type = 'renewal', renewals = '[{"id":"z","main":true,"status":"open","createdAt":"x","updatedAt":"x"}]' where id = 'acct_sqlt_3';
select pg_temp.check('L2 … but cannot start tracking renewals on it', (select business_type is null and renewals = '[]'::jsonb from submissions where id = 'acct_sqlt_3'));

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('A3 another agent (not on the account) cannot see it', (select count(*) = 0 from submissions where id = 'acct_sqlt_1'));
with u as (update submissions set renewals = '[]' where id = 'acct_sqlt_1' returning 1)
select pg_temp.check('A4 another agent cannot change it', (select count(*) = 0 from u));

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('A5 the agency admin sees it', (select count(*) = 1 from submissions where id = 'acct_sqlt_1'));
with u as (update submissions set business_type = 'renewal' where id = 'acct_sqlt_1' returning 1)
select pg_temp.check('A6 the agency admin can change it', (select count(*) = 1 from u));

select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check('A7 an admin of another agency cannot see it', (select count(*) = 0 from submissions where id = 'acct_sqlt_1'));
with u as (update submissions set renewals = '[]' where id = 'acct_sqlt_1' returning 1)
select pg_temp.check('A8 an admin of another agency cannot change it', (select count(*) = 0 from u));

\echo '== the assigned broker changes the renewal date'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.replace_submission_children('acct_sqlt_1',
  '[{"id":"acct_sqlt_1::business::effectiveDate","submission_id":"acct_sqlt_1","user_id":"00000000-0000-0000-0000-00000000000a","section":"business","field_key":"effectiveDate","value":"2027-01-10","confidence":"manual","is_missing":false,"is_conflicting":false,"extraction_method":"manual_entry"},
    {"id":"acct_sqlt_1::transportation::dotNumber","submission_id":"acct_sqlt_1","user_id":"00000000-0000-0000-0000-00000000000a","section":"transportation","field_key":"dotNumber","value":"2222222","confidence":"manual","is_missing":false,"is_conflicting":false,"extraction_method":"manual_entry"}]',
  '[]', '[]', '[]', '[]', '[]');
update submissions set done_actions = done_actions || '{"renewal-acct_sqlt_1|2027-01-10|Renewal effective Jan 10":"2026-10-17T00:00:00Z"}' where id = 'acct_sqlt_1';
select pg_temp.check('A13 the assigned broker marks the renewal reminder done', (select done_actions ? 'renewal-acct_sqlt_1|2027-01-10|Renewal effective Jan 10' from submissions where id = 'acct_sqlt_1'));
select pg_temp.check('A0 the assigned broker changes the renewal date (the effective date)', (select value #>> '{}' = '2027-01-10' from field_values where id = 'acct_sqlt_1::business::effectiveDate'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
update field_values set value = '"2027-02-01"' where id = 'acct_sqlt_1::business::effectiveDate';
select pg_temp.check('A11 the agency admin changes it too', (select value #>> '{}' = '2027-02-01' from field_values where id = 'acct_sqlt_1::business::effectiveDate'));
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
with u as (update field_values set value = '"2030-01-01"' where id = 'acct_sqlt_1::business::effectiveDate' returning 1)
select pg_temp.check('A12 an admin of another agency cannot touch it', (select count(*) = 0 from u));
select pg_temp.as_user('');
reset role;
select pg_temp.check('A9 the start date is still the broker’s', (select renewals->0->>'leadDays' = '30' and business_type = 'renewal' from submissions where id = 'acct_sqlt_1'));
update submissions set renewals = jsonb_set(renewals, '{0,leadDays}', '5') where id = 'acct_sqlt_1';
select pg_temp.check('A10 the SQL editor / service role is not limited', (select renewals->0->>'leadDays' = '5' from submissions where id = 'acct_sqlt_1'));
rollback;
