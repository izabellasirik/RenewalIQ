-- 0082: saved notes summaries on account cards. Run against a disposable copy of a database with 0011, 0046,
-- 0062 and 0082 applied (test users as in the agency RLS tests: admin …0d, agent …0a, outsider …0c).
-- Fictional accounts and notes only. One transaction, rolled back. One PASS/FAIL line each.
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
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, true); end $$;
grant usage on schema public to authenticated;

select pg_temp.as_user('') \g /dev/null
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id) values
  ('ns_a', '00000000-0000-0000-0000-00000000000a', (select agency_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d'), 'Notes Client A (sample)', '00000000-0000-0000-0000-00000000000a');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
insert into public.account_note_summaries (submission_id, summary, notes_hash, created_by, created_by_name)
  values ('ns_a', 'Waiting on loss runs from the client.', 'h1', '00000000-0000-0000-0000-00000000000a', 'Agent A');
select pg_temp.check('S1 the account''s agent saves a summary and reads it', (select count(*) = 1 from public.account_note_summaries where submission_id = 'ns_a'));
select pg_temp.check('S2 … but not in someone else''s name', pg_temp.refused($$update public.account_note_summaries set created_by = '00000000-0000-0000-0000-00000000000d' where submission_id = 'ns_a'$$));

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('S3 an agency admin sees it', (select summary = 'Waiting on loss runs from the client.' from public.account_note_summaries where submission_id = 'ns_a'));
update public.account_note_summaries set summary = 'Quoted with Sample Mutual.', notes_hash = 'h2', created_by = '00000000-0000-0000-0000-00000000000d', created_by_name = 'Admin' where submission_id = 'ns_a';
select pg_temp.check('S4 … and can summarize again (replaces it)', (select notes_hash = 'h2' from public.account_note_summaries where submission_id = 'ns_a'));

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c') \g /dev/null
select pg_temp.check('S5 someone outside the agency sees nothing', (select count(*) = 0 from public.account_note_summaries));
select pg_temp.check('S6 … and can''t write one for the account', pg_temp.refused($$insert into public.account_note_summaries (submission_id, summary, notes_hash, created_by) values ('ns_a', 'x', 'h', '00000000-0000-0000-0000-00000000000c')$$));
update public.account_note_summaries set summary = 'hijack' where submission_id = 'ns_a';
reset role;
select pg_temp.check('S7 … nor change the saved one', (select summary = 'Quoted with Sample Mutual.' from public.account_note_summaries where submission_id = 'ns_a'));
set local role authenticated;
select pg_temp.as_user('') \g /dev/null
select pg_temp.check('S8 signed out sees nothing', (select count(*) = 0 from public.account_note_summaries));
reset role;
select pg_temp.check('S9 anon has no access; summaries can''t be deleted by users', not has_table_privilege('anon', 'public.account_note_summaries', 'select')
  and not has_table_privilege('authenticated', 'public.account_note_summaries', 'delete'));
insert into public.ai_usage_events (operation, succeeded) values ('notes_summary', true);
select pg_temp.check('S10 the AI usage log accepts notes_summary', true);
delete from public.submissions where id = 'ns_a';
select pg_temp.check('S11 deleting the account deletes its summary', (select count(*) = 0 from public.account_note_summaries where submission_id = 'ns_a'));
rollback;
