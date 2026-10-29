-- 0080: Admin Review — an agent's possible duplicate account is flagged for the agency's admins. Run against a
-- disposable copy of a database with 0026, 0072 and 0080 applied (test users as in the agency RLS tests: admin …0d,
-- agents …0a and …0b). Fictional businesses only. One transaction, rolled back. One PASS/FAIL line each.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
create or replace function pg_temp.refused(sql text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return true;
end $$;
create or replace function pg_temp.agency() returns uuid language sql as $$ select agency_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d' $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, true); end $$;
create or replace function pg_temp.items(sub text) returns bigint language sql as $$ select count(*) from public.admin_review_items where submission_id = sub $$;
create or replace function pg_temp.dot(sub text, owner text, v text) returns void language sql as $$
  insert into public.field_values (id, submission_id, user_id, section, field_key, value) values (sub || '::dot', sub, owner::uuid, 'transportation', 'dotNumber', to_jsonb(v))
$$;
grant usage on schema public to authenticated;
select count(*) as admins from public.profiles where agency_id = pg_temp.agency() and role = 'admin' \gset

-- The agency already has Granite Peak Hauling Inc (USDOT 777001), assigned to agent …0b.
select pg_temp.as_user('') \g /dev/null
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id) values
  ('ar_existing', '00000000-0000-0000-0000-00000000000b', pg_temp.agency(), 'Granite Peak Hauling Inc', '00000000-0000-0000-0000-00000000000b');
select pg_temp.dot('ar_existing', '00000000-0000-0000-0000-00000000000b', '777001') \g /dev/null
select pg_temp.check('A0 an account with no match isn''t flagged', pg_temp.items('ar_existing') = 0);

-- 1. Agent …0a creates "Granite Peak Hauling LLC" (same name once "Inc"/"LLC" are dropped).
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id) values
  ('ar_dup1', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Granite Peak Hauling LLC', '00000000-0000-0000-0000-00000000000a');
select pg_temp.check('A1 flagged for review: the existing account, "same name", created by the agent',
  (select count(*) = 1 and bool_and(related_ids = array['ar_existing'] and status = 'open' and detail -> 'reasons' -> 'ar_existing' ? 'same_name' and created_by = '00000000-0000-0000-0000-00000000000a')
     from public.admin_review_items where submission_id = 'ar_dup1'));
select pg_temp.check('A2 every admin of the agency gets a bell notification linking to it', (select count(*) = :admins and bool_and(type = 'admin_review' and review_item_id is not null and message like '%created Granite Peak Hauling LLC, which may duplicate Granite Peak Hauling Inc.')
  from public.notifications where submission_id = 'ar_dup1'));
select pg_temp.check('A2b … and no agent is notified', not exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.user_id where n.submission_id = 'ar_dup1' and p.role <> 'admin'));

-- 2. Words reordered; a USDOT added later; a different USDOT.
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id) values
  ('ar_dup2', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Hauling Granite Peak', '00000000-0000-0000-0000-00000000000a'),
  ('ar_dup3', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Summit Ridge Freight', '00000000-0000-0000-0000-00000000000a'),
  ('ar_diff', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Lakeside Movers', '00000000-0000-0000-0000-00000000000a');
select pg_temp.check('A3 same words reordered → flagged', (select detail -> 'reasons' -> 'ar_existing' ? 'reordered_name' from public.admin_review_items where submission_id = 'ar_dup2'));
select pg_temp.check('A4 a different name isn''t flagged… ', pg_temp.items('ar_dup3') = 0);
select pg_temp.dot('ar_dup3', '00000000-0000-0000-0000-00000000000a', 'USDOT 0777001') \g /dev/null
select pg_temp.check('A4b … until the same USDOT is saved on it', (select detail -> 'reasons' -> 'ar_existing' ? 'same_dot' from public.admin_review_items where submission_id = 'ar_dup3'));
delete from public.field_values where submission_id = 'ar_dup3';
select pg_temp.dot('ar_dup3', '00000000-0000-0000-0000-00000000000a', '777001') \g /dev/null
select pg_temp.check('A5 saving it again (the app re-saves every field) adds no second item or notification',
  pg_temp.items('ar_dup3') = 1 and (select count(*) = :admins from public.notifications where submission_id = 'ar_dup3'));
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id) values
  ('ar_conflict', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Lakeside Movers Inc', '00000000-0000-0000-0000-00000000000a');
select pg_temp.dot('ar_conflict', '00000000-0000-0000-0000-00000000000a', '123') \g /dev/null
select pg_temp.dot('ar_diff', '00000000-0000-0000-0000-00000000000a', '456') \g /dev/null
select pg_temp.check('A6 same name but a different USDOT → a different business (flag from the name is kept, no new one)',
  (select count(*) <= 1 from public.admin_review_items where submission_id = 'ar_conflict'));

-- 3. Not flagged: an admin's own account; a personal account; another agency's account.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id) values
  ('ar_admin', '00000000-0000-0000-0000-00000000000d', pg_temp.agency(), 'Granite Peak Hauling', '00000000-0000-0000-0000-00000000000d');
select pg_temp.check('A7 an admin''s own account isn''t flagged', pg_temp.items('ar_admin') = 0);
-- …0c has no agency: a personal account.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c') \g /dev/null
insert into public.submissions (id, user_id, organization_id, named_insured) values ('ar_personal', '00000000-0000-0000-0000-00000000000c', null, 'Granite Peak Hauling');
select pg_temp.check('A8 a personal account (no agency) isn''t flagged', pg_temp.items('ar_personal') = 0);
select pg_temp.as_user('') \g /dev/null
insert into public.agencies (id, name) values ('bbbbbbbb-0000-0000-0000-000000000080', 'Other Agency 0080');
insert into public.submissions (id, user_id, organization_id, named_insured) values ('ar_other', '00000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000080', 'Granite Peak Hauling');
select pg_temp.check('A9 another agency''s accounts are never compared', pg_temp.items('ar_other') = 0
  and (select organization_id = 'bbbbbbbb-0000-0000-0000-000000000080' from public.submissions where id = 'ar_other'));
select (select id from public.admin_review_items where submission_id = 'ar_dup1') as item1, (select id from public.admin_review_items where submission_id = 'ar_dup2') as item2 \gset

-- 4. Admins read and decide; agents can't.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select pg_temp.check('A10 an agent sees no review items and can''t decide or read the table', (select count(*) = 0 from public.admin_review_items())
  and pg_temp.refused(format($$select public.resolve_admin_review(%L, 'keep_both')$$, :'item1'))
  and pg_temp.refused($$select * from public.admin_review_items$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('A11 the admin sees them with both accounts (names, agents)', (select count(*) >= 3 from public.admin_review_items() where status = 'open')
  and (select related -> 0 ->> 'name' = 'Granite Peak Hauling Inc' and account_name = 'Granite Peak Hauling LLC' and created_by_name is not null from public.admin_review_items() where submission_id = 'ar_dup1'));
select pg_temp.check('A12 Keep both → decided, bell read', public.resolve_admin_review(:'item1', 'keep_both') = 'kept_both');
reset role;
select pg_temp.check('A12b … every admin''s notification for it is read; the account is untouched',
  not exists (select 1 from public.notifications where submission_id = 'ar_dup1' and read_at is null)
  and (select not coalesce(archived, false) from public.submissions where id = 'ar_dup1'));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('A13 Archive the new one → it''s archived (restorable), decided', public.resolve_admin_review(:'item2', 'archive_new') = 'archived_new');
reset role;
select pg_temp.check('A13b … archived', (select archived from public.submissions where id = 'ar_dup2'));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('A14 a decided item can''t be decided again', pg_temp.refused(format($$select public.resolve_admin_review(%L, 'archive_new')$$, :'item1')));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
update public.field_values set value = '"777001"' where submission_id = 'ar_dup3';
insert into public.field_values (id, submission_id, user_id, section, field_key, value) values ('ar_dup1::dot', 'ar_dup1', '00000000-0000-0000-0000-00000000000a', 'transportation', 'dotNumber', '"777001"');
select pg_temp.check('A15 after Keep both: re-saving adds nothing; a genuinely new match (same USDOT as ar_dup3) is flagged once',
  (select count(*) = 2 and count(*) filter (where status = 'open') = 1 from public.admin_review_items where submission_id = 'ar_dup1')
  and (select bool_and(not ('ar_existing' = any (related_ids))) from public.admin_review_items where submission_id = 'ar_dup1' and status = 'open'));
select public.admin_review_check_duplicate('ar_dup1', '00000000-0000-0000-0000-00000000000a') \g /dev/null
select public.admin_review_check_duplicate('ar_dup1', '00000000-0000-0000-0000-00000000000a') \g /dev/null
select pg_temp.check('A15b … and checking again changes nothing', pg_temp.items('ar_dup1') = 2);
select pg_temp.check('A16 anon can''t call the review functions', not has_function_privilege('anon', 'public.admin_review_items()', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_review_check_duplicate(text,uuid)', 'execute'));
rollback;
