-- 0068 Gmail OAuth completion: single use, same user only, no replay, server only. Run against a
-- disposable database with 0068 applied. Fictional users only. One transaction, rolled back.
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
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'starter@example.example', now()),
  ('00000000-0000-0000-0000-0000000000c2', 'other@example.example', now());
-- The starter is an agency member; 'other' (…c2) and 'nomember' (…c3) aren't.
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000c3', 'nomember@example.example', now());
with a as (insert into public.agencies (name) values ('Fictional Agency') returning id)
insert into public.profiles (user_id, agency_id, role, email) select '00000000-0000-0000-0000-0000000000c1', a.id, 'admin', 'starter@example.example' from a;
set local role service_role;
create temp table p (k text primary key, id uuid);
insert into p values ('good', public.gmail_oauth_stash('n-good', '00000000-0000-0000-0000-0000000000c1', 'starter@gmail.example', 'v1:iv:ct-good', now() + interval '10 minutes'));
select pg_temp.check('O1 the same state can''t be parked twice (replay of Google''s return)',
  pg_temp.err($q$select public.gmail_oauth_stash('n-good', '00000000-0000-0000-0000-0000000000c1', 'starter@gmail.example', 'v1:iv:x', now() + interval '10 minutes')$q$) like '%replay%');
insert into p values ('victim', public.gmail_oauth_stash('n-victim', '00000000-0000-0000-0000-0000000000c1', 'victim@gmail.example', 'v1:iv:ct-victim', now() + interval '10 minutes'));
select pg_temp.check('O2 a different signed-in user can''t complete it',
  public.gmail_oauth_complete((select id from p where k = 'victim'), '00000000-0000-0000-0000-0000000000c2') = 'mismatch');
select pg_temp.check('O3 ...and it''s burned: the starter can''t complete it afterwards either (single use)',
  public.gmail_oauth_complete((select id from p where k = 'victim'), '00000000-0000-0000-0000-0000000000c1') = 'used_or_unknown');
select pg_temp.check('O4 nothing was connected by the mismatch', not exists (select 1 from public.gmail_connections where email_address = 'victim@gmail.example'));
select pg_temp.check('O5 the user who started it completes it', public.gmail_oauth_complete((select id from p where k = 'good'), '00000000-0000-0000-0000-0000000000c1') = 'connected');
select pg_temp.check('O6 connected, with the encrypted token stored server-side',
  exists (select 1 from public.gmail_connections c join public.gmail_tokens t using (user_id) where c.user_id = '00000000-0000-0000-0000-0000000000c1' and c.status = 'connected' and t.refresh_token_ciphertext = 'v1:iv:ct-good'));
select pg_temp.check('O7 completing the same one again is refused (single use)',
  public.gmail_oauth_complete((select id from p where k = 'good'), '00000000-0000-0000-0000-0000000000c1') = 'used_or_unknown');
insert into p values ('old', public.gmail_oauth_stash('n-old', '00000000-0000-0000-0000-0000000000c1', 'starter@gmail.example', 'v1:iv:ct-old', now() - interval '1 second'));
select pg_temp.check('O8 an expired one is refused', public.gmail_oauth_complete((select id from p where k = 'old'), '00000000-0000-0000-0000-0000000000c1') = 'expired');
-- (a separate statement: one statement still sees the row the function just removed)
select pg_temp.check('O8b ...and removed', not exists (select 1 from public.gmail_oauth_pending where state_nonce = 'n-old'));
insert into p values ('nomember', public.gmail_oauth_stash('n-nm', '00000000-0000-0000-0000-0000000000c3', 'nm@gmail.example', 'v1:iv:ct-nm', now() + interval '10 minutes'));
select pg_temp.check('O12 someone without an agency membership can''t connect Gmail', public.gmail_oauth_complete((select id from p where k = 'nomember'), '00000000-0000-0000-0000-0000000000c3') = 'no_agency');
select pg_temp.check('O12b ...nothing was connected for them', not exists (select 1 from public.gmail_connections where user_id = '00000000-0000-0000-0000-0000000000c3'));
select pg_temp.check('O9 an unknown id is refused', public.gmail_oauth_complete(gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1') = 'used_or_unknown');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
set local role authenticated;
select pg_temp.check('O10 signed-in users can''t call the completion functions or read parked returns',
  pg_temp.err($q$select public.gmail_oauth_complete(gen_random_uuid(), auth.uid())$q$) like '%permission denied%'
  and pg_temp.err($q$select public.gmail_oauth_stash('n', auth.uid(), 'e', 'c', now())$q$) like '%permission denied%'
  and pg_temp.err('select count(*) from public.gmail_oauth_pending') like '%permission denied%'
  and pg_temp.err('select count(*) from public.gmail_tokens') like '%permission denied%');
reset role;
set local role anon;
select pg_temp.check('O11 the public can''t either', pg_temp.err($q$select public.gmail_oauth_complete(gen_random_uuid(), gen_random_uuid())$q$) like '%permission denied%');
reset role;
rollback;
