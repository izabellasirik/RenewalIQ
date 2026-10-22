-- 0071: disconnecting Gmail deletes only that user's mailbox data; other users and client records stay.
-- Run against a disposable database with 0068 + 0071. Fictional data. One transaction, rolled back.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;
-- Two members of one agency, each with a mailbox, a thread, a link to the same client account, history and a pending connection.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'agent.one@example.example', now()),
  ('00000000-0000-0000-0000-0000000000d2', 'agent.two@example.example', now());
create temp table ids as select gen_random_uuid() as agency;
insert into public.agencies (id, name) select agency, 'Fictional Agency D' from ids;
insert into public.profiles (user_id, agency_id, role, email) select u, agency, 'admin', e from ids,
  (values ('00000000-0000-0000-0000-0000000000d1'::uuid, 'agent.one@example.example'), ('00000000-0000-0000-0000-0000000000d2'::uuid, 'agent.two@example.example')) v(u, e);
set local session_replication_role = replica;
insert into public.submissions (id, user_id, named_insured, status, organization_id, assigned_user_id)
  select 'fa_client_d', '00000000-0000-0000-0000-0000000000d1', 'Fictional Client', 'new', agency, '00000000-0000-0000-0000-0000000000d1' from ids;
set local session_replication_role = origin;
insert into public.gmail_connections (user_id, agency_id, email_address) select u, agency, e from ids,
  (values ('00000000-0000-0000-0000-0000000000d1'::uuid, 'one@gmail.example'), ('00000000-0000-0000-0000-0000000000d2'::uuid, 'two@gmail.example')) v(u, e);
insert into public.gmail_tokens (user_id, refresh_token_ciphertext) values ('00000000-0000-0000-0000-0000000000d1', 'v1:a:b'), ('00000000-0000-0000-0000-0000000000d2', 'v1:c:d');
insert into public.email_threads (owner_user_id, gmail_thread_id, subject, from_email, last_message_id, last_message_at, message_count)
  values ('00000000-0000-0000-0000-0000000000d1', 'g1', 'Docs', 'client@example.example', 'm1', now(), 1),
         ('00000000-0000-0000-0000-0000000000d2', 'g2', 'Docs', 'client@example.example', 'm2', now(), 1);
insert into public.email_account_links (owner_user_id, agency_id, submission_id, thread_id)
  select t.owner_user_id, i.agency, 'fa_client_d', t.id from public.email_threads t, ids i where t.gmail_thread_id in ('g1', 'g2');
insert into public.email_link_events (link_id, owner_user_id, action) select id, owner_user_id, 'suggested' from public.email_account_links;
insert into public.gmail_oauth_pending (state_nonce, user_id, email_address, refresh_token_ciphertext, expires_at)
  values ('n-d1', '00000000-0000-0000-0000-0000000000d1', 'one@gmail.example', 'v1:e:f', now() + interval '5 minutes'),
         ('n-d2', '00000000-0000-0000-0000-0000000000d2', 'two@gmail.example', 'v1:g:h', now() + interval '5 minutes');
create temp table before as select (select count(*) from public.submissions) as subs, (select count(*) from public.profiles) as members;

-- Mailbox isolation while connected: agent two sees only their own thread and link.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
set local role authenticated;
create temp table seen (what text, n int);
insert into seen select 'threads', count(*) from public.email_threads;
insert into seen select 'links', count(*) from public.email_account_links;
insert into seen select 'connections', count(*) from public.gmail_connections;
insert into seen select 'tokens', case when pg_temp.err('select count(*) from public.gmail_tokens') like '%permission denied%' then -1 else 1 end;
-- Agent one disconnects (as the app's signed-in RPC; the gmail function calls gmail_forget_mailbox after revoking at Google).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
select public.gmail_disconnect();
reset role;

select pg_temp.check('X1 isolation: another agent sees only their own thread, link and connection, and no tokens',
  (select n from seen where what = 'threads') = 1 and (select n from seen where what = 'links') = 1
  and (select n from seen where what = 'connections') = 1 and (select n from seen where what = 'tokens') = -1);
select pg_temp.check('X2 disconnect deleted agent one''s connection and token',
  not exists (select 1 from public.gmail_connections where user_id = '00000000-0000-0000-0000-0000000000d1')
  and not exists (select 1 from public.gmail_tokens where user_id = '00000000-0000-0000-0000-0000000000d1'));
select pg_temp.check('X3 ...their pending connections, threads, links and review history',
  not exists (select 1 from public.gmail_oauth_pending where user_id = '00000000-0000-0000-0000-0000000000d1')
  and not exists (select 1 from public.email_threads where owner_user_id = '00000000-0000-0000-0000-0000000000d1')
  and not exists (select 1 from public.email_account_links where owner_user_id = '00000000-0000-0000-0000-0000000000d1')
  and not exists (select 1 from public.email_link_events where owner_user_id = '00000000-0000-0000-0000-0000000000d1'));
select pg_temp.check('X4 agent two''s mailbox data is untouched (connection, token, pending, thread, link, history)',
  (select count(*) from public.gmail_connections where user_id = '00000000-0000-0000-0000-0000000000d2') = 1
  and (select count(*) from public.gmail_tokens where user_id = '00000000-0000-0000-0000-0000000000d2') = 1
  and (select count(*) from public.gmail_oauth_pending where user_id = '00000000-0000-0000-0000-0000000000d2') = 1
  and (select count(*) from public.email_threads where owner_user_id = '00000000-0000-0000-0000-0000000000d2') = 1
  and (select count(*) from public.email_account_links where owner_user_id = '00000000-0000-0000-0000-0000000000d2') = 1
  and (select count(*) from public.email_link_events where owner_user_id = '00000000-0000-0000-0000-0000000000d2') = 1);
select pg_temp.check('X5 the client account, memberships and other records are untouched',
  exists (select 1 from public.submissions where id = 'fa_client_d')
  and (select count(*) from public.submissions) = (select subs from before) and (select count(*) from public.profiles) = (select members from before));
set local role service_role;
select public.gmail_forget_mailbox('00000000-0000-0000-0000-0000000000d2');
reset role;
select pg_temp.check('X6 the server-side delete (used after revoking at Google) removes agent two''s data too',
  not exists (select 1 from public.gmail_connections where user_id = '00000000-0000-0000-0000-0000000000d2')
  and not exists (select 1 from public.email_link_events where owner_user_id = '00000000-0000-0000-0000-0000000000d2')
  and exists (select 1 from public.submissions where id = 'fa_client_d'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
set local role authenticated;
select pg_temp.check('X7 signed-in users can''t delete someone else''s mailbox (server-only function)',
  pg_temp.err($q$select public.gmail_forget_mailbox('00000000-0000-0000-0000-0000000000d2')$q$) like '%permission denied%');
reset role;
rollback;
