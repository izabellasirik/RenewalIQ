-- 0051 + 0069: invitation-only access. Run against a disposable copy of a database with 0011–0046,
-- 0051 and 0069 applied (test users as in the agency RLS tests: admin …0d, agent …0a, founder …99).
-- Fictional people only. One transaction, rolled back. Prints one PASS/FAIL line per check.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, true); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
-- Refused by row-level security / permissions specifically (not by a typo or a missing column).
create or replace function pg_temp.denied(sql text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when insufficient_privilege then
  return true;
end $$;
create or replace function pg_temp.refused(sql text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return true;
end $$;
select set_config('request.jwt.claim.sub', '', true);

-- Two people with a login and no agency: one invited to the admin's agency, one not invited.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'invited.person@example.example', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'not.invited@example.example', now());
insert into public.agency_invitations (agency_id, email, role, token, invited_by)
  select agency_id, 'invited.person@example.example', 'agent', 'tok-gate-test-0001-xxxxxxxxxxxxxxxxxxxxxxxx', user_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d';
-- Personal accounts created before joining (as an older app would have), and one for an existing member.
set local session_replication_role = replica;
insert into public.submissions (id, user_id, named_insured, status) values
  ('gate_personal_invited', '00000000-0000-0000-0000-0000000000a1', 'Fictional Haulers', 'new'),
  ('gate_personal_member', '00000000-0000-0000-0000-00000000000a', 'Fictional Movers', 'new');
set local session_replication_role = origin;
create temp table counts as select (select count(*) from public.submissions) as total;
grant select on counts to authenticated;

-- Invited, not yet joined: nothing is readable or creatable; the invitation is.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.check('G1 invited non-member has no product access', not public.has_product_access());
select pg_temp.check('G2 invited non-member sees no accounts (not even their own personal one)', (select count(*) from public.submissions) = 0);
select pg_temp.check('G3 invited non-member cannot create an account', pg_temp.denied($q$insert into public.submissions (id, user_id, named_insured, status) values ('gate_new', auth.uid(), 'X', 'new')$q$));
select pg_temp.check('G4 invited non-member cannot upload to their own folder', pg_temp.denied($q$insert into storage.objects (bucket_id, name) values ('submission-documents', '00000000-0000-0000-0000-0000000000a1/gate_none/f.pdf')$q$));
select pg_temp.check('G5 invited non-member cannot create a client intake link', pg_temp.denied($q$insert into public.intake_links (user_id, token) values (auth.uid(), 'gate-link')$q$));
select pg_temp.check('G6 invited non-member sees their invitation with the agency name', (select count(*) from public.my_open_invitations() where agency_name is not null) = 1);
select pg_temp.check('G7 joining from the app works', public.accept_my_invitation((select id from public.my_open_invitations() limit 1)) is not null);
select pg_temp.check('G8 after joining: product access', public.has_product_access());
select pg_temp.check('G9 after joining: their personal account is visible again', exists (select 1 from public.submissions where id = 'gate_personal_invited'));
select pg_temp.check('G10 after joining: no invitation left to accept', (select count(*) from public.my_open_invitations()) = 0);
reset role;
select pg_temp.check('G11 the invitation is closed (Team page no longer Pending)', (select accepted_at is not null from public.agency_invitations where token = 'tok-gate-test-0001-xxxxxxxxxxxxxxxxxxxxxxxx'));

-- Not invited: blocked, nothing to accept, can't make their own agency.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select pg_temp.check('G12 uninvited: no product access, no invitations', not public.has_product_access() and (select count(*) from public.my_open_invitations()) = 0);
select pg_temp.check('G13 uninvited: cannot accept someone else''s invitation', pg_temp.refused($q$select public.accept_my_invitation((select id from public.agency_invitations limit 1))$q$));
select pg_temp.check('G14 uninvited: cannot create an agency', to_regprocedure('public.create_my_agency(text)') is null or pg_temp.refused($q$select public.create_my_agency('Fictional Agency')$q$));
select pg_temp.check('G15 uninvited: sees no accounts', (select count(*) from public.submissions) = 0);
reset role;

-- Existing members and the founder are unaffected.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select pg_temp.check('G16 agent member: access, agency accounts and own personal account', public.has_product_access() and exists (select 1 from public.submissions where id = 'gate_personal_member') and (select count(*) from public.submissions where organization_id is not null) > 0);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
set local role authenticated;
select pg_temp.check('G17 admin member: sees every agency account (except others'' personal ones)', public.has_product_access() and (select count(*) from public.submissions) = (select count(*) from public.submissions s where s.organization_id = public.current_agency_id()));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000099');
set local role authenticated;
select pg_temp.check('G18 founder: product access', public.has_product_access());
reset role;
select pg_temp.as_user('');
set local role anon;
select pg_temp.check('G19 signed out: cannot call has_product_access', pg_temp.refused('select public.has_product_access()'));
reset role;
rollback;
