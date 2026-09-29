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

\echo '== 0027: team management — change role, remove member'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin perform set_agency_member_role('00000000-0000-0000-0000-00000000000a', 'admin'); raise notice 'M1 agent self-promotes: ALLOWED (BAD)'; exception when others then raise notice 'M1 agent change role denied: %', sqlerrm; end $$;
do $$ begin perform remove_agency_member('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a'); raise notice 'M1 agent removes member: ALLOWED (BAD)'; exception when others then raise notice 'M1 agent remove denied: %', sqlerrm; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin perform set_agency_member_role('00000000-0000-0000-0000-00000000000a', 'admin'); raise notice 'M2 other agency admin changes role: ALLOWED (BAD)'; exception when others then raise notice 'M2 other agency admin denied: %', sqlerrm; end $$;
do $$ begin perform remove_agency_member('00000000-0000-0000-0000-00000000000a', null); raise notice 'M2 other agency admin removes: ALLOWED (BAD)'; exception when others then raise notice 'M2 other agency admin remove denied: %', sqlerrm; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select set_agency_member_role('00000000-0000-0000-0000-00000000000a', 'admin');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'M3 roman promoted: is admin=' || is_agency_admin() || ' sees=' || count(*) from submissions where organization_id is not null;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select set_agency_member_role('00000000-0000-0000-0000-00000000000a', 'agent');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'M3 roman demoted: is admin=' || is_agency_admin();
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select set_agency_member_role('00000000-0000-0000-0000-00000000000f', 'agent');
do $$ begin perform set_agency_member_role(auth.uid(), 'agent'); raise notice 'M4 last admin demotes self: ALLOWED (BAD)'; exception when others then raise notice 'M4 last admin denied: %', sqlerrm; end $$;
select set_agency_member_role('00000000-0000-0000-0000-00000000000f', 'admin');
do $$ begin perform set_agency_member_role('00000000-0000-0000-0000-00000000000a', 'owner'); raise notice 'M4 unknown role: ALLOWED (BAD)'; exception when others then raise notice 'M4 unknown role denied: %', sqlerrm; end $$;
do $$ begin perform remove_agency_member(auth.uid(), '00000000-0000-0000-0000-00000000000a'); raise notice 'M5 admin removes self: ALLOWED (BAD)'; exception when others then raise notice 'M5 remove self denied: %', sqlerrm; end $$;
do $$ begin perform remove_agency_member('00000000-0000-0000-0000-00000000000b', null); raise notice 'M5 remove without reassign: ALLOWED (BAD)'; exception when others then raise notice 'M5 remove without reassign denied: %', sqlerrm; end $$;
do $$ begin perform remove_agency_member('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c'); raise notice 'M5 reassign to other agency: ALLOWED (BAD)'; exception when others then raise notice 'M5 reassign outside agency denied: %', sqlerrm; end $$;
select 'M5 agentB still a member=' || count(*) from profiles where user_id = '00000000-0000-0000-0000-00000000000b';
select 'M6 remove agentB → roman, moved=' || remove_agency_member('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a');
select 'M6 accounts now: ' || string_agg(id || '→' || coalesce(assigned_user_id::text, '-') || ' collab=' || array_length(collaborator_ids, 1), ' ' order by id) from submissions where id in ('acct_b1', 'acct_r2');
select 'M6 activity: ' || string_agg(message, ' | ' order by submission_id) from activity_events where type = 'broker_assigned' and message like '%removed from the agency%';
select 'M6 agentB profile rows=' || count(*) from profiles where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'M7 removed agentB: agency=' || coalesce(current_agency_id()::text, 'none') || ' sees agency accounts=' || count(*) from submissions where organization_id is not null;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'M7 roman sees taken-over accounts: ' || string_agg(id, ',' order by id) from submissions;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'M8 remove newbie (collaborator + 1 account) → denis, moved=' || remove_agency_member('00000000-0000-0000-0000-00000000000e', auth.uid());
select 'M8 acct_r2 collaborators=' || coalesce(array_length(collaborator_ids, 1), 0) || ' acct_r3 → denis=' || (select assigned_user_id = auth.uid() from submissions where id = 'acct_r3') from submissions where id = 'acct_r2';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select 'M8 removed newbie keeps personal accounts: ' || coalesce(string_agg(id, ',' order by id), '') from submissions;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'M9 member without accounts removed, moved=' || remove_agency_member('00000000-0000-0000-0000-00000000000f', null);
reset role;

\echo '== 0028: atomic account save'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select replace_submission_children('acct_r1',
  '[{"id":"acct_r1::fv::x","submission_id":"acct_r1","user_id":"00000000-0000-0000-0000-00000000000a","section":"business","field_key":"namedInsured","value":"R One","confidence":"manual","status":"manual","is_manual":true}]',
  '[]', '[]', '[]',
  '[{"id":"drv_a1","submission_id":"acct_r1","user_id":"00000000-0000-0000-0000-00000000000a","name":"Ann","details":{"licenseNumber":"X1"}},{"id":"drv_a2","submission_id":"acct_r1","user_id":"00000000-0000-0000-0000-00000000000a","name":"Bob"}]',
  '[{"id":"loss_a1","submission_id":"acct_r1","user_id":"00000000-0000-0000-0000-00000000000a","loss_date":"2024-01-02","claim_type":"Collision","paid":100,"reserved":0,"incurred":100,"status":"closed"}]');
select 'R1 saved: drivers=' || (select count(*) from drivers where submission_id = 'acct_r1') || ' details=' || (select details->>'licenseNumber' from drivers where id = 'drv_a1') || ' losses=' || (select count(*) from losses where submission_id = 'acct_r1') || ' created_at set=' || (select bool_and(created_at is not null) from drivers where submission_id = 'acct_r1');
do $$ begin perform replace_submission_children('acct_r1', '[]', '[]', '[]', '[]',
  '[{"id":"drv_a3","submission_id":"acct_r1","user_id":"00000000-0000-0000-0000-00000000000a","name":"Cy"}]',
  '[{"id":"loss_bad","submission_id":"acct_r1","user_id":"00000000-0000-0000-0000-00000000000a","loss_date":"2024-01-02","claim_type":"x","status":"weird"}]');
  raise notice 'R2 bad row accepted (BAD)'; exception when others then raise notice 'R2 refused save rolled back'; end $$;
select 'R2 previous rows intact: drivers=' || string_agg(name, ',' order by name) || ' losses=' || (select count(*) from losses where submission_id = 'acct_r1') || ' fields=' || (select count(*) from field_values where submission_id = 'acct_r1') from drivers where submission_id = 'acct_r1';
do $$ begin perform replace_submission_children('acct_r1', '[]', '[]', '[]', '[]', '[{"id":"drv_x","submission_id":"acct_b1","user_id":"00000000-0000-0000-0000-00000000000a","name":"Sneak"}]', '[]'); raise notice 'R3 row for another account: ALLOWED (BAD)'; exception when others then raise notice 'R3 row for another account denied: %', sqlerrm; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin perform replace_submission_children('acct_r1', '[]', '[]', '[]', '[]', '[]', '[]'); raise notice 'R4 other agency wipes account: ALLOWED (BAD)'; exception when others then raise notice 'R4 other agency denied: %', sqlerrm; end $$;
do $$ begin perform insert_submission_rows('drivers', '[{"id":"drv_y","submission_id":"acct_r1","user_id":"00000000-0000-0000-0000-00000000000c","name":"Sneak"}]'); raise notice 'R4 direct insert helper: ALLOWED (BAD)'; exception when others then raise notice 'R4 insert helper still RLS-checked'; end $$;
do $$ begin perform insert_submission_rows('submissions', '[]'); raise notice 'R4 other table: ALLOWED (BAD)'; exception when others then raise notice 'R4 other table refused'; end $$;
reset role;
select 'R5 after all: acct_r1 drivers=' || count(*) from drivers where submission_id = 'acct_r1';

\echo '== 0030: client document requests'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select r->>'id' as rq1, r->>'token' as tk1 from (select create_document_request('acct_r1', 'aaaaaaaa-0000-0000-0000-000000000001', '{"id":"c1","name":"John Smith","email":"john@x.com"}', 'email',
  '[{"missingItemId":"mi_mvr","label":"Current MVR — Alex Smith"},{"missingItemId":"mi_ifta","label":"Q2 IFTA"},{"missingItemId":"mi_loss","label":"Updated Loss Runs","instructions":"last 5 years"}]', '2026-10-01') r) x \gset
select 'D1 created: status=' || status || ' items=' || (select count(*) from document_request_items where request_id = :'rq1') || ' next=' || next_follow_up from document_requests where id = :'rq1';
select 'D1 same click again, same request: ' || ((create_document_request('acct_r1', 'aaaaaaaa-0000-0000-0000-000000000001', '{}', 'email', '[{"missingItemId":"x","label":"x"}]', null))->>'id' = :'rq1') || ' total=' || (select count(*) from document_requests);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin perform create_document_request('acct_r1', gen_random_uuid(), '{}', 'email', '[{"missingItemId":"x","label":"x"}]', null); raise notice 'D1 other agency creates: ALLOWED (BAD)'; exception when others then raise notice 'D1 other agency create denied: %', sqlerrm; end $$;
select 'D1 other agency reads requests=' || count(*) from document_requests;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'D1 agency admin reads requests=' || count(*) from document_requests;

reset role;
grant usage on schema public, storage to anon; grant all on storage.objects to anon;
set role anon;
select pg_temp.as_user('');
select 'D2 client view: ' || (v->>'accountName') || ' | ' || (select string_agg((i->>'label') || ':' || (i->>'received'), ', ') from jsonb_array_elements(v->'items') i) || ' | status=' || (v->>'status') || ' | keys=' || (select string_agg(k, ',' order by k) from jsonb_object_keys(v) k) from get_document_request(:'tk1') v;
select 'D2 unknown link: ' || coalesce(get_document_request(gen_random_uuid())::text, 'null');
do $$ begin perform count(*) from document_requests; raise notice 'D2 client reads tables: ALLOWED (BAD)'; exception when others then raise notice 'D2 client reads tables denied'; end $$;
select id as it1 from document_request_items limit 0 \gset
reset role;
select id as it_mvr from document_request_items where request_id = :'rq1' and missing_item_id = 'mi_mvr' \gset
select id as it_ifta from document_request_items where request_id = :'rq1' and missing_item_id = 'mi_ifta' \gset
select id as it_loss from document_request_items where request_id = :'rq1' and missing_item_id = 'mi_loss' \gset
select set_config('my.tk1', :'tk1', false) is not null as _a \gset
select set_config('my.itmvr', :'it_mvr', false) is not null as _b \gset
set role anon;
select pg_temp.as_user('');

-- Uploading the MVR
do $$ begin insert into storage.objects (bucket_id, name) values ('intake-uploads', 'not-a-token/key-aaaa-0001/x.pdf'); raise notice 'D3 upload to a random folder: ALLOWED (BAD)'; exception when others then raise notice 'D3 upload outside an open request denied'; end $$;
do $$ begin perform attach_document_request_file(current_setting('my.tk1')::uuid, current_setting('my.itmvr'), 'key-aaaa-0001', 'mvr.pdf', current_setting('my.tk1') || '/key-aaaa-0001/mvr.pdf', 10); raise notice 'D3 attach without file: ALLOWED (BAD)'; exception when others then raise notice 'D3 attach a file not in storage denied: %', sqlerrm; end $$;
insert into storage.objects (bucket_id, name) values ('intake-uploads', :'tk1' || '/key-aaaa-0001/mvr.pdf');
do $$ begin perform attach_document_request_file(current_setting('my.tk1')::uuid, current_setting('my.itmvr'), 'key-aaaa-0001', 'mvr.pdf', 'someone-else/key-aaaa-0001/mvr.pdf', 10); raise notice 'D3 foreign path: ALLOWED (BAD)'; exception when others then raise notice 'D3 path outside this request denied: %', sqlerrm; end $$;
select 'D3 attach: status=' || (v->>'status') || ' mvr received=' || (select (i->>'received') from jsonb_array_elements(v->'items') i where i->>'id' = :'it_mvr') from attach_document_request_file(:'tk1', :'it_mvr', 'key-aaaa-0001', 'mvr.pdf', :'tk1' || '/key-aaaa-0001/mvr.pdf', 10) v;
select 'D3 same file again (retry/double click): ' || (v->>'status') from attach_document_request_file(:'tk1', :'it_mvr', 'key-aaaa-0001', 'mvr.pdf', :'tk1' || '/key-aaaa-0001/mvr.pdf', 10) v;
reset role;
select 'D3 files=' || count(*) || ' upload activity=' || (select count(*) from activity_events where submission_id = 'acct_r1' and type = 'document_uploaded' and message like '%mvr.pdf%') from document_request_files where request_id = :'rq1';
select 'D3 activity: ' || message || ' (by ' || actor_name || ')' from activity_events where submission_id = 'acct_r1' and type = 'document_uploaded' and message like '%mvr.pdf%';

-- Another request's link can't reach this one
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select r->>'id' as rq2, r->>'token' as tk2 from (select create_document_request('acct_r1', gen_random_uuid(), '{"name":"Jane"}', 'email', '[{"missingItemId":"mi_app","label":"Application"}]', null) r) x \gset
select set_config('my.tk2', :'tk2', false) is not null as _c \gset
set role anon;
select pg_temp.as_user('');
insert into storage.objects (bucket_id, name) values ('intake-uploads', :'tk2' || '/key-bbbb-0002/ifta.pdf');
do $$ begin perform attach_document_request_file(current_setting('my.tk2')::uuid, current_setting('my.itmvr'), 'key-bbbb-0002', 'ifta.pdf', current_setting('my.tk2') || '/key-bbbb-0002/ifta.pdf', 10); raise notice 'D4 cross-request attach: ALLOWED (BAD)'; exception when others then raise notice 'D4 other request''s item denied: %', sqlerrm; end $$;
select 'D4 request 2 sees only its own: ' || (select string_agg(i->>'label', ',') from jsonb_array_elements(v->'items') i) from get_document_request(:'tk2') v;

-- Broker imports the MVR; review decisions
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select id as f1 from document_request_files where request_id = :'rq1' \gset
select 'D5 claim=' || claim_document_request_file(:'f1') || ' claim again=' || claim_document_request_file(:'f1');
select complete_document_request_file(:'f1', 'doc_mvr', 'satisfied', null) is null as _d \gset
select 'D5 after import: request=' || r.status || ' mvr=' || i.status from document_requests r join document_request_items i on i.request_id = r.id where r.id = :'rq1' and i.id = :'it_mvr';
select set_config('my.f1', :'f1', false) is not null as _f1 \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin perform resolve_document_request_file(current_setting('my.f1'), 'reject'); raise notice 'D5 other agency changes a file: ALLOWED (BAD)'; exception when others then raise notice 'D5 other agency change denied: %', sqlerrm; end $$;

-- An ambiguous upload for the IFTA slot → needs review → rejected → asked for again
set role anon;
select pg_temp.as_user('');
insert into storage.objects (bucket_id, name) values ('intake-uploads', :'tk1' || '/key-cccc-0003/scan.pdf');
select 'D6 client uploads to IFTA: ' || (v->>'status') from attach_document_request_file(:'tk1', :'it_ifta', 'key-cccc-0003', 'scan.pdf', :'tk1' || '/key-cccc-0003/scan.pdf', 10) v;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select id as f2 from document_request_files where client_file_key = 'key-cccc-0003' \gset
select claim_document_request_file(:'f2') and true as _e \gset
select complete_document_request_file(:'f2', 'doc_scan', 'needs_review', 'Couldn''t tell what this is') is null as _f \gset
select 'D6 needs review: ifta=' || status from document_request_items where id = :'it_ifta';
select resolve_document_request_file(:'f2', 'reject') is null as _g \gset
select 'D6 rejected → asked again: ifta=' || i.status || ' request=' || r.status from document_request_items i join document_requests r on r.id = i.request_id where i.id = :'it_ifta';
set role anon;
select pg_temp.as_user('');
select 'D6 client sees remaining: ' || (select string_agg(i->>'label', ', ') from jsonb_array_elements(v->'items') i where (i->>'received') = 'false') from get_document_request(:'tk1') v;

-- Follow-up, then the rest arrives → complete
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select record_document_request_follow_up(:'rq1', '2026-10-05') is null as _h \gset
select 'D7 follow-up: count=' || follow_up_count || ' next=' || next_follow_up || ' last set=' || (last_follow_up_at is not null) from document_requests where id = :'rq1';
set role anon;
select pg_temp.as_user('');
insert into storage.objects (bucket_id, name) values ('intake-uploads', :'tk1' || '/key-dddd-0004/ifta_q2.pdf'), ('intake-uploads', :'tk1' || '/key-eeee-0005/loss.pdf');
select attach_document_request_file(:'tk1', :'it_ifta', 'key-dddd-0004', 'ifta_q2.pdf', :'tk1' || '/key-dddd-0004/ifta_q2.pdf', 10) is not null as _i \gset
select 'D8 last upload (still open until verified): ' || (v->>'status') from attach_document_request_file(:'tk1', :'it_loss', 'key-eeee-0005', 'loss.pdf', :'tk1' || '/key-eeee-0005/loss.pdf', 10) v;
-- The broker's import verifies both → complete
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select count(*) filter (where claim_document_request_file(id) and complete_document_request_file(id, 'doc_' || client_file_key, 'satisfied', null) is null) as _imp
  from document_request_files where request_id = :'rq1' and imported_at is null \gset
reset role;
select 'D8 complete: status=' || status || ' next=' || coalesce(next_follow_up::text, 'none') || ' closed=' || (closed_at is not null) from document_requests where id = :'rq1';
select 'D8 activity: ' || message from activity_events where submission_id = 'acct_r1' and message like 'Everything requested from John%';
set role anon;
select pg_temp.as_user('');
do $$ begin insert into storage.objects (bucket_id, name) values ('intake-uploads', current_setting('my.tk1') || '/key-ffff-0006/late.pdf'); raise notice 'D9 upload after complete: ALLOWED (BAD)'; exception when others then raise notice 'D9 upload after complete denied'; end $$;
do $$ begin perform record_document_request_follow_up('x', null); raise notice 'D9 anon follow-up: ALLOWED (BAD)'; exception when others then raise notice 'D9 anon broker functions denied'; end $$;

-- Cancel; expiry; settled another way
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select cancel_document_request(:'rq2') is null as _j \gset
set role anon;
select pg_temp.as_user('');
select 'D10 cancelled link shows: ' || (v->>'status') from get_document_request(:'tk2') v;
do $$ begin insert into storage.objects (bucket_id, name) values ('intake-uploads', current_setting('my.tk2') || '/key-gggg-0007/a.pdf'); raise notice 'D10 upload to cancelled: ALLOWED (BAD)'; exception when others then raise notice 'D10 upload to cancelled denied'; end $$;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select r->>'id' as rq3, r->>'token' as tk3 from (select create_document_request('acct_r1', gen_random_uuid(), '{"name":"John"}', 'email', '[{"missingItemId":"mi_app","label":"Application"},{"missingItemId":"mi_ifta","label":"Q2 IFTA"}]', '2026-10-09') r) x \gset
select 'D11 settled another way: ' || settle_document_request_items('acct_r1', array['mi_app'], 'satisfied');
select 'D11 → ' || status from document_requests where id = :'rq3';
select settle_document_request_items('acct_r1', array['mi_ifta'], 'waived') is not null as _k \gset
select 'D11 all settled: ' || status || ' next=' || coalesce(next_follow_up::text, 'none') from document_requests where id = :'rq3';
reset role;
update document_requests set expires_at = now() - interval '1 day', status = 'waiting' where id = :'rq3';
set role anon;
select pg_temp.as_user('');
select 'D12 expired link shows: ' || (v->>'status') from get_document_request(:'tk3') v;
reset role;

-- ============================================================================================
-- 0031: uploads held for review, client remove, wrong document, provenance columns
-- ============================================================================================
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select r->>'id' as rq4, r->>'token' as tk4 from (select create_document_request('acct_r1', gen_random_uuid(), '{"name":"John Smith"}', 'email', '[{"missingItemId":"mi_loss4","label":"Loss runs"},{"missingItemId":"mi_mvr4","label":"MVR — John Smith"}]', '2026-10-09') r) x \gset
select id as it4_loss from document_request_items where request_id = :'rq4' and label = 'Loss runs' \gset
select id as it4_mvr from document_request_items where request_id = :'rq4' and label like 'MVR%' \gset
select set_config('my.tk4', :'tk4', false) is not null as _e0 \gset
set role anon;
select pg_temp.as_user('');
insert into storage.objects (bucket_id, name) values ('intake-uploads', :'tk4' || '/key-e001-00001/scan.pdf'), ('intake-uploads', :'tk4' || '/key-e002-00002/loss.pdf'), ('intake-uploads', :'tk4' || '/key-e003-00003/other.pdf');
select attach_document_request_file(:'tk4', :'it4_mvr', 'key-e001-00001', 'scan.pdf', :'tk4' || '/key-e001-00001/scan.pdf', 10) is not null as _e1 \gset
select attach_document_request_file(:'tk4', :'it4_loss', 'key-e002-00002', 'loss.pdf', :'tk4' || '/key-e002-00002/loss.pdf', 10) is not null as _e2 \gset

-- E1: the automatic check holds an unclear file outside the account (no document)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select id as fe1 from document_request_files where client_file_key = 'key-e001-00001' \gset
select id as fe2 from document_request_files where client_file_key = 'key-e002-00002' \gset
select claim_document_request_file(:'fe1') and true as _e3 \gset
select complete_document_request_file(:'fe1', null, 'needs_review', 'Couldn''t tell') is null as _e4 \gset
select 'E1 held: match=' || match_status || ' imported=' || (imported_at is not null) || ' doc=' || coalesce(imported_document_id, 'none') || ' item=' || (select status from document_request_items where id = :'it4_mvr') from document_request_files where id = :'fe1';
do $$ begin perform complete_document_request_file(current_setting('my.fe2_unset', true), null, 'satisfied', null); exception when others then null; end $$;
select claim_document_request_file(:'fe2') and true as _e5 \gset
do $$ begin perform complete_document_request_file((select id from document_request_files where client_file_key = 'key-e002-00002'), null, 'satisfied', null); raise notice 'E1 accept without document: ALLOWED (BAD)'; exception when others then raise notice 'E1 accept without a document denied'; end $$;

-- E1b: the automatic check can't take a held file (a stale second tab); confirming can, and gives it back
select 'E1b auto-check claims held file: ' || claim_document_request_file(:'fe1') || ' | confirm claims it: ' || claim_document_request_file(:'fe1', true);
select release_document_request_file(:'fe1') is null as _e1b \gset
select 'E1b released: ' || (claimed_at is null) from document_request_files where id = :'fe1';

-- E2: the client removes the held file; the item is asked for again; the file leaves the view
set role anon;
select pg_temp.as_user('');
select 'E2 client sees: ' || (select string_agg((i->>'label') || '=' || (select string_agg((f->>'name') || ':' || (f->>'state') || ':' || (f->>'removable'), ',') from jsonb_array_elements(i->'files') f), ' | ' order by i->>'label') from jsonb_array_elements(v->'items') i) from get_document_request(:'tk4') v;
select 'E2 after remove: ' || (select string_agg((i->>'label') || ' received=' || (i->>'received') || ' files=' || jsonb_array_length(i->'files'), ' | ' order by i->>'label') from jsonb_array_elements(v->'items') i) from withdraw_document_request_file(:'tk4', 'key-e001-00001') v;
reset role;
select 'E2 file kept as record: ' || match_status || ' / ' || match_note from document_request_files where client_file_key = 'key-e001-00001';
set role anon;
select pg_temp.as_user('');
select 'E2 remove again (retry) ok: ' || (v->>'requestId' is not null) from withdraw_document_request_file(:'tk4', 'key-e001-00001') v;

-- E3: a file the broker is importing (claimed) can't be removed; nor can an accepted one
do $$ begin perform withdraw_document_request_file(current_setting('my.tk4')::uuid, 'key-e002-00002'); raise notice 'E3 remove while importing: ALLOWED (BAD)'; exception when others then raise notice 'E3 remove while importing denied: %', sqlerrm; end $$;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select complete_document_request_file(:'fe2', 'doc_loss4', 'satisfied', null) is null as _e6 \gset
set role anon;
select pg_temp.as_user('');
do $$ begin perform withdraw_document_request_file(current_setting('my.tk4')::uuid, 'key-e002-00002'); raise notice 'E3 remove accepted: ALLOWED (BAD)'; exception when others then raise notice 'E3 remove accepted file denied'; end $$;
-- E4: another open request's link can't remove this request's file
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select r->>'token' as tk5 from (select create_document_request('acct_r1', gen_random_uuid(), '{"name":"Other"}', 'email', '[{"missingItemId":"mi_other5","label":"Unit list"}]', null) r) x \gset
select set_config('my.tk5', :'tk5', false) is not null as _e5b \gset
set role anon;
select pg_temp.as_user('');
do $$ begin perform withdraw_document_request_file(current_setting('my.tk5')::uuid, 'key-e002-00002'); raise notice 'E4 cross-link remove: ALLOWED (BAD)'; exception when others then raise notice 'E4 other link denied: %', sqlerrm; end $$;

-- E5: a held file is confirmed only together with the document it was imported as
select attach_document_request_file(:'tk4', :'it4_mvr', 'key-e003-00003', 'other.pdf', :'tk4' || '/key-e003-00003/other.pdf', 10) is not null as _e7 \gset
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select id as fe3 from document_request_files where client_file_key = 'key-e003-00003' \gset
select claim_document_request_file(:'fe3') and true as _e8 \gset
select complete_document_request_file(:'fe3', null, 'needs_review', 'Different driver') is null as _e9 \gset
select set_config('my.fe3', :'fe3', false) is not null as _e10 \gset
do $$ begin perform resolve_document_request_file(current_setting('my.fe3'), 'satisfy', null, null); raise notice 'E5 confirm without importing: ALLOWED (BAD)'; exception when others then raise notice 'E5 confirm without importing denied'; end $$;
select resolve_document_request_file(:'fe3', 'satisfy', null, 'doc_mvr4') is null as _e11 \gset
select 'E5 confirmed: match=' || f.match_status || ' doc=' || f.imported_document_id || ' request=' || r.status from document_request_files f join document_requests r on r.id = f.request_id where f.id = :'fe3';

-- E6: wrong document after it was accepted — asked for again, request reopened, record kept
select mark_document_request_file_wrong(:'fe3', 'last year''s MVR') is null as _e12 \gset
select 'E6 wrong: match=' || f.match_status || ' note=' || f.match_note || ' item=' || i.status || ' request=' || r.status || ' closed=' || (r.closed_at is not null) from document_request_files f join document_request_items i on i.id = f.request_item_id join document_requests r on r.id = f.request_id where f.id = :'fe3';
select mark_document_request_file_wrong(:'fe3', 'x') is null as _e12b \gset
select 'E6 again is a no-op: note=' || match_note from document_request_files where id = :'fe3';
set role anon;
select pg_temp.as_user('');
select 'E6 client can upload it again: ' || (v->>'status') from get_document_request(:'tk4') v;
do $$ begin perform mark_document_request_file_wrong(current_setting('my.fe3'), 'x'); raise notice 'E7 anon wrong: ALLOWED (BAD)'; exception when others then raise notice 'E7 anon cannot mark wrong'; end $$;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin perform mark_document_request_file_wrong((select id from public.document_request_files where client_file_key = 'key-e002-00002'), 'x'); raise notice 'E7 other agency wrong: ALLOWED (BAD)'; exception when others then raise notice 'E7 other agency cannot mark wrong'; end $$;

-- E8: provenance columns exist and the atomic save keeps them
reset role;
select 'E8 details columns: ' || string_agg(table_name, ',' order by table_name) from information_schema.columns where table_schema = 'public' and column_name = 'details' and table_name in ('field_values', 'coverage_lines');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select replace_submission_children('acct_r1',
  '[{"id":"acct_r1::transportation::dotNumber","submission_id":"acct_r1","user_id":"00000000-0000-0000-0000-00000000000a","section":"transportation","field_key":"dotNumber","value":"1234567","confidence":"high","is_missing":false,"is_conflicting":false,"source_document_id":"docA","details":{"support":[{"documentId":"docB","documentName":"b.pdf"}]}}]',
  '[]', '[{"id":"acct_r1::cov::motor_truck_cargo","submission_id":"acct_r1","user_id":"00000000-0000-0000-0000-00000000000a","coverage_type":"motor_truck_cargo","details":{"sources":["docA"]}}]', '[]', '[]', '[]') is null as _e13 \gset
select 'E8 saved: support=' || (details->'support'->0->>'documentId') from field_values where id = 'acct_r1::transportation::dotNumber';
select 'E8 saved: coverage sources=' || (details->'sources'->>0) from coverage_lines where id = 'acct_r1::cov::motor_truck_cargo';
reset role;

-- ============================================================================================
-- 0032: the creator shares a personal account with their agency
-- ============================================================================================
select pg_temp.as_user('');
insert into submissions (id, user_id, named_insured, organization_id, assigned_user_id) values ('acct_a_old','00000000-0000-0000-0000-00000000000a','A Early',null,null), ('acct_a_old2','00000000-0000-0000-0000-00000000000a','A Early 2',null,null);
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$ begin perform share_account_with_agency('acct_a_old'); raise notice 'H1 admin shares an agent''s personal account: ALLOWED (BAD)'; exception when others then raise notice 'H1 sharing someone else''s account denied: %', sqlerrm; end $$;
select 'H1 admin can''t see the agent''s personal account=' || count(*) from submissions where id = 'acct_a_old';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select share_account_with_agency('acct_a_old') is null as _h1 \gset
select 'H2 agent shares own: in agency=' || (organization_id = current_agency_id()) || ' assigned to self=' || (assigned_user_id = '00000000-0000-0000-0000-00000000000a') || ' creator kept=' || (user_id = '00000000-0000-0000-0000-00000000000a') from submissions where id = 'acct_a_old';
select share_account_with_agency('acct_a_old') is null as _h2 \gset
select 'H2 again is a no-op: still in agency=' || (organization_id = current_agency_id()) from submissions where id = 'acct_a_old';
update submissions set organization_id = current_agency_id() where id = 'acct_a_old2';
select 'H3 a plain update can''t move it: still personal=' || (organization_id is null) from submissions where id = 'acct_a_old2';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'H4 admin now sees the shared account=' || count(*) from submissions where id = 'acct_a_old';
select 'H4 admin still can''t see the unshared one=' || count(*) from submissions where id = 'acct_a_old2';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin perform share_account_with_agency('acct_a_old2'); raise notice 'H5 other agency shares it: ALLOWED (BAD)'; exception when others then raise notice 'H5 other agency denied'; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ begin perform share_account_with_agency('acct_n2'); raise notice 'H6 no agency: ALLOWED (BAD)'; exception when others then raise notice 'H6 without an agency: %', sqlerrm; end $$;
reset role;
select 'H5 acct_a_old2 still personal=' || (organization_id is null) from submissions where id = 'acct_a_old2';

-- ============================================================================================
-- 0033: "Upload multiple documents" (files without an item) + agency name on the client page
-- ============================================================================================
set role anon;
select pg_temp.as_user('');
insert into storage.objects (bucket_id, name) values ('intake-uploads', :'tk4' || '/key-j001-00001/many1.pdf'), ('intake-uploads', :'tk4' || '/key-j002-00002/many2.pdf');
select 'J1 upload without an item: unassigned=' || jsonb_array_length(v->'unassigned') || ' first=' || (v->'unassigned'->0->>'name') || ' removable=' || (v->'unassigned'->0->>'removable') from attach_document_request_file(:'tk4', null, 'key-j001-00001', 'many1.pdf', :'tk4' || '/key-j001-00001/many1.pdf', 10) v;
select 'J1 retry is no duplicate: unassigned=' || jsonb_array_length(v->'unassigned') from attach_document_request_file(:'tk4', null, 'key-j001-00001', 'many1.pdf', :'tk4' || '/key-j001-00001/many1.pdf', 10) v;
select attach_document_request_file(:'tk4', null, 'key-j002-00002', 'many2.pdf', :'tk4' || '/key-j002-00002/many2.pdf', 10) is not null as _j1 \gset
select 'J2 agency name shown: ' || coalesce(v->>'agencyName', 'none') from get_document_request(:'tk4') v;
select 'J2 nothing else about the account: keys=' || (select string_agg(k, ',' order by k) from jsonb_object_keys(v) k) from get_document_request(:'tk4') v;
do $$ begin perform attach_document_request_file(current_setting('my.tk5')::uuid, null, 'key-j001-00001', 'many1.pdf', current_setting('my.tk4') || '/key-j001-00001/many1.pdf', 10); raise notice 'J3 other link attaches this file: ALLOWED (BAD)'; exception when others then raise notice 'J3 other link denied: %', sqlerrm; end $$;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select id as fj1 from document_request_files where client_file_key = 'key-j001-00001' \gset
select id as fj2 from document_request_files where client_file_key = 'key-j002-00002' \gset
select set_config('my.fj1', :'fj1', false) is not null as _j2 \gset
-- J4: the automatic check places a clear match on its one item (the MVR, asked for again in E6)
select claim_document_request_file(:'fj1') and true as _j3 \gset
do $$ begin perform complete_document_request_file(current_setting('my.fj1'), 'doc_j1', 'satisfied', null, 'no-such-item'); raise notice 'J4 place on a foreign item: ALLOWED (BAD)'; exception when others then raise notice 'J4 placing on an item outside the request denied'; end $$;
select complete_document_request_file(:'fj1', 'doc_j1', 'satisfied', null, :'it4_mvr') is null as _j4 \gset
select 'J4 placed: item=' || (request_item_id = :'it4_mvr') || ' match=' || match_status || ' mvr=' || (select status from document_request_items where id = :'it4_mvr') from document_request_files where id = :'fj1';
-- J5: an unclear one is held without an item; "Yes it's the …" needs an item, "It's for…" places it
select claim_document_request_file(:'fj2') and true as _j5 \gset
select complete_document_request_file(:'fj2', null, 'needs_review', 'Uploaded without choosing an item') is null as _j6 \gset
select 'J5 held without item: item=' || coalesce(request_item_id, 'none') || ' match=' || match_status from document_request_files where id = :'fj2';
select set_config('my.fj2', :'fj2', false) is not null as _j7 \gset
do $$ begin perform resolve_document_request_file(current_setting('my.fj2'), 'satisfy', null, 'doc_x'); raise notice 'J5 satisfy without item: ALLOWED (BAD)'; exception when others then raise notice 'J5 satisfy without an item denied: %', sqlerrm; end $$;
select resolve_document_request_file(:'fj2', 'reassign', :'it4_loss', 'doc_j2') is null as _j8 \gset
select 'J5 placed by broker: match=' || match_status || ' resolved=' || (resolved_item_id = :'it4_loss') from document_request_files where id = :'fj2';
set role anon;
select pg_temp.as_user('');
select 'J6 client sees it under its item: ' || (select string_agg((i->>'label') || '=' || (select string_agg((f->>'name') || ':' || (f->>'state'), ',' order by f->>'name') from jsonb_array_elements(i->'files') f), ' | ' order by i->>'label') from jsonb_array_elements(v->'items') i) || ' | unassigned=' || jsonb_array_length(v->'unassigned') from get_document_request(:'tk4') v;
reset role;

-- ============================================================================================
-- 0035: the client's "Submit"
-- ============================================================================================
set role anon;
select pg_temp.as_user('');
do $$ begin perform submit_document_request(current_setting('my.tk5')::uuid); raise notice 'Q1 submit with no files: ALLOWED (BAD)'; exception when others then raise notice 'Q1 submit with no files denied: %', sqlerrm; end $$;
do $$ begin perform submit_document_request(gen_random_uuid()); raise notice 'Q2 unknown link: ALLOWED (BAD)'; exception when others then raise notice 'Q2 unknown link denied: %', sqlerrm; end $$;
select v->>'submittedAt' as q_first from submit_document_request(:'tk4') v \gset
select 'Q3 submitted: submittedAt set=' || (:'q_first' <> '');
select 'Q4 submitting again with nothing new changes nothing: same time=' || ((v->>'submittedAt') = :'q_first') from submit_document_request(:'tk4') v;
reset role;
select 'Q4 broker told once: events=' || count(*) from activity_events where message like '%submitted their documents%';
select 'Q5 nothing accepted or counted by it: files still=' || (select count(*) from document_request_files f join document_requests r on r.id = f.request_id where r.token = :'tk4'::uuid);
