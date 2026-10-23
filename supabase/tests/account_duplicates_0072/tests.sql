-- 0072: New Account's duplicate check. Run against a disposable copy of a database with 0011–0047 applied
-- (e.g. the agency RLS test database, KEEP_DB=1), then 0072. Fictional agencies, people and businesses only.
-- One transaction, rolled back. Prints one PASS/FAIL line per check.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, true); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;

-- Agency A: admin Ada, agents Ben and Cy. Agency B: agent Bo. Pat: no agency.
insert into auth.users (id, email) values
  ('0000000a-0000-0000-0000-0000000000a1', 'ada@a.example'), ('0000000a-0000-0000-0000-0000000000a2', 'ben@a.example'),
  ('0000000a-0000-0000-0000-0000000000a3', 'cy@a.example'), ('0000000b-0000-0000-0000-0000000000b1', 'bo@b.example'),
  ('0000000c-0000-0000-0000-0000000000c1', 'pat@solo.example');
insert into public.agencies (id, name) values ('aaaaaaaa-0000-0000-0000-000000000072', 'Agency A 0072'), ('bbbbbbbb-0000-0000-0000-000000000072', 'Agency B 0072');
insert into public.profiles (user_id, agency_id, role, display_name, email) values
  ('0000000a-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000072', 'admin', 'Ada Admin', 'ada@a.example'),
  ('0000000a-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000072', 'agent', 'Ben Agent', 'ben@a.example'),
  ('0000000a-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000072', 'agent', 'Cy Agent', 'cy@a.example'),
  ('0000000b-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000072', 'agent', 'Bo Other', 'bo@b.example');
-- Ben's accounts (Cy can't open them); Bo's account in agency B; Pat's personal account.
insert into public.submissions (id, user_id, named_insured, organization_id, assigned_user_id) values
  ('d72_ben1', '0000000a-0000-0000-0000-0000000000a2', 'Blue Ridge Logistics LLC', 'aaaaaaaa-0000-0000-0000-000000000072', '0000000a-0000-0000-0000-0000000000a2'),
  ('d72_ben2', '0000000a-0000-0000-0000-0000000000a2', 'Granite Peak Hauling Inc', 'aaaaaaaa-0000-0000-0000-000000000072', '0000000a-0000-0000-0000-0000000000a2'),
  ('d72_cy1',  '0000000a-0000-0000-0000-0000000000a3', 'Granite Peak Hauling Inc', 'aaaaaaaa-0000-0000-0000-000000000072', '0000000a-0000-0000-0000-0000000000a3'),
  ('d72_bo1',  '0000000b-0000-0000-0000-0000000000b1', 'Blue Ridge Logistics LLC', 'bbbbbbbb-0000-0000-0000-000000000072', '0000000b-0000-0000-0000-0000000000b1'),
  ('d72_pat1', '0000000c-0000-0000-0000-0000000000c1', 'Solo Freight Co', null, '0000000c-0000-0000-0000-0000000000c1');
insert into public.field_values (id, submission_id, user_id, section, field_key, value) values
  ('fv72_1', 'd72_ben1', '0000000a-0000-0000-0000-0000000000a2', 'transportation', 'dotNumber', '"0123456"'),
  ('fv72_2', 'd72_ben1', '0000000a-0000-0000-0000-0000000000a2', 'transportation', 'mcNumber', '"MC-045678"'),
  ('fv72_3', 'd72_ben2', '0000000a-0000-0000-0000-0000000000a2', 'transportation', 'dotNumber', '"777001"'),
  ('fv72_4', 'd72_bo1', '0000000b-0000-0000-0000-0000000000b1', 'transportation', 'dotNumber', '"999999"');
create temp table before_counts as select (select count(*) from public.submissions) s, (select count(*) from public.field_values) f;
grant select on before_counts to authenticated;

set local role authenticated;

-- Signed out: refused.
select pg_temp.as_user('');
do $$ begin perform * from public.find_account_duplicates('Blue Ridge Logistics', null, null); raise notice 'FAIL D1 signed out allowed';
exception when insufficient_privilege then raise notice 'PASS D1 signed out refused'; end $$;

-- Cy (agency A) — can't open Ben's accounts.
select pg_temp.as_user('0000000a-0000-0000-0000-0000000000a3');
select pg_temp.check('D2 same name: Ben''s account found, no id, name + assigned broker only',
  (select count(*) = 1 and bool_and(account_id is null and not can_open and named_insured = 'Blue Ridge Logistics LLC' and assigned_name = 'Ben Agent'
          and reasons = array['same_name'] and similarity is null)
     from public.find_account_duplicates('The Blue Ridge Logistics, Inc.', null, null)));
select pg_temp.check('D3 other agency never returned (Bo''s same-name account in agency B)',
  (select count(*) = 0 from public.find_account_duplicates('Blue Ridge Logistics', null, null) where named_insured is not null and assigned_name = 'Bo Other'));
select pg_temp.check('D4 same USDOT (any name), inaccessible: found by number, nothing else revealed',
  (select count(*) = 1 and bool_and(account_id is null and reasons = array['same_dot']) from public.find_account_duplicates('Something Else', 'USDOT 123456', null)));
select pg_temp.check('D5 same MC, inaccessible',
  (select count(*) = 1 and bool_and(reasons = array['same_mc']) from public.find_account_duplicates('Something Else', null, '45678')));
select pg_temp.check('D6 reordered words, inaccessible (strong): found',
  (select count(*) = 1 and bool_and(reasons = array['reordered_name']) from public.find_account_duplicates('Logistics Blue Ridge', null, null)));
select pg_temp.check('D7 similar name on an inaccessible account: NOT returned',
  (select count(*) = 0 from public.find_account_duplicates('Blue Ridge Logistic', null, null)));
select pg_temp.check('D8 similar name on an account Cy can open: returned with id and similarity >= 0.85',
  (select count(*) = 1 and bool_and(account_id = 'd72_cy1' and can_open and reasons = array['similar_name'] and similarity >= 0.85)
     from public.find_account_duplicates('Granite Peak Haulin', null, null) where can_open));
select pg_temp.check('D9 different USDOT with the same name: not a match',
  (select count(*) = 0 from public.find_account_duplicates('Blue Ridge Logistics', '555', null)));
select pg_temp.check('D10 Bo''s USDOT is not found from agency A',
  (select count(*) = 0 from public.find_account_duplicates('Nothing Alike', '999999', null)));
select pg_temp.check('D11 names that only share a word are not matches',
  (select count(*) = 0 from public.find_account_duplicates('Red Ridge Trucking', null, null)));
select pg_temp.check('D12 names under 3 letters are not compared',
  (select count(*) = 0 from public.find_account_duplicates('BR', null, null)));

-- Ben (owner) sees his own account with its id.
select pg_temp.as_user('0000000a-0000-0000-0000-0000000000a2');
select pg_temp.check('D13 an account the caller can open comes back with its id',
  (select count(*) = 1 and bool_and(account_id = 'd72_ben1' and can_open) from public.find_account_duplicates('Blue Ridge Logistics', null, null)));
-- Ada (admin) opens every agency account.
select pg_temp.as_user('0000000a-0000-0000-0000-0000000000a1');
select pg_temp.check('D14 admin: both Granite Peak accounts, with ids',
  (select count(*) = 2 and bool_and(can_open and account_id is not null) from public.find_account_duplicates('Granite Peak Hauling', null, null)));
-- Bo (agency B) only sees agency B.
select pg_temp.as_user('0000000b-0000-0000-0000-0000000000b1');
select pg_temp.check('D15 agency B: only its own account',
  (select count(*) = 1 and bool_and(account_id = 'd72_bo1') from public.find_account_duplicates('Blue Ridge Logistics', null, null)));
-- Pat (no agency): only Pat's personal accounts; nobody else sees Pat's.
select pg_temp.as_user('0000000c-0000-0000-0000-0000000000c1');
select pg_temp.check('D16 no agency: own personal accounts only',
  (select count(*) = 1 and bool_and(account_id = 'd72_pat1') from public.find_account_duplicates('Solo Freight', null, null))
  and (select count(*) = 0 from public.find_account_duplicates('Blue Ridge Logistics', '123456', null)));
select pg_temp.as_user('0000000a-0000-0000-0000-0000000000a1');
select pg_temp.check('D17 a personal account is never visible to an agency',
  (select count(*) = 0 from public.find_account_duplicates('Solo Freight', null, null)));
reset role;
select pg_temp.check('D18 nothing was written', (select s = (select count(*) from public.submissions) and f = (select count(*) from public.field_values) from before_counts));
select pg_temp.check('D19 anon cannot call it', not has_function_privilege('anon', 'public.find_account_duplicates(text, text, text)', 'execute'));
select pg_temp.check('D20 intake check (0039) untouched', to_regprocedure('public.find_intake_duplicate_accounts(text)') is not null
  and public.normalize_company_name('ABC Trucking LLC') = 'abc trucking');
rollback;
