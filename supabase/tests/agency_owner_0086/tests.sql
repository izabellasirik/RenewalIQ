-- 0086 + 0089: Agency Owner; owners and admins mark agents paid. Run against a disposable copy with 0043, 0084 and 0086 applied (admin …0d, agent …0a, another
-- agency's admin …0c). Fictional data only. One transaction, rolled back. One PASS/FAIL line each.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
create or replace function pg_temp.refused(sql text) returns boolean language plpgsql as $$ begin execute sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, true); end $$;
create or replace function pg_temp.agency() returns uuid language sql as $$ select agency_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d' $$;
select pg_temp.as_user('') \g /dev/null
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id) values
  ('ao_1', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Owner Test (sample)', '00000000-0000-0000-0000-00000000000a');
grant usage on schema public to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('W1 an admin who isn''t an owner marks paid too (0089)', not pg_temp.refused($$select public.record_agent_payments(current_date, '[{"submission_id":"ao_1","row_key":"p0","agent_user_id":"00000000-0000-0000-0000-00000000000a","commission_cents":100}]')$$));
select pg_temp.check('W2 an admin can''t make themselves an owner', pg_temp.refused($$select public.set_agency_owner(pg_temp.agency(), '00000000-0000-0000-0000-00000000000d', true)$$));
reset role;
insert into public.agency_owners (agency_id, user_id) values (pg_temp.agency(), '00000000-0000-0000-0000-00000000000d');
set local role authenticated;
select pg_temp.check('W3 the owner is seen as the owner', public.is_agency_owner());
select pg_temp.check('W4 the owner marks paid', public.record_agent_payments(current_date, '[{"submission_id":"ao_1","row_key":"p1","agent_user_id":"00000000-0000-0000-0000-00000000000a","commission_cents":100}]') = 1);
select id as pid from public.agent_payments where submission_id = 'ao_1' and row_key = 'p1' \gset
select public.undo_agent_payment(:'pid', 'Undone') \g /dev/null
select pg_temp.check('W5 the owner undoes a payment', (select undone_at is not null from public.agent_payments where id = :'pid'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select pg_temp.check('W6 an agent sees who the owner is but isn''t one', not public.is_agency_owner() and (select count(*) = 1 from public.agency_owners));
reset role;
insert into public.agency_owners (agency_id, user_id) values (pg_temp.agency(), '00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select pg_temp.check('W6b two owners in one agency: the second marks paid too', public.is_agency_owner()
  and public.record_agent_payments(current_date, '[{"submission_id":"ao_1","row_key":"p3","agent_user_id":"00000000-0000-0000-0000-00000000000a","commission_cents":100}]') = 1);
reset role;
delete from public.agency_owners where user_id = '00000000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp.check('W7 an agent can''t mark paid', pg_temp.refused($$select public.record_agent_payments(current_date, '[{"submission_id":"ao_1","row_key":"p2","agent_user_id":"00000000-0000-0000-0000-00000000000a","commission_cents":100}]')$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c') \g /dev/null
select pg_temp.check('W8 another agency doesn''t see this agency''s owner', (select count(*) = 0 from public.agency_owners where agency_id = pg_temp.agency()));
reset role;
select pg_temp.check('W9 signed out can''t call the new functions', not has_function_privilege('anon', 'public.set_agency_owner(uuid,uuid,boolean)', 'execute') and not has_function_privilege('anon', 'public.is_agency_owner()', 'execute'));
rollback;
