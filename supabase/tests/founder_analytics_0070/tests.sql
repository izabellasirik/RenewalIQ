-- 0070: Founder Analytics accuracy. Run against a disposable copy of a database with 0043 and 0070
-- applied (0051/0069 optional; test users as in the agency RLS tests: admin …0d, agent …0a, founder …99).
-- Fictional data only. One transaction, rolled back. Prints one PASS/FAIL line per check.
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
select set_config('request.jwt.claim.sub', '', true);
create temp table before_events as select count(*) as n, md5(string_agg(id::text || event_name || occurred_at::text || coalesce(organization_id::text, '') || is_test::text, ',' order by id)) as fp from public.product_events;
grant select on before_events to authenticated;
-- An agency account and a personal account for the agent (…0a); the agent's agency.
set local session_replication_role = replica;
insert into public.submissions (id, user_id, named_insured, status, organization_id, assigned_user_id)
  select 'fa_agency_acct', '00000000-0000-0000-0000-00000000000a', 'Fictional Haulers', 'new', agency_id, user_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
insert into public.submissions (id, user_id, named_insured, status) values ('fa_personal_acct', '00000000-0000-0000-0000-00000000000a', 'Fictional Movers', 'new');
set local session_replication_role = origin;

create temp table app_names (name text);
insert into app_names select unnest(array['account_created', 'account_imported', 'account_opened_on_later_day', 'intake_link_created', 'intake_submitted', 'intake_imported', 'document_uploaded', 'document_processed', 'ai_extraction_completed', 'risk_profile_generated', 'risk_profile_reviewed', 'risk_profile_completed', 'application_reviewed', 'application_downloaded', 'market_search_completed', 'carrier_appetite_generated', 'carrier_match_opened', 'market_added_to_account', 'market_added', 'market_status_changed', 'quote_added', 'quote_updated', 'follow_up_created', 'follow_up_completed', 'requirements_added', 'document_request_prepared', 'document_request_sent', 'requested_document_received', 'requirement_verified', 'requirement_not_applicable', 'agency_created', 'account_updated', 'note_added', 'follow_up_updated', 'policy_bound', 'email_reviewed', 'email_draft_opened']);
create temp table agent_calls (step text, ok boolean);
grant select on app_names to authenticated;
grant insert, select on agent_calls to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
insert into agent_calls select 'all', bool_and(public.track_product_event(name, 'fa_agency_acct', '{}', 'fa-test:' || name)) from app_names;
insert into agent_calls values ('unknown', public.track_product_event('not_a_real_event', 'fa_agency_acct'));
insert into agent_calls values ('personal', public.track_product_event('note_added', 'fa_personal_acct', '{}', 'fa-personal'));
insert into agent_calls values ('day1', public.track_product_event('account_updated', 'fa_agency_acct', '{}', 'fa-day'));
insert into agent_calls values ('day2', public.track_product_event('account_updated', 'fa_agency_acct', '{}', 'fa-day'));
select pg_temp.check('F6 a broker cannot mark test users', pg_temp.refused($q$select public.set_user_analytics_test(auth.uid(), true)$q$));
select pg_temp.check('F7 a broker cannot read the snapshot', pg_temp.refused($q$select public.founder_analytics_snapshot(now() - interval '1 day', now() + interval '1 day')$q$));
reset role;
select pg_temp.check('F1 every event name the app sends is stored', (select ok from agent_calls where step = 'all')
  and (select count(*) from public.product_events where dedupe_key like '%fa-test:%') = (select count(*) from app_names));
select pg_temp.check('F2 an unknown event name is not stored', not exists (select 1 from public.product_events where event_name = 'not_a_real_event'));
select pg_temp.check('F3 an agency account''s event is stamped with that agency', (select bool_and(e.organization_id = p.agency_id) from public.product_events e join public.profiles p on p.user_id = e.user_id where e.dedupe_key like '%fa-test:%'));
select pg_temp.check('F4 a personal account''s event is stamped with the agent''s agency', (select e.organization_id = p.agency_id from public.product_events e join public.profiles p on p.user_id = e.user_id where e.dedupe_key like '%fa-personal'));
select pg_temp.check('F5 the same once-a-day event twice is stored once', (select count(*) from public.product_events where dedupe_key like '%fa-day') = 1);

select pg_temp.as_user('00000000-0000-0000-0000-000000000099');
set local role authenticated;
create temp table snap as select public.founder_analytics_snapshot(now() - interval '1 day', now() + interval '1 day') as s;
select pg_temp.check('F8 snapshot has adoption data (members, invitations, sign-ups)', (select s ? 'invitations' and s ? 'unaffiliatedSignups' and jsonb_array_length(s->'users') >= (select count(*) from public.profiles) from snap));
select pg_temp.check('F9 the agent''s real activity is meaningful', (select (u->>'firstMeaningful') is not null from snap, jsonb_array_elements(s->'users') u where u->>'id' = '00000000-0000-0000-0000-00000000000a'));
select public.set_user_analytics_test('00000000-0000-0000-0000-00000000000a', true);
create temp table snap2 as select public.founder_analytics_snapshot(now() - interval '1 day', now() + interval '1 day') as s;
select pg_temp.check('F10 a designated test user is flagged and has no meaningful activity', (select (u->>'isTest')::boolean and (u->>'firstMeaningful') is null from snap2, jsonb_array_elements(s->'users') u where u->>'id' = '00000000-0000-0000-0000-00000000000a'));
select public.set_user_analytics_test('00000000-0000-0000-0000-00000000000a', false);
reset role;
select pg_temp.check('F11 a client''s intake submission is not broker activity', not public.analytics_event_is_meaningful('intake_submitted', null, '00000000-0000-0000-0000-00000000000a')
  and public.analytics_event_is_meaningful('note_added', null, '00000000-0000-0000-0000-00000000000a'));
select pg_temp.check('F12 historical events are unchanged (count and contents)', (select n from before_events) + (select count(*) from public.product_events where dedupe_key like '%fa-%')
  = (select count(*) from public.product_events)
  and (select fp from before_events) is not distinct from (select md5(string_agg(id::text || event_name || occurred_at::text || coalesce(organization_id::text, '') || is_test::text, ',' order by id)) from public.product_events where dedupe_key is null or dedupe_key not like '%fa-%'));
rollback;
