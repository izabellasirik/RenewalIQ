-- 0054 account renewals: constraints, compatibility with saves that don't know the new columns, and
-- access (the columns follow the account's existing agency permissions — no new policies).
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

-- Fixture (as the SQL editor): Roman's account in Adriatic Agency, with a tracked renewal.
select pg_temp.as_user('');
insert into submissions (id, user_id, named_insured, organization_id, assigned_user_id, business_type, renewals)
select 'acct_sqlt_1', '00000000-0000-0000-0000-00000000000a', 'SQL Test Freight (sample)', a.id, '00000000-0000-0000-0000-00000000000a', 'renewal',
       '[{"id":"r1","main":true,"status":"open","leadDays":60,"createdAt":"2026-10-17T00:00:00Z","updatedAt":"2026-10-17T00:00:00Z"}]'::jsonb
from agencies a where a.name = 'Adriatic Agency';

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

select pg_temp.as_user('');
reset role;
select pg_temp.check('A9 nothing above changed it except the broker and admin', (select renewals->0->>'leadDays' = '30' and business_type = 'renewal' from submissions where id = 'acct_sqlt_1'));
rollback;
