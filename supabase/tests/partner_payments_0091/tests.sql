-- 0091: partner payments. Run against a disposable copy with 0086 and 0091 applied (admin …0d, agent …0a, another
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
  ('pp_1', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Partner Pay (sample)', '00000000-0000-0000-0000-00000000000a');
grant usage on schema public to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('Q1 an admin marks a partner paid', public.record_partner_payments(current_date, '[{"submission_id":"pp_1","policy_id":"p1","partner_name":"Sample Safety","amount_cents":5000}]') = 1);
select id as pid from public.partner_payments where submission_id = 'pp_1' \gset
select pg_temp.check('Q2 the admin sees it', (select amount_cents = 5000 and partner_name = 'Sample Safety' from public.partner_payments where id = :'pid'));
select pg_temp.check('Q3 undo needs a reason', pg_temp.refused(format($$select public.undo_partner_payment(%L, '')$$, :'pid')));
select public.undo_partner_payment(:'pid', 'Undone') \g /dev/null
select pg_temp.check('Q4 undone, kept', (select undone_at is not null from public.partner_payments where id = :'pid'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select pg_temp.check('Q5 an agent can''t mark a partner paid', pg_temp.refused($$select public.record_partner_payments(current_date, '[{"submission_id":"pp_1","policy_id":"p1","partner_name":"X","amount_cents":1}]')$$));
select pg_temp.check('Q6 an agent doesn''t see partner payments', (select count(*) = 0 from public.partner_payments));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c') \g /dev/null
select pg_temp.check('Q7 another agency can''t mark this agency''s account', pg_temp.refused($$select public.record_partner_payments(current_date, '[{"submission_id":"pp_1","policy_id":"p1","partner_name":"X","amount_cents":1}]')$$));
reset role;
select pg_temp.check('Q8 signed out can''t call them', not has_function_privilege('anon', 'public.record_partner_payments(date,jsonb)', 'execute') and not has_function_privilege('anon', 'public.undo_partner_payment(uuid,text)', 'execute'));
rollback;
