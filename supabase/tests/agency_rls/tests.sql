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
delete from submissions where id = 'acct_spoof';

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

