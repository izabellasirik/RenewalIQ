-- 0084: payments to agents. Run against a disposable copy of a database with 0011 and 0084 applied (test users as in
-- the agency RLS tests: admin …0d, agent …0a, another agency's admin …0c). Fictional data only. One transaction,
-- rolled back. One PASS/FAIL line each.
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
create or replace function pg_temp.agency() returns uuid language sql as $$ select agency_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d' $$;
grant usage on schema public to authenticated;
select pg_temp.as_user('') \g /dev/null
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id) values
  ('ap_a', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Payment Client A (sample)', '00000000-0000-0000-0000-00000000000a');
set local role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d') \g /dev/null
select pg_temp.check('P1 an admin marks two rows paid', public.record_agent_payments('2026-10-30', jsonb_build_array(
  jsonb_build_object('submission_id', 'ap_a', 'row_key', 'p1', 'agent_user_id', '00000000-0000-0000-0000-00000000000a', 'commission_cents', 44550, 'broker_fee_cents', 15000, 'partner_shortfall_cents', 0),
  jsonb_build_object('submission_id', 'ap_a', 'row_key', 'p2', 'agent_user_id', '00000000-0000-0000-0000-00000000000a', 'commission_cents', 30000, 'broker_fee_cents', 0, 'partner_shortfall_cents', 2000)
)) = 2);
select pg_temp.check('P2 each keeps what was paid (commission + broker fee − partner shortfall)', (select total_cents = 59550 from public.agent_payments where row_key = 'p1') and (select total_cents = 28000 from public.agent_payments where row_key = 'p2'));
select public.record_agent_payments('2026-11-06', jsonb_build_array(
  jsonb_build_object('submission_id', 'ap_a', 'row_key', 'p1', 'agent_user_id', '00000000-0000-0000-0000-00000000000a', 'commission_cents', 3450))) \g /dev/null
select pg_temp.check('P3 a later difference is another payment on the same row', (select count(*) = 2 and sum(total_cents) = 63000 from public.agent_payments where row_key = 'p1'));
select pg_temp.check('P4 no date, no rows, or another agency''s account are refused',
  pg_temp.refused($$select public.record_agent_payments(null, '[{"submission_id":"ap_a","row_key":"x","agent_user_id":"00000000-0000-0000-0000-00000000000a"}]')$$)
  and pg_temp.refused($$select public.record_agent_payments('2026-10-30', '[]')$$)
  and pg_temp.refused($$select public.record_agent_payments('2026-10-30', '[{"submission_id":"nope","row_key":"x","agent_user_id":"00000000-0000-0000-0000-00000000000a"}]')$$));
select pg_temp.check('P5 undo needs a reason', pg_temp.refused($$select public.undo_agent_payment((select id from public.agent_payments where row_key = 'p2'), ' ')$$));
select public.undo_agent_payment((select id from public.agent_payments where row_key = 'p2'), 'Marked the wrong row') \g /dev/null
select pg_temp.check('P5b the undone payment is kept, marked undone with the reason', (select undone_at is not null and undo_reason = 'Marked the wrong row' from public.agent_payments where row_key = 'p2'));
select pg_temp.check('P6 an undone payment can''t be undone again', pg_temp.refused($$select public.undo_agent_payment((select id from public.agent_payments where row_key = 'p2'), 'again')$$));

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a') \g /dev/null
select pg_temp.check('P7 the agent sees their own payments', (select count(*) = 3 from public.agent_payments));
select pg_temp.check('P8 the agent can''t mark or undo payments', pg_temp.refused($$select public.record_agent_payments('2026-10-30', '[{"submission_id":"ap_a","row_key":"x","agent_user_id":"00000000-0000-0000-0000-00000000000a"}]')$$)
  and pg_temp.refused($$select public.undo_agent_payment((select id from public.agent_payments where row_key = 'p1' limit 1), 'mine')$$));
select pg_temp.check('P9 nor change them directly', pg_temp.refused($$update public.agent_payments set total_cents = 1$$) and pg_temp.refused($$delete from public.agent_payments$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c') \g /dev/null
select pg_temp.check('P10 another agency sees none of them', (select count(*) = 0 from public.agent_payments));
select pg_temp.as_user('') \g /dev/null
select pg_temp.check('P11 signed out sees nothing', (select count(*) = 0 from public.agent_payments));
reset role;
select pg_temp.check('P12 anon can''t use it', not has_table_privilege('anon', 'public.agent_payments', 'select') and not has_function_privilege('anon', 'public.record_agent_payments(date,jsonb)', 'execute'));
rollback;
