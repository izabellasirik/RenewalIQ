-- 0092 receipts on income and expenses: an admin attaches files in their own agency's folder; nobody
-- else can upload, open or delete them. Run against a disposable copy of a database with 0059 and 0092
-- applied (agencies and users as in the agency RLS tests: Adriatic Agency — Denis admin, Roman agent;
-- Other Co — QA1 admin). Fictional data. Everything runs in one transaction and is rolled back.
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
-- Another agency than Denis's (read before the RLS role is taken).
insert into ids select 'other_agency', a.id from agencies a where a.id <> (select agency_id from profiles where user_id = '00000000-0000-0000-0000-00000000000d') limit 1;
insert into ids select 'other_admin', p.user_id from profiles p where p.agency_id = (select id from ids where name = 'other_agency') and p.role = 'admin' limit 1;
grant all on ids to authenticated;
grant usage on schema public to authenticated;
set local role authenticated;

\echo '== receipts on an entry'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
with x as (insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents, receipts)
  values (public.current_agency_id(), 'expense', '2026-10-01', 'Rent', 250000,
          jsonb_build_array(jsonb_build_object('path', public.current_agency_id()::text || '/f1/rent-receipt.pdf', 'name', 'rent-receipt.pdf', 'size', 1200, 'type', 'application/pdf'))) returning id)
insert into ids select 'rent', id from x;
select pg_temp.check('R1 an admin saves an entry with a receipt in the agency folder', (select jsonb_array_length(receipts) = 1 from agency_money_entries where id = (select id from ids where name = 'rent')));
with y as (insert into agency_money_entries (agency_id, kind, entry_date, category, amount_cents) values (public.current_agency_id(), 'income', '2026-10-02', 'Agency fees', 5000) returning id)
insert into ids select 'fee', id from y;
select pg_temp.check('R2 an entry without receipts has an empty list', (select receipts = '[]'::jsonb from agency_money_entries where id = (select id from ids where name = 'fee')));
select pg_temp.check('R3 a receipt in another agency''s folder is refused', pg_temp.refused($$update agency_money_entries set receipts = jsonb_build_array(jsonb_build_object('path', (select id from ids where name = 'other_agency')::text || '/f1/x.pdf', 'name', 'x.pdf')) where id = (select id from ids where name = 'rent')$$));
select pg_temp.check('R4 a path climbing out of the folder is refused', pg_temp.refused($$update agency_money_entries set receipts = jsonb_build_array(jsonb_build_object('path', public.current_agency_id()::text || '/../x.pdf', 'name', 'x.pdf')) where id = (select id from ids where name = 'rent')$$));
select pg_temp.check('R5 more than 10 receipts are refused', pg_temp.refused($$update agency_money_entries set receipts = (select jsonb_agg(jsonb_build_object('path', public.current_agency_id()::text || '/f/' || g || '.pdf', 'name', g || '.pdf')) from generate_series(1, 11) g) where id = (select id from ids where name = 'rent')$$));
select pg_temp.check('R6 a receipt without a name is refused', pg_temp.refused($$update agency_money_entries set receipts = jsonb_build_array(jsonb_build_object('path', public.current_agency_id()::text || '/f1/x.pdf', 'name', ' ')) where id = (select id from ids where name = 'rent')$$));

\echo '== the files'
insert into storage.objects (bucket_id, name) values ('agency-receipts', public.current_agency_id()::text || '/f1/rent-receipt.pdf');
select pg_temp.check('R7 the admin uploads into the agency folder and can open it', (select count(*) = 1 from storage.objects where bucket_id = 'agency-receipts'));
select pg_temp.check('R8 the admin can''t upload into another agency''s folder', pg_temp.refused($$insert into storage.objects (bucket_id, name) values ('agency-receipts', (select id from ids where name = 'other_agency')::text || '/f1/x.pdf')$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('R9 an agent of the same agency can''t see the receipt', (select count(*) = 0 from storage.objects where bucket_id = 'agency-receipts'));
select pg_temp.check('R10 an agent can''t upload a receipt', pg_temp.refused($$insert into storage.objects (bucket_id, name) values ('agency-receipts', public.current_agency_id()::text || '/f2/x.pdf')$$));
select pg_temp.as_user((select id::text from ids where name = 'other_admin'));
select pg_temp.check('R11a (the other admin is signed in to their own agency)', public.current_agency_id() = (select id from ids where name = 'other_agency') and public.is_agency_admin());
select pg_temp.check('R11 another agency''s admin can''t see the receipt', (select count(*) = 0 from storage.objects where bucket_id = 'agency-receipts'));
delete from storage.objects where bucket_id = 'agency-receipts';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('R12 another agency''s admin couldn''t delete it', (select count(*) = 1 from storage.objects where bucket_id = 'agency-receipts'));
delete from storage.objects where bucket_id = 'agency-receipts';
select pg_temp.check('R13 the admin deletes it', (select count(*) = 0 from storage.objects where bucket_id = 'agency-receipts'));
rollback;
