\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
grant all on all tables in schema public to authenticated;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

\echo '== BEFORE agency setup (0011 applied, no profiles yet): legacy owner-only access unchanged'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'L1 roman sees own legacy accounts: ' || coalesce(string_agg(id, ',' order by id),'') from submissions;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'L2 denis (no profile yet) sees: [' || coalesce(string_agg(id, ',' order by id),'') || ']' from submissions;
reset role;

\echo '== Running setup script steps 2-4 as SQL editor (auth.uid() null)'
select pg_temp.as_user('');
insert into public.agencies (name) values ('Agency'), ('Other Agency');
insert into profiles (user_id, agency_id, role, email, display_name) select u.id, a.id, 'admin', u.email, 'Denis' from auth.users u, agencies a where u.email='denis@agency.com' and a.name='Agency';
insert into profiles (user_id, agency_id, role, email, display_name) select u.id, a.id, 'agent', u.email, 'Roman' from auth.users u, agencies a where u.email='roman@agency.com' and a.name='Agency';
insert into profiles (user_id, agency_id, role, email, display_name) select u.id, a.id, 'agent', u.email, 'Agent B' from auth.users u, agencies a where u.email='agentb@agency.com' and a.name='Agency';
insert into profiles (user_id, agency_id, role, email, display_name) select u.id, a.id, 'admin', u.email, 'Outsider' from auth.users u, agencies a where u.email='outsider@other.com' and a.name='Other Agency';
update public.submissions s set organization_id = p.agency_id, assigned_user_id = coalesce(s.assigned_user_id, s.user_id) from public.profiles p where p.user_id = s.user_id and s.organization_id is null;
select 'backfill: ' || string_agg(id || '→' || coalesce(assigned_user_id::text,'-'), ' ' order by id) from submissions;

set role authenticated;
\echo '== 1. Roman sees Roman''s accounts'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'T1 roman: ' || string_agg(id, ',' order by id) from submissions;
\echo '== 2. Agent B does NOT see Roman''s accounts'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'T2 agentB: ' || string_agg(id, ',' order by id) from submissions;
\echo '== 3. Agent B queries Roman''s account directly → nothing / denied'
select 'T3 select by id rows=' || count(*) from submissions where id = 'acct_r1';
select 'T3 field_values rows=' || count(*) from field_values where submission_id = 'acct_r1';
select 'T3 alternates rows=' || count(*) from field_alternates;
select 'T3 activity rows=' || count(*) from activity_events where submission_id = 'acct_r1';
select 'T3 storage rows=' || count(*) from storage.objects where name like '%acct_r1%';
with u as (update submissions set named_insured = 'hacked' where id = 'acct_r1' returning 1) select 'T3 update affected=' || count(*) from u;
with d as (delete from submissions where id = 'acct_r1' returning 1) select 'T3 delete affected=' || count(*) from d;
do $$ begin insert into submissions (id, user_id, named_insured) values ('acct_r1','00000000-0000-0000-0000-00000000000b','steal') on conflict (id) do update set named_insured = excluded.named_insured; raise notice 'T3 upsert-over: ALLOWED (BAD)'; exception when others then raise notice 'T3 upsert-over denied: %', sqlerrm; end $$;
do $$ begin insert into field_values (id, submission_id, user_id, section, field_key) values ('x','acct_r1','00000000-0000-0000-0000-00000000000b','business','dba'); raise notice 'T3 child insert: ALLOWED (BAD)'; exception when others then raise notice 'T3 child insert denied: %', sqlerrm; end $$;
do $$ begin insert into activity_events (id, submission_id, user_id, type, message) values ('evx','acct_r1','00000000-0000-0000-0000-00000000000b','x','x'); raise notice 'T3 activity insert: ALLOWED (BAD)'; exception when others then raise notice 'T3 activity insert denied: %', sqlerrm; end $$;
do $$ begin update submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000a' where id = 'acct_b1'; raise notice 'T3 agent reassign own account to roman: ALLOWED (BAD)'; exception when others then raise notice 'T3 agent reassign own account denied: %', sqlerrm; end $$;
select 'T3 profiles visible to agentB: ' || string_agg(email, ',') from profiles;
select 'T3 is_agency_admin(agentB)=' || is_agency_admin();
do $$ begin insert into profiles (user_id, agency_id, role) values ('00000000-0000-0000-0000-00000000000b', current_agency_id(), 'admin'); raise notice 'T3 self-promote insert: ALLOWED (BAD)'; exception when others then raise notice 'T3 self-promote denied: %', sqlerrm; end $$;
with u as (update profiles set role = 'admin' where user_id = auth.uid() returning 1) select 'T3 self-promote update affected=' || count(*) from u;
do $$ begin insert into submissions (id, user_id, named_insured, organization_id) values ('acct_spoof','00000000-0000-0000-0000-00000000000a','spoof', (select id from agencies limit 1)); raise notice 'T3 spoof creator → row user_id=%', (select user_id from submissions where id='acct_spoof'); exception when others then raise notice 'T3 spoof insert denied: %', sqlerrm; end $$;
reset role; delete from submissions where id = 'acct_spoof'; set role authenticated; -- test cleanup (agents can't delete since 0021)

\echo '== 5. Admin sees Roman''s and Agent B''s (and not the other agency''s)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'T5 admin: ' || string_agg(id, ',' order by id) from submissions;
select 'T5 admin sees roman field_values=' || count(*) from field_values where submission_id='acct_r1';
select 'T5 admin sees roman file=' || count(*) from storage.objects where name like '%acct_r1%';
select 'T5 admin sees agents: ' || string_agg(email || ':' || role, ',' order by email) from profiles;
select 'T5 admin sees acct_n1 (newbie not in agency yet)=' || count(*) from submissions where id='acct_n1';
\echo '== 6. Admin reassigns acct_r2 from Roman to Agent B'
update submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000b' where id = 'acct_r2';
do $$ begin update submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000c' where id = 'acct_r1'; raise notice 'T6 assign to other-agency user: ALLOWED (BAD)'; exception when others then raise notice 'T6 assign outside agency denied: %', sqlerrm; end $$;
-- admin edits Roman's account through the normal full-snapshot upsert (user_id = admin in payload)
insert into submissions (id, user_id, named_insured) values ('acct_r1','00000000-0000-0000-0000-00000000000d','Roman Trucking LLC') on conflict (id) do update set named_insured = excluded.named_insured, user_id = excluded.user_id;
select 'T6 after admin edit: creator=' || user_id || ' assigned=' || assigned_user_id || ' name=' || named_insured from submissions where id='acct_r1';
\echo '== 7. Roman no longer sees acct_r2'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'T7 roman: ' || string_agg(id, ',' order by id) from submissions;
do $$ begin insert into submissions (id, user_id, named_insured) values ('acct_r2','00000000-0000-0000-0000-00000000000a','stale save from roman device') on conflict (id) do update set named_insured = excluded.named_insured; raise notice 'T7 stale save: ALLOWED (BAD)'; exception when others then raise notice 'T7 roman stale save denied: %', sqlerrm; end $$;
\echo '== 8. Agent B now sees acct_r2'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'T8 agentB: ' || string_agg(id, ',' order by id) from submissions;
\echo '== 9. New account by Roman belongs to Roman'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into submissions (id, user_id, named_insured, assigned_user_id) values ('acct_r3','00000000-0000-0000-0000-00000000000a','Roman New', '00000000-0000-0000-0000-00000000000b');
select 'T9 new: agency=' || (select name from agencies a where a.id = s.organization_id) || ' assigned=' || assigned_user_id from submissions s where id='acct_r3';
\echo '== 10. Children follow: Roman writes/reads children on own account; storage upload rules'
insert into field_values (id, submission_id, user_id, section, field_key, value) values ('acct_r3::business::state','acct_r3','00000000-0000-0000-0000-00000000000a','business','state','"TX"');
insert into activity_events (id, submission_id, user_id, type, message) values ('ev_r3','acct_r3','00000000-0000-0000-0000-00000000000a','account_created','x') on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values ('submission-documents','00000000-0000-0000-0000-00000000000a/acct_r3/d/a.pdf');
insert into storage.objects (bucket_id, name) values ('submission-documents','00000000-0000-0000-0000-00000000000a/acct_brand_new/d/a.pdf');
select 'T10 roman children r3 fv=' || (select count(*) from field_values where submission_id='acct_r3') || ' act=' || (select count(*) from activity_events where submission_id='acct_r3') || ' files=' || (select count(*) from storage.objects where name like '%acct_r3%' or name like '%brand_new%');
do $$ begin insert into storage.objects (bucket_id, name) values ('submission-documents','00000000-0000-0000-0000-00000000000a/acct_r2/d/a.pdf'); raise notice 'T10 upload into reassigned account: ALLOWED (BAD)'; exception when others then raise notice 'T10 upload to acct_r2 denied: %', sqlerrm; end $$;
do $$ begin insert into storage.objects (bucket_id, name) values ('submission-documents','00000000-0000-0000-0000-00000000000b/acct_r3/d/a.pdf'); raise notice 'T10 upload into other user folder: ALLOWED (BAD)'; exception when others then raise notice 'T10 upload into someone else''s folder denied: %', sqlerrm; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'T10 agentB sees r3 children fv=' || (select count(*) from field_values where submission_id='acct_r3') || ' act=' || (select count(*) from activity_events where submission_id='acct_r3') || ' files=' || (select count(*) from storage.objects where name like '%acct_r3%');
select 'T10 agentB sees r2 (reassigned) file rows via roman folder: ' || count(*) from storage.objects where name like '%/acct_r2/%';
\echo '== Other agency admin sees none of ours'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'X outsider admin: ' || string_agg(id, ',' order by id) from submissions;
select 'X outsider profiles: ' || string_agg(email, ',') from profiles;
\echo '== Legacy user not in any agency: still only their own'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select 'N newbie: ' || string_agg(id, ',' order by id) from submissions;
insert into submissions (id, user_id, named_insured) values ('acct_n2','00000000-0000-0000-0000-00000000000e','Newbie 2');
select 'N newbie new account agency=' || coalesce(organization_id::text,'null') || ' visible=' || count(*) over () from submissions where id='acct_n2';
\echo '== anon-ish (no jwt): nothing'
select pg_temp.as_user('');
select 'A no-uid sees rows=' || count(*) from submissions;
reset role;
set role authenticated;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
\echo '== admin full-snapshot save on Roman''s acct_r1 (delete + reinsert children, as the app does)'
delete from field_values where submission_id = 'acct_r1';
insert into field_values (id, submission_id, user_id, section, field_key, value) values ('acct_r1::business::state','acct_r1','00000000-0000-0000-0000-00000000000d','business','state','"OK"');
insert into activity_events (id, submission_id, user_id, type, message) values ('ev_admin','acct_r1','00000000-0000-0000-0000-00000000000d','account_updated','admin edit') on conflict (id) do nothing;
select 'S admin save ok: fv=' || (select value::text from field_values where submission_id='acct_r1');
\echo '== admin reassigns acct_r1 (with Roman''s uploaded file) to Agent B'
update submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000b' where id = 'acct_r1';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'F agentB reads roman-uploaded file on acct_r1: ' || count(*) from storage.objects where name like '%/acct_r1/%';
select 'F agentB sees admin''s field edit + activity: fv=' || (select count(*) from field_values where submission_id='acct_r1') || ' act=' || (select count(*) from activity_events where submission_id='acct_r1');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'F roman after losing acct_r1: accounts=' || coalesce(string_agg(id, ','), '') || ' files=' || (select count(*) from storage.objects where name like '%/acct_r1/%') || ' fv=' || (select count(*) from field_values where submission_id='acct_r1') from submissions;
with d as (delete from storage.objects where name like '%/acct_r1/%' returning 1) select 'F roman delete own old upload on lost account affected=' || count(*) from d;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
update submissions set assigned_user_id = null where id = 'acct_r3';
select 'U unassigned acct_r3 visible to admin=' || count(*) from submissions where id='acct_r3';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'U unassigned acct_r3 visible to roman (creator)=' || count(*) from submissions where id='acct_r3';
reset role;

\echo '== 0017: each user saves only their own name / phone / title'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'P1 roman saves own profile, in agency=' || save_my_profile('  Roman Smith ', '555-0111', 'Broker');
select 'P1 row: ' || display_name || '|' || phone || '|' || job_title || '|' || role from profiles where user_id = auth.uid();
do $$ begin perform save_my_profile('   ', null, null); raise notice 'P2 blank name: ALLOWED (BAD)'; exception when others then raise notice 'P2 blank name denied: %', sqlerrm; end $$;
with u as (update profiles set phone = 'x' where user_id = '00000000-0000-0000-0000-00000000000b' returning 1) select 'P3 roman edits agentB directly affected=' || count(*) from u;
with u as (update profiles set job_title = 'x' where user_id = auth.uid() returning 1) select 'P3 direct update of own row affected=' || count(*) from u;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select 'P4 newbie (no agency) save → in agency=' || save_my_profile('Nina', null, null) || ' rows=' || (select count(*) from profiles where user_id = auth.uid());
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'P5 admin reads agency profiles: ' || string_agg(display_name || ':' || coalesce(job_title, '-'), ',' order by display_name) from profiles;
select pg_temp.as_user('');
do $$ begin perform save_my_profile('Anon', null, null); raise notice 'P6 no user: ALLOWED (BAD)'; exception when others then raise notice 'P6 no user denied: %', sqlerrm; end $$;
reset role;

\echo '== 0018: invitations'
select pg_temp.as_user('');
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000f', 'invitee@agency.com', null, '{"full_name":"Ivy Invitee","job_title":"Account Manager"}');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.create_agency_invitation('someone@agency.com', 'agent'); raise notice 'I1 agent invites: ALLOWED (BAD)'; exception when others then raise notice 'I1 agent invites denied: %', sqlerrm; end $$;
do $$ begin perform public.create_agency_invitation('roman@agency.com', 'admin'); raise notice 'I1 agent invites self as admin: ALLOWED (BAD)'; exception when others then raise notice 'I1 agent self-admin invite denied: %', sqlerrm; end $$;
select 'I1 agent sees invitations=' || count(*) from agency_invitations;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
create temp table t_inv as select * from public.create_agency_invitation(' Newbie@Agency.com ', 'agent');
select 'I2 admin invites: ' || email || ' ' || role || ' token_len=' || length(token) from t_inv;
do $$ begin perform public.create_agency_invitation('roman@agency.com', 'agent'); raise notice 'I3 invite existing member: ALLOWED (BAD)'; exception when others then raise notice 'I3 invite existing member denied: %', sqlerrm; end $$;
do $$ begin perform public.create_agency_invitation('x@agency.com', 'owner'); raise notice 'I3 bad role: ALLOWED (BAD)'; exception when others then raise notice 'I3 bad role denied: %', sqlerrm; end $$;
do $$ begin insert into agency_invitations (agency_id, email, role, token) values (current_agency_id(), 'direct@agency.com', 'admin', repeat('a', 64)); raise notice 'I3 direct insert: ALLOWED (BAD)'; exception when others then raise notice 'I3 direct insert denied: %', sqlerrm; end $$;
create temp table t_inv2 as select * from public.create_agency_invitation('invitee@agency.com', 'admin');
create temp table t_inv3 as select * from public.create_agency_invitation('outsider@other.com', 'agent');
create temp table t_inv4 as select * from public.create_agency_invitation('later@agency.com', 'agent');
select 'I2 admin sees own agency invitations=' || count(*) from agency_invitations;
grant select on t_inv, t_inv2, t_inv3, t_inv4 to public;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'I4 other agency admin sees Agency invitations=' || count(*) from agency_invitations;
select 'I4 other agency admin revokes Agency invitation=' || public.revoke_agency_invitation((select id from t_inv4));
select pg_temp.as_user('');
select 'I5 link lookup (signed out): ' || agency_name || '|' || email || '|' || role || '|' || status from public.get_agency_invitation((select token from t_inv));
select 'I5 lookup with a made-up token rows=' || count(*) from public.get_agency_invitation(repeat('0', 64));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin perform public.accept_agency_invitation((select token from t_inv)); raise notice 'I6 other user accepts: ALLOWED (BAD)'; exception when others then raise notice 'I6 other user accepts denied: %', sqlerrm; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select 'I7 newbie before: in agency=' || count(*) from profiles where user_id = auth.uid();
select 'I7 newbie accepts → ' || public.accept_agency_invitation((select token from t_inv));
select 'I7 newbie profile: ' || role || ' agency=' || (select name from agencies where id = agency_id) from profiles where user_id = auth.uid();
select 'I7 newbie is admin=' || is_agency_admin() || ' sees: ' || coalesce(string_agg(id, ',' order by id), '') from submissions;
select 'I7 accept again (same person)=' || public.accept_agency_invitation((select token from t_inv));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'I7 admin sees newbie''s pre-agency accounts=' || count(*) from submissions where id in ('acct_n1', 'acct_n2');
select 'I7 admin sees members: ' || string_agg(email || ':' || role, ',' order by email) from profiles;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
do $$ begin perform public.accept_agency_invitation((select token from t_inv2)); raise notice 'I8 unconfirmed email accepts: ALLOWED (BAD)'; exception when others then raise notice 'I8 unconfirmed email denied: %', sqlerrm; end $$;
reset role;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-00000000000f';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select 'I8 confirmed invitee accepts → ' || public.accept_agency_invitation((select token from t_inv2));
select 'I8 invitee profile: ' || role || '|' || coalesce(display_name, '-') || '|' || coalesce(job_title, '-') from profiles where user_id = auth.uid();
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin perform public.accept_agency_invitation((select token from t_inv3)); raise notice 'I9 member of another agency joins: ALLOWED (BAD)'; exception when others then raise notice 'I9 member of another agency denied: %', sqlerrm; end $$;
select 'I9 outsider still in: ' || (select name from agencies where id = agency_id) || ' as ' || role from profiles where user_id = auth.uid();
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'I10 admin revokes=' || public.revoke_agency_invitation((select id from t_inv4));
select 'I10 status after revoke: ' || status from public.get_agency_invitation((select token from t_inv4));
reset role;
update agency_invitations set expires_at = now() - interval '1 day' where token = (select token from t_inv3);
set role authenticated;
select pg_temp.as_user('');
select 'I11 expired status: ' || status from public.get_agency_invitation((select token from t_inv3));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
with u as (update agency_invitations set role = 'admin' returning 1) select 'I12 agent direct update affected=' || count(*) from u;
reset role;


\echo '== 0021: archive, restore, permanent delete'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into activity_events (id, submission_id, user_id, type, message) values ('ev_b1','acct_b1','00000000-0000-0000-0000-00000000000b','account_created','x') on conflict (id) do nothing;
with u as (update submissions set archived = true, archived_at = '2000-01-01', archived_by = '00000000-0000-0000-0000-00000000000d' where id = 'acct_b1' returning 1) select 'A1 agent archives own account affected=' || count(*) from u;
select 'A1 stamped by db: by_agentB=' || (archived_by = auth.uid()) || ' recent=' || (archived_at > now() - interval '1 minute') from submissions where id = 'acct_b1';
select 'A2 agent can_delete_account(archived own)=' || can_delete_account('acct_b1');
with d as (delete from submissions where id = 'acct_b1' returning 1) select 'A2 agent deletes archived own affected=' || count(*) from d;
update submissions set archived = false where id = 'acct_b1';
select 'A3 agent restore attempt → archived=' || archived || ' by_agentB=' || (archived_by = auth.uid()) from submissions where id = 'acct_b1';
insert into submissions (id, user_id, named_insured, archived) values ('acct_b1','00000000-0000-0000-0000-00000000000b','B Logistics',false) on conflict (id) do update set archived = excluded.archived;
select 'A3 stale full save (archived=false) → archived=' || archived from submissions where id = 'acct_b1';
with d as (delete from submissions where id = 'acct_r3' returning 1) select 'A4 agent deletes active account affected=' || count(*) from d;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'A5 other agency admin can_delete_account(acct_b1)=' || can_delete_account('acct_b1');
with d as (delete from submissions where id = 'acct_b1' returning 1) select 'A5 other agency admin deletes affected=' || count(*) from d;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'A6 admin can_delete_account(active acct_r3)=' || can_delete_account('acct_r3');
with d as (delete from submissions where id = 'acct_r3' returning 1) select 'A6 admin deletes active account affected=' || count(*) from d;
select 'A6 admin sees archived acct_b1=' || count(*) from submissions where id = 'acct_b1' and archived;
update submissions set archived = false where id = 'acct_b1';
select 'A7 admin restores → archived=' || archived || ' at=' || coalesce(archived_at::text, 'null') || ' by=' || coalesce(archived_by::text, 'null') from submissions where id = 'acct_b1';
update submissions set archived = true where id = 'acct_b1';
select 'A8 admin archives: by_admin=' || (archived_by = auth.uid()) || ' can_delete=' || can_delete_account('acct_b1') from submissions where id = 'acct_b1';
with d as (delete from submissions where id = 'acct_b1' returning 1) select 'A8 admin deletes archived affected=' || count(*) from d;
reset role;
select 'A8 after delete: row=' || (select count(*) from submissions where id = 'acct_b1') || ' activity=' || (select count(*) from activity_events where submission_id = 'acct_b1');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
update submissions set archived = true where id = 'acct_n1';
select 'A9 personal account owner can_delete=' || can_delete_account('acct_n1');
with d as (delete from submissions where id = 'acct_n1' returning 1) select 'A9 owner deletes own archived personal account affected=' || count(*) from d;
select pg_temp.as_user('');
select 'A10 signed out can_delete_account(acct_r1)=' || can_delete_account('acct_r1');
reset role;

\echo '== 0022: an admin assigns their own personal (pre-agency) account'
insert into submissions (id, user_id, named_insured, organization_id, assigned_user_id) values ('acct_d_old','00000000-0000-0000-0000-00000000000d','Owner Early',null,null), ('acct_d_old2','00000000-0000-0000-0000-00000000000d','Owner Early 2',null,null);
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$ begin update submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000c' where id = 'acct_d_old2'; raise notice 'G1 assign own personal to other-agency user: ALLOWED (BAD)'; exception when others then raise notice 'G1 assign own personal outside agency denied: %', sqlerrm; end $$;
update submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000b' where id = 'acct_d_old';
select 'G2 admin assigns own personal → in agency=' || (organization_id = current_agency_id()) || ' assigned_agentB=' || (assigned_user_id = '00000000-0000-0000-0000-00000000000b') from submissions where id = 'acct_d_old';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'G2 agentB now sees it=' || count(*) from submissions where id = 'acct_d_old';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ begin update submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000b' where id = 'acct_n2'; raise notice 'G3 agent reassigns own personal: ALLOWED (BAD)'; exception when others then raise notice 'G3 agent reassign own personal denied: %', sqlerrm; end $$;
select 'G3 acct_n2 still personal=' || (organization_id is null) from submissions where id = 'acct_n2';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
with u as (update submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000c' where id = 'acct_d_old2' returning 1) select 'G4 other agency admin assigns it affected=' || count(*) from u;
reset role;
select 'G4 acct_d_old2 still personal=' || (organization_id is null) || ' unassigned=' || (assigned_user_id is null) from submissions where id = 'acct_d_old2';

\echo '== 0023: agency carriers — admins manage, members read'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
insert into agency_carriers (name, agency_id, criteria) values ('Blue Ridge Mutual', (select id from agencies where name <> (select name from agencies a2 where a2.id = current_agency_id()) limit 1), '{"fleetSize":{"min":1,"max":25}}');
select 'C1 admin adds carrier → own agency=' || (agency_id = current_agency_id()) || ' created_by_admin=' || (created_by = auth.uid()) from agency_carriers where name = 'Blue Ridge Mutual';
insert into agency_carriers (name, base_record_id) values ('Built-in edited', 'canal-express');
do $$ begin insert into agency_carriers (name, base_record_id) values ('dup', 'canal-express'); raise notice 'C2 second version of same built-in: ALLOWED (BAD)'; exception when others then raise notice 'C2 second version of same built-in denied'; end $$;
update agency_carriers set notes = 'Prefers 3+ yrs', archived_at = '2000-01-01' where name = 'Built-in edited';
select 'C3 admin archives: stamped_now=' || (archived_at > now() - interval '1 minute') || ' by_admin=' || (archived_by = auth.uid()) from agency_carriers where name = 'Built-in edited';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'C4 agent reads agency carriers=' || count(*) from agency_carriers;
do $$ begin insert into agency_carriers (name) values ('Agent carrier'); raise notice 'C5 agent adds carrier: ALLOWED (BAD)'; exception when others then raise notice 'C5 agent add denied'; end $$;
with u as (update agency_carriers set name = 'hacked' returning 1) select 'C5 agent update affected=' || count(*) from u;
with d as (delete from agency_carriers returning 1) select 'C5 agent delete affected=' || count(*) from d;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
with d as (delete from agency_carriers returning 1) select 'C6 admin delete affected=' || count(*) from d;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'C7 other agency admin sees=' || count(*) from agency_carriers;
with u as (update agency_carriers set name = 'stolen' returning 1) select 'C7 other agency admin update affected=' || count(*) from u;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select 'C8 newbie (agent) sees=' || count(*) from agency_carriers;
reset role;
select 'C9 names intact: ' || string_agg(name, ',' order by name) from agency_carriers;

\echo '== 0026: collaborators and assignment notifications'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'K0 roman sees acct_r2 before=' || count(*) from submissions where id = 'acct_r2';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
update submissions set collaborator_ids = array['00000000-0000-0000-0000-00000000000a'::uuid] where id = 'acct_r2';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'K1 roman (collaborator) sees acct_r2=' || count(*) || ' children=' || (select count(*) from field_values where submission_id = 'acct_r2') from submissions where id = 'acct_r2';
select 'K1 roman notified: ' || string_agg(type || ':' || message, ',') from notifications where submission_id = 'acct_r2';
with u as (update submissions set named_insured = 'Roman Freight (edited by collaborator)' where id = 'acct_r2' returning 1) select 'K2 collaborator edits account affected=' || count(*) from u;
do $$ begin update submissions set collaborator_ids = collaborator_ids || '00000000-0000-0000-0000-00000000000e'::uuid where id = 'acct_r2'; raise notice 'K2 collaborator adds collaborator: ALLOWED (BAD)'; exception when others then raise notice 'K2 collaborator adds collaborator denied: %', sqlerrm; end $$;
do $$ begin update submissions set assigned_user_id = auth.uid() where id = 'acct_r2'; raise notice 'K2 collaborator reassigns: ALLOWED (BAD)'; exception when others then raise notice 'K2 collaborator reassign denied: %', sqlerrm; end $$;
with d as (delete from submissions where id = 'acct_r2' returning 1) select 'K2 collaborator deletes affected=' || count(*) from d;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update submissions set collaborator_ids = collaborator_ids || '00000000-0000-0000-0000-00000000000e'::uuid where id = 'acct_r2';
select 'K3 primary broker adds newbie: ' || array_length(collaborator_ids, 1) from submissions where id = 'acct_r2';
do $$ begin update submissions set collaborator_ids = collaborator_ids || '00000000-0000-0000-0000-00000000000c'::uuid where id = 'acct_r2'; raise notice 'K4 add other-agency user: ALLOWED (BAD)'; exception when others then raise notice 'K4 other-agency collaborator denied: %', sqlerrm; end $$;
select 'K4 agentB reads roman''s notifications=' || count(*) from notifications where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
with u as (update notifications set read_at = now() where user_id = auth.uid() returning 1) select 'K5 roman marks own read=' || count(*) from u;
update notifications set message = 'forged' where user_id = auth.uid();
select 'K5 message unchanged after edit attempt=' || (count(*) filter (where message = 'forged') = 0) from notifications where user_id = auth.uid();
do $$ begin insert into notifications (user_id, type, message) values ('00000000-0000-0000-0000-00000000000b', 'assigned', 'fake'); raise notice 'K5 forge notification: ALLOWED (BAD)'; exception when others then raise notice 'K5 forge notification denied'; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
update submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000b' where id = 'acct_r3';
update submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000e' where id = 'acct_r3';
select 'K6 original stays roman (first assignee) after two reassignments: ' || (original_assigned_user_id = '00000000-0000-0000-0000-00000000000a') || ' now newbie=' || (assigned_user_id = '00000000-0000-0000-0000-00000000000e') from submissions where id = 'acct_r3';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select 'K6 newbie notified of assignment: ' || string_agg(message || ' (by ' || coalesce(actor_name, '?') || ')', ',') from notifications where type = 'assigned' and submission_id = 'acct_r3';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'K7 other agency admin sees anyone else''s notifications=' || count(*) from notifications where user_id <> auth.uid();
select 'K7 other agency admin sees acct_r2=' || count(*) from submissions where id = 'acct_r2';
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'K8 agent sees teammate names (own agency only): ' || string_agg(role, ',' order by name) || ' count=' || count(*) from agency_member_names();
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'K8 other agency admin sees Agency names=' || count(*) from agency_member_names() where name ilike '%roman%';
select pg_temp.as_user('');
select 'K8 signed out sees names=' || count(*) from agency_member_names();
reset role;
