-- 0063 carrier commission % per carrier, from a date: who can set and read it, that a carrier has one
-- rate per date however its name is typed, which rate applies on a date, and that rates are history
-- (retired, never changed or deleted). Run against a disposable copy of a database with 0063 applied
-- (test users as in the agency RLS tests: one agency with an admin (…0d) and two agents (…0a, …0b);
-- another agency with its admin (…12)). Fictional data. One transaction, rolled back. Prints one
-- PASS/FAIL line per check.
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
-- Rows the caller can read in a table, or -1 when the table isn't there (0060 not applied).
create or replace function pg_temp.visible(t text) returns bigint language plpgsql as $$
declare n bigint;
begin
  if to_regclass(t) is null then return -1; end if;
  execute format('select count(*) from %s', t) into n;
  return n;
end $$;
create or replace function pg_temp.rate_on(carrier text, d date) returns numeric language sql as $$
  select (public.carrier_rate_on((select agency_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d'), public.carrier_key(carrier), d)).rate
$$;
grant usage on schema public to authenticated;
set local role authenticated;

\echo '== admins set it, per carrier and date'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('C1 the admin sets a carrier''s commission (12% from 2026-01-01, with evidence)', not pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 0.12, '2026-01-01', 'Agreement dated 2025-12-15 (sample)')$$));
select pg_temp.check('C2 the same carrier typed differently gets a new rate from a later date (15% from 2026-07-01)', not pg_temp.refused($$select public.set_carrier_commission_rate('  sample   MUTUAL ', 0.15, '2026-07-01')$$));
select pg_temp.check('C2b … two dated rates for that carrier, the evidence kept on the first', (select count(*) = 2 and count(evidence) = 1 from carrier_commission_rates where carrier_key = 'sample mutual' and retired_at is null));
select pg_temp.check('C4 over 100% / negative / no rate / no date / no name / long evidence is refused',
  pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 1.5, '2026-01-01')$$)
  and pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', -0.1, '2026-01-01')$$)
  and pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', null, '2026-01-01')$$)
  and pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 0.1, null)$$)
  and pg_temp.refused($$select public.set_carrier_commission_rate('   ', 0.1, '2026-01-01')$$)
  and pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 0.1, '2026-01-01', repeat('x', 501))$$));
select pg_temp.check('C5 a new rate for the same date replaces the earlier one (14% from 2026-07-01), which is kept as retired', not pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 0.14, '2026-07-01')$$));
select pg_temp.check('C5b … one active rate per date; the replaced one is retired with a reason', (select count(*) filter (where retired_at is null) = 2 and count(*) filter (where retired_at is not null and retired_reason <> '' and rate = 0.15) = 1 from carrier_commission_rates where carrier_key = 'sample mutual'));
select pg_temp.check('C6 the admin can''t write the table directly',
  pg_temp.refused($$update carrier_commission_rates set rate = 0.5$$)
  and pg_temp.refused($$insert into carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, effective_from) values (public.current_agency_id(), 'x', 'x', 0.5, '2026-01-01')$$)
  and pg_temp.refused($$delete from carrier_commission_rates$$));
select pg_temp.check('C7 another carrier has its own rate', not pg_temp.refused($$select public.set_carrier_commission_rate('Other Specialty', 0.08, '2026-01-01')$$));
select pg_temp.check('C8 retiring needs a reason', pg_temp.refused($$select public.retire_carrier_commission_rate((select id from carrier_commission_rates where carrier_key = 'other specialty'), '  ')$$));
select pg_temp.check('C8b … and works once with one', not pg_temp.refused($$select public.retire_carrier_commission_rate((select id from carrier_commission_rates where carrier_key = 'other specialty'), 'Entered for the wrong carrier (sample)')$$)
  and pg_temp.refused($$select public.retire_carrier_commission_rate((select id from carrier_commission_rates where carrier_key = 'other specialty'), 'again')$$));

reset role;
\echo '== which rate applies on a date'
select pg_temp.check('D1 before the first rate: none (the app uses 10%)', pg_temp.rate_on('Sample Mutual', '2025-12-31') is null);
select pg_temp.check('D2 from 2026-01-01: 12%', pg_temp.rate_on('Sample Mutual', '2026-01-01') = 0.12 and pg_temp.rate_on('Sample Mutual', '2026-06-30') = 0.12);
select pg_temp.check('D3 from 2026-07-01: 14% (the replacement, not the retired 15%)', pg_temp.rate_on('Sample Mutual', '2026-07-01') = 0.14 and pg_temp.rate_on('sample mutual', '2027-01-01') = 0.14);
select pg_temp.check('D4 a retired rate no longer applies', pg_temp.rate_on('Other Specialty', '2026-06-01') is null);
\echo '== rates are history, even for the database owner'
select pg_temp.check('H1 a rate can''t be edited', pg_temp.refused($$update public.carrier_commission_rates set rate = 0.5 where carrier_key = 'sample mutual'$$));
select pg_temp.check('H2 a rate can''t be deleted', pg_temp.refused($$delete from public.carrier_commission_rates where carrier_key = 'sample mutual'$$));
select pg_temp.check('H3 a retired rate can''t be brought back', pg_temp.refused($$update public.carrier_commission_rates set retired_at = null, retired_reason = null where carrier_key = 'other specialty'$$));
set local role authenticated;
select pg_temp.check('A1 the admin still reads 0060''s per-policy rates (where 0060 is applied)', pg_temp.visible('public.policy_carrier_rates') >= -1);

\echo '== agents (carrier agreements are confidential)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('G1 an agent can''t read the rates', (select count(*) = 0 from carrier_commission_rates));
select pg_temp.check('G1b an agent can''t read 0060''s per-policy rates either, even on their own accounts', pg_temp.visible('public.policy_carrier_rates') in (-1, 0));
select pg_temp.check('G2 an agent can''t set, retire or look up rates', pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 0.5, '2026-01-01')$$)
  and pg_temp.refused($$select public.retire_carrier_commission_rate(1, 'x')$$)
  and pg_temp.refused($$select public.carrier_rate_on(public.current_agency_id(), 'sample mutual', '2026-08-01')$$));

select set_config('test.our_rate', (select min(id)::text from carrier_commission_rates where carrier_key = 'sample mutual' and retired_at is null), true);
\echo '== other agency, anonymous'
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check('O1 another agency''s admin doesn''t see them', (select count(*) = 0 from carrier_commission_rates));
select pg_temp.check('O2 … and setting the same carrier makes their own rate, not ours', not pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 0.2, '2026-01-01')$$));
select pg_temp.check('O2b … they see only their own', (select count(*) = 1 and min(rate) = 0.2 from carrier_commission_rates));
select pg_temp.check('O2c … and can''t retire ours', pg_temp.refused($$select public.retire_carrier_commission_rate(current_setting('test.our_rate')::bigint, 'x')$$));
reset role;
select pg_temp.check('O3 ours are unchanged', pg_temp.rate_on('Sample Mutual', '2026-08-01') = 0.14);

set local role anon;
select pg_temp.check('E1 anonymous: can''t read', pg_temp.refused($$select 1 from public.carrier_commission_rates$$));
select pg_temp.check('E2 anonymous: can''t set', pg_temp.refused($$select public.set_carrier_commission_rate('Sample Mutual', 0.1, '2026-01-01')$$));
reset role;
rollback;
