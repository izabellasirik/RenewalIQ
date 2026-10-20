-- 0068 Related Emails: owner-only access, server-only tokens, suggestions, and Reviewed / Not Related / Undo.
-- Run against a disposable copy of a database with 0068 applied (test users as in the agency RLS tests:
-- agents …0a and …0b and admin …0d in one agency; admin …12 in another). Synthetic data only. One
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
create or replace function pg_temp.agency(u text) returns uuid language sql as $$ select agency_id from public.profiles where user_id = u::uuid $$;
create or replace function pg_temp.link(acct text) returns public.email_account_links language sql as $$
  select l.* from public.email_account_links l where l.submission_id = acct and l.owner_user_id = '00000000-0000-0000-0000-00000000000a' order by l.created_at limit 1 $$;
grant usage on schema public to authenticated, service_role;
select set_config('request.jwt.claim.sub', '', true);

-- Synthetic accounts: two of agent A's, one of agent B's.
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id) values
  ('acct_re_1', '00000000-0000-0000-0000-00000000000a', pg_temp.agency('00000000-0000-0000-0000-00000000000a'), 'Sample Haulers LLC', '00000000-0000-0000-0000-00000000000a'),
  ('acct_re_2', '00000000-0000-0000-0000-00000000000a', pg_temp.agency('00000000-0000-0000-0000-00000000000a'), 'Example Freight Inc', '00000000-0000-0000-0000-00000000000a'),
  ('acct_re_b', '00000000-0000-0000-0000-00000000000b', pg_temp.agency('00000000-0000-0000-0000-00000000000b'), 'B Only Trucking', '00000000-0000-0000-0000-00000000000b');
-- Agent A connects Gmail (written by the server).
insert into public.gmail_connections (user_id, agency_id, email_address) values ('00000000-0000-0000-0000-00000000000a', pg_temp.agency('00000000-0000-0000-0000-00000000000a'), 'agent.a@agency.example');
insert into public.gmail_tokens (user_id, refresh_token_ciphertext) values ('00000000-0000-0000-0000-00000000000a', 'v1:synthetic-ciphertext');

-- The server records a thread; the broker's app suggests it (the matcher runs in the app).
set local role service_role;
select set_config('test.t1', public.email_record_thread('00000000-0000-0000-0000-00000000000a', 'thr_1', 'Loss runs for Sample Haulers', 'Pat Client', 'pat@client.example', 'msg_1', now() - interval '1 day', 1)::text, true);
select pg_temp.check('S4 a mailbox that isn''t connected can''t record threads', pg_temp.refused($$select public.email_record_thread('00000000-0000-0000-0000-00000000000b', 'thr_x', 's', null, null, 'm', now(), 1)$$));
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('S1 the broker suggests their thread for an account they can open (as possible)',
  public.email_suggest_link(current_setting('test.t1')::uuid, 'acct_re_1', '[{"kind":"name","detail":"The email names Sample Haulers LLC"}]') is not null);
select pg_temp.check('S2 … never for an account they can''t open', pg_temp.refused($$select public.email_suggest_link(current_setting('test.t1')::uuid, 'acct_re_b', '[]')$$));
select pg_temp.check('S3 suggesting again changes nothing (one link)', public.email_suggest_link(current_setting('test.t1')::uuid, 'acct_re_1', '[]') is null);
reset role;
select pg_temp.check('S5 a suggestion is "possible" and active, with its reason', (select match_status = 'possible' and review_status = 'active' and reasons -> 0 ->> 'kind' = 'name' from pg_temp.link('acct_re_1')));

-- Who can see what.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('A1 the owner sees their thread and link', (select count(*) = 1 from public.email_threads) and (select count(*) = 1 from public.email_account_links));
select pg_temp.check('A2 nobody signed in can read OAuth tokens (not even the owner)', pg_temp.refused($$select count(*) from public.gmail_tokens$$));
select pg_temp.check('A3 … or write them', pg_temp.refused($$insert into public.gmail_tokens (user_id, refresh_token_ciphertext) values ('00000000-0000-0000-0000-00000000000a', 'x')$$));
select pg_temp.check('A4 signed-in users can''t write threads or links directly', pg_temp.refused($$insert into public.email_threads (owner_user_id, gmail_thread_id, last_message_id, last_message_at) values (auth.uid(), 'thr_z', 'm', now())$$)
  and pg_temp.refused($$update public.email_account_links set review_status = 'reviewed'$$));
select pg_temp.check('A5 signed-in users can''t call the server''s sync function', pg_temp.refused($$select public.email_record_thread(auth.uid(), 'thr_y', 's', null, null, 'm', now(), 1)$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('A6 another broker sees nothing of it', (select count(*) = 0 from public.email_threads) and (select count(*) = 0 from public.email_account_links) and (select count(*) = 0 from public.gmail_connections));
select pg_temp.check('A7 … and can''t act on it, suggest it or link it', pg_temp.refused(format($$select public.email_link_act(%L, 'reviewed')$$, (select id from pg_temp.link('acct_re_1'))))
  and pg_temp.refused($$select public.email_suggest_link(current_setting('test.t1')::uuid, 'acct_re_b', '[]')$$)
  and pg_temp.refused($$select public.email_link_manual(current_setting('test.t1')::uuid, 'acct_re_b')$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('A8 the agency admin doesn''t see a broker''s mailbox either', (select count(*) = 0 from public.email_threads) and (select count(*) = 0 from public.email_account_links));
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check('A9 another agency sees nothing', (select count(*) = 0 from public.email_threads) and (select count(*) = 0 from public.email_account_links));
reset role;
set local role anon;
select pg_temp.check('A10 the public can read nothing', pg_temp.refused($$select count(*) from public.email_threads$$) and pg_temp.refused($$select count(*) from public.gmail_connections$$));
reset role;

-- Reviewed / Undo / back to To Review on a new message.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('D1 Reviewed, with when it was clicked', not pg_temp.refused(format($$select public.email_link_act(%L, 'reviewed')$$, (select id from pg_temp.link('acct_re_1'))))
  and (select review_status = 'reviewed' and reviewed_message_id = 'msg_1' and reviewed_at = now() from pg_temp.link('acct_re_1')));
select pg_temp.check('D2 Undo brings it back to To Review', not pg_temp.refused(format($$select public.email_link_act(%L, 'undo_reviewed')$$, (select id from pg_temp.link('acct_re_1'))))
  and (select review_status = 'active' and reviewed_at is null and reviewed_message_id is null from pg_temp.link('acct_re_1')));
select public.email_link_act((pg_temp.link('acct_re_1')).id, 'reviewed');
reset role;
set local role service_role;
select public.email_record_thread('00000000-0000-0000-0000-00000000000a', 'thr_1', 'Loss runs for Sample Haulers', 'Pat Client', 'pat@client.example', 'msg_1', now() - interval '1 day', 1);
reset role;
select pg_temp.check('D3 synced again with no new message: stays Reviewed', (select review_status = 'reviewed' from pg_temp.link('acct_re_1')));
set local role service_role;
select public.email_record_thread('00000000-0000-0000-0000-00000000000a', 'thr_1', 'Re: Loss runs for Sample Haulers', 'Pat Client', 'pat@client.example', 'msg_2', now(), 2);
reset role;
select pg_temp.check('D4 a new message in the thread returns it to To Review', (select review_status = 'active' and reviewed_at is null from pg_temp.link('acct_re_1'))
  and (select count(*) = 1 from public.email_link_events e where e.link_id = (pg_temp.link('acct_re_1')).id and e.action = 'reopened'));
select pg_temp.check('D5 … and the earlier reviews stay in the history, with their times', (select array_agg(action order by id) from public.email_link_events where link_id = (pg_temp.link('acct_re_1')).id)
  = array['suggested', 'reviewed', 'review_undone', 'reviewed', 'reopened'] and (select bool_and(at is not null) from public.email_link_events where link_id = (pg_temp.link('acct_re_1')).id));

-- Not Related / Restore / Confirm.
set local role service_role;
select set_config('test.t2', public.email_record_thread('00000000-0000-0000-0000-00000000000a', 'thr_2', 'Quote for Example Freight', 'Market Rep', 'rep@market.example', 'msg_9', now(), 1)::text, true);
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.email_suggest_link(current_setting('test.t2')::uuid, 'acct_re_2', '[]');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('N1 Not Related removes it from the account', not pg_temp.refused(format($$select public.email_link_act(%L, 'not_related')$$, (select id from pg_temp.link('acct_re_2'))))
  and (select review_status = 'not_related' from pg_temp.link('acct_re_2')));
select pg_temp.check('N2 restoring an active one is refused', pg_temp.refused(format($$select public.email_link_act(%L, 'restore')$$, (select id from pg_temp.link('acct_re_1')))));
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.email_suggest_link(current_setting('test.t2')::uuid, 'acct_re_2', '[]');
reset role;
set local role service_role;
select public.email_record_thread('00000000-0000-0000-0000-00000000000a', 'thr_2', 'Re: Quote for Example Freight', 'Market Rep', 'rep@market.example', 'msg_10', now(), 2);
reset role;
select pg_temp.check('N3 suggested again, or a new message: it stays Not Related', (select review_status = 'not_related' from pg_temp.link('acct_re_2')));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('N4 the broker restores it', not pg_temp.refused(format($$select public.email_link_act(%L, 'restore')$$, (select id from pg_temp.link('acct_re_2'))))
  and (select review_status = 'active' from pg_temp.link('acct_re_2')));
select pg_temp.check('C1 the broker confirms a possible match', not pg_temp.refused(format($$select public.email_link_act(%L, 'confirm')$$, (select id from pg_temp.link('acct_re_2'))))
  and (select match_status = 'confirmed' from pg_temp.link('acct_re_2')));
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.email_suggest_link(current_setting('test.t2')::uuid, 'acct_re_2', '[]');
reset role;
select pg_temp.check('C2 a later suggestion never downgrades a confirmed match', (select match_status = 'confirmed' from pg_temp.link('acct_re_2')));
select pg_temp.check('H1 every step is in the history', (select array_agg(action order by id) from public.email_link_events where link_id = (pg_temp.link('acct_re_2')).id)
  = array['suggested', 'not_related', 'restored', 'confirmed']);

-- Manual link: the broker links a thread the matcher missed.
set local role service_role;
select set_config('test.t3', public.email_record_thread('00000000-0000-0000-0000-00000000000a', 'thr_3', 'Fwd: paperwork', 'Someone', 'someone@unknown.example', 'msg_20', now(), 1)::text, true);
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select set_config('test.m1', (not pg_temp.refused($$select public.email_link_manual(current_setting('test.t3')::uuid, 'acct_re_1')$$))::text, true);
select pg_temp.check('M1 the broker links their own thread to an account: confirmed, To Review', current_setting('test.m1')::boolean
  and (select match_status = 'confirmed' and review_status = 'active' and reasons -> 0 ->> 'kind' = 'manual' from public.email_account_links where thread_id = current_setting('test.t3')::uuid));
select public.email_link_act((select id from public.email_account_links where thread_id = current_setting('test.t3')::uuid), 'not_related');
select set_config('test.m2', (not pg_temp.refused($$select public.email_link_manual(current_setting('test.t3')::uuid, 'acct_re_1')$$))::text, true);
select pg_temp.check('M2 linking a Not Related one again restores it', current_setting('test.m2')::boolean
  and (select review_status = 'active' and match_status = 'confirmed' from public.email_account_links where thread_id = current_setting('test.t3')::uuid));
select pg_temp.check('M3 … never to an account they can''t open', pg_temp.refused($$select public.email_link_manual(current_setting('test.t3')::uuid, 'acct_re_b')$$));
reset role;

-- Disconnect.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.gmail_disconnect();
reset role;
select pg_temp.check('X1 disconnecting deletes the token and stops syncing', (select count(*) = 0 from public.gmail_tokens where user_id = '00000000-0000-0000-0000-00000000000a')
  and (select status = 'disconnected' from public.gmail_connections where user_id = '00000000-0000-0000-0000-00000000000a'));
set local role service_role;
select pg_temp.check('X2 … the server can''t record threads for it any more', pg_temp.refused($$select public.email_record_thread('00000000-0000-0000-0000-00000000000a', 'thr_3', 's', null, null, 'm', now(), 1)$$));
reset role;
rollback;
