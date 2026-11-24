-- 0097 statement periods on income & expenses: both dates or neither, in order, at most a year.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
create or replace function pg_temp.refused(sql text) returns boolean language plpgsql as $$ begin execute sql; return false; exception when others then return true; end $$;
create temp table a as select id from agencies limit 1;
select pg_temp.check('S1 an entry covering Nov 16–22 saves', not pg_temp.refused($$insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents, covers_from, covers_to) values ((select id from a), 'income', '2026-11-22', 'Carrier commission', 100, '2026-11-16', '2026-11-22')$$));
select pg_temp.check('S2 an ordinary entry (no dates) saves', not pg_temp.refused($$insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents) values ((select id from a), 'expense', '2026-11-22', 'Rent', 100)$$));
select pg_temp.check('S3 only one of the two dates is refused', pg_temp.refused($$insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents, covers_from) values ((select id from a), 'income', '2026-11-22', 'x', 100, '2026-11-16')$$));
select pg_temp.check('S4 dates the wrong way round are refused', pg_temp.refused($$insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents, covers_from, covers_to) values ((select id from a), 'income', '2026-11-22', 'x', 100, '2026-11-22', '2026-11-16')$$));
rollback;
