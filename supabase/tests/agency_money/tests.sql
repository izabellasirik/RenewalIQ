-- 0059 agency income and expenses: only the agency's admins can see or change them; the database stamps
-- who and when; amounts and kinds are checked. Run against a disposable copy of a database with 0059
-- applied (agencies and users as in the agency RLS tests: Adriatic Agency — Denis admin, Roman agent;
-- Other Co — QA1 admin). Fictional data. Everything runs in one transaction and is rolled back.
-- Prints one PASS/FAIL line per check.
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
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;
grant usage on schema public to authenticated;
set local role authenticated;

\echo '== an admin records income and expenses'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
with x as (insert into agency_money_entries (agency_id, kind, entry_date, category, description, amount_cents, created_by)
  values (public.current_agency_id(), 'expense', '2026-10-01', 'Rent', 'October office rent (sample)', 250000, '00000000-0000-0000-0000-00000000000a') returning id)
insert into ids select 'rent', id from x;
with x as (insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents)
  values (public.current_agency_id(), 'income', '2026-10-05', 'Carrier commission', 1234567) returning id)
insert into ids select 'comm', id from x;
select pg_temp.check('M1 the admin sees both entries', (select count(*) = 2 from agency_money_entries));
select pg_temp.check('M2 who created it is stamped by the database (a forged creator is replaced)', (select created_by = '00000000-0000-0000-0000-00000000000d' from agency_money_entries where id = (select id from ids where name = 'rent')));
update agency_money_entries set amount_cents = 260000, agency_id = (select id from agencies where name <> 'Adriatic Agency' limit 1), created_by = '00000000-0000-0000-0000-00000000000a' where id = (select id from ids where name = 'rent');
select pg_temp.check('M3 the admin edits the amount; the agency and creator can''t be changed', (select amount_cents = 260000 and agency_id = public.current_agency_id() and created_by = '00000000-0000-0000-0000-00000000000d' and updated_by = '00000000-0000-0000-0000-00000000000d' from agency_money_entries where id = (select id from ids where name = 'rent')));
select pg_temp.check('M4 a zero amount is refused', pg_temp.refused($$insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents) values (public.current_agency_id(), 'expense', '2026-10-01', 'Rent', 0)$$));
select pg_temp.check('M5 a negative amount is refused', pg_temp.refused($$insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents) values (public.current_agency_id(), 'expense', '2026-10-01', 'Rent', -5)$$));
select pg_temp.check('M6 an unknown kind is refused', pg_temp.refused($$insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents) values (public.current_agency_id(), 'transfer', '2026-10-01', 'Rent', 5)$$));
select pg_temp.check('M7 a blank category is refused', pg_temp.refused($$insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents) values (public.current_agency_id(), 'expense', '2026-10-01', '  ', 5)$$));
select pg_temp.check('M8 an entry for another agency is refused', pg_temp.refused($$insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents) values ((select id from agencies where name <> 'Adriatic Agency' limit 1), 'expense', '2026-10-01', 'Rent', 5)$$));

\echo '== an agent sees and changes nothing'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('A1 an agent sees no entries', (select count(*) = 0 from agency_money_entries));
select pg_temp.check('A2 an agent can''t add one', pg_temp.refused($$insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents) values (public.current_agency_id(), 'expense', '2026-10-01', 'Rent', 5)$$));
update agency_money_entries set amount_cents = 1 where true;
delete from agency_money_entries where true;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('A3 an agent''s update and delete change nothing', (select count(*) = 2 and min(amount_cents) = 260000 from agency_money_entries));

\echo '== another agency''s admin sees nothing'
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check('O1 another agency''s admin sees none of them', (select count(*) = 0 from agency_money_entries));
delete from agency_money_entries where true;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('O2 … and can''t delete them', (select count(*) = 2 from agency_money_entries));

\echo '== the admin deletes one; anonymous gets nothing'
delete from agency_money_entries where id = (select id from ids where name = 'comm');
select pg_temp.check('D1 the admin deletes an entry', (select count(*) = 1 from agency_money_entries));
reset role;
set local role anon;
select pg_temp.check('E1 anonymous: can''t read', pg_temp.refused($$select 1 from public.agency_money_entries$$));
select pg_temp.check('E2 anonymous: can''t add', pg_temp.refused($$insert into public.agency_money_entries (agency_id, kind, entry_date, category, amount_cents) values (gen_random_uuid(), 'expense', '2026-10-01', 'Rent', 5)$$));
reset role;
rollback;
