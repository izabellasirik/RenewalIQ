-- 0078: work is recorded for Founder Analytics when it's saved, once. Run against a disposable copy of a database
-- with 0043, 0070 and 0078 applied (test users as in the agency RLS tests: admin …0d, agent …0a).
-- Fictional data only. One transaction, rolled back. One PASS/FAIL line each.
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
create or replace function pg_temp.n(name text, acct text) returns bigint language sql as $$
  select count(*) from public.product_events where event_name = name and account_id = acct
$$;
create or replace function pg_temp.agency() returns uuid language sql as $$ select agency_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d' $$;
create or replace function pg_temp.market(id text, status text, policies jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'marketName', 'Granite Mutual', 'status', status, 'policies', policies)
$$;
create or replace function pg_temp.pol(id text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'policyNumber', 'GM-' || id, 'carrier', 'Granite Mutual', 'businessType', 'new', 'boundDate', '2026-10-20',
    'effectiveDate', '2026-10-20', 'netPremiumCents', 500000, 'taxesCents', 0, 'feesCents', 0, 'createdAt', 'x', 'updatedAt', 'x') || extra
$$;
grant usage on schema public to authenticated;
-- The agent is signed in (as when the app saves).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true) \g /dev/null

insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id)
values ('acct_w78', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Ridgeline Freight LLC', '00000000-0000-0000-0000-00000000000a');
select pg_temp.check('W1 a new account saved → "account created" recorded for the agent, in the agency, not test',
  (select count(*) = 1 and bool_and(user_id = '00000000-0000-0000-0000-00000000000a' and organization_id = pg_temp.agency() and not is_test)
     from public.product_events where event_name = 'account_created' and account_id = 'acct_w78'));

set local role authenticated;
select pg_temp.check('W2 the app''s own call (note_work) with the same key adds nothing', public.note_work('account_created', 'acct_w78', '{"source":"manual"}', 'account_created:acct_w78'));
reset role;
select pg_temp.check('W2b … still one', pg_temp.n('account_created', 'acct_w78') = 1);

update public.submissions set market_quotes = jsonb_build_array(pg_temp.market('q1', 'submitted', '[]')) where id = 'acct_w78';
select pg_temp.check('W3 a market added → "market added" once', pg_temp.n('market_added', 'acct_w78') = 1);
update public.submissions set market_quotes = jsonb_build_array(pg_temp.market('q1', 'quoted', '[]')) where id = 'acct_w78';
select pg_temp.check('W4 the same market changed again → nothing new', pg_temp.n('market_added', 'acct_w78') = 1);

update public.submissions set market_quotes = jsonb_build_array(pg_temp.market('q1', 'bound', jsonb_build_array(pg_temp.pol('w1'))), pg_temp.market('q2', 'submitted', '[]')) where id = 'acct_w78';
select pg_temp.check('W5 a policy recorded and a second market → "policy bound" once, markets two', pg_temp.n('policy_bound', 'acct_w78') = 1 and pg_temp.n('market_added', 'acct_w78') = 2);
set local role authenticated;
select public.note_work('policy_bound', 'acct_w78', '{"status":"bound"}', 'policy_bound:acct_w78:w1') as x \g /dev/null
reset role;
select pg_temp.check('W6 the app''s policy call with the same key → still one', pg_temp.n('policy_bound', 'acct_w78') = 1);
update public.submissions set market_quotes = jsonb_build_array(pg_temp.market('q1', 'bound', jsonb_build_array(pg_temp.pol('w1'),
  pg_temp.pol('w2', '{"kind":"endorsement","forPolicyId":"w1"}'), pg_temp.pol('w3', '{"removedAt":"2026-10-21"}'))), pg_temp.market('q2', 'submitted', '[]')) where id = 'acct_w78';
select pg_temp.check('W7 an endorsement counts (as endorsed); a removed policy doesn''t', pg_temp.n('policy_bound', 'acct_w78') = 2
  and exists (select 1 from public.product_events where event_name = 'policy_bound' and account_id = 'acct_w78' and metadata ->> 'status' = 'endorsed'));

insert into public.documents (id, submission_id, user_id, name, file_type) values ('doc_w78', 'acct_w78', '00000000-0000-0000-0000-00000000000a', 'loss-run.pdf', 'pdf');
set local role authenticated;
select public.note_work('document_uploaded', 'acct_w78', '{"count":1}', 'document_uploaded:doc_w78') as x \g /dev/null
reset role;
select pg_temp.check('W8 a document saved → "document uploaded" once (with the app''s call too)', pg_temp.n('document_uploaded', 'acct_w78') = 1);

-- Saved without a signed-in user (e.g. a background import): counted for the account's owner.
select set_config('request.jwt.claim.sub', '', true);
insert into public.submissions (id, user_id, organization_id, named_insured, market_quotes)
values ('acct_w78b', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Summit Haulers Inc', jsonb_build_array(pg_temp.market('q9', 'bound', jsonb_build_array(pg_temp.pol('w9')))));
select pg_temp.check('W9 no signed-in user → the owner; account, market and policy all counted', pg_temp.n('account_created', 'acct_w78b') = 1 and pg_temp.n('market_added', 'acct_w78b') = 1
  and pg_temp.n('policy_bound', 'acct_w78b') = 1 and (select bool_and(user_id = '00000000-0000-0000-0000-00000000000a') from public.product_events where account_id = 'acct_w78b'));
insert into public.submissions (id, user_id, organization_id, named_insured) values ('acct_w78c', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Demo Trucking (test)');
select pg_temp.check('W10 a test account is recorded as test', (select bool_and(is_test) from public.product_events where account_id = 'acct_w78c'));
select pg_temp.check('W11 recording never blocks a save (a bad action is just skipped)', not pg_temp.refused($$select public.record_saved_work('not_a_real_action', '00000000-0000-0000-0000-00000000000a', null, 'acct_w78', '{}', 'x')$$));
select pg_temp.check('W12 anon can''t call note_work; users can''t call the helpers',
  not has_function_privilege('anon', 'public.note_work(text,text,jsonb,text)', 'execute')
  and has_function_privilege('authenticated', 'public.note_work(text,text,jsonb,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_saved_work(text,uuid,uuid,text,jsonb,text)', 'execute'));
select pg_temp.check('W13 a broker''s saved work counts as meaningful activity', public.analytics_event_is_meaningful('market_added', 'acct_w78', '00000000-0000-0000-0000-00000000000a'));
rollback;
