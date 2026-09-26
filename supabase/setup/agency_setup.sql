-- RenewalIQ — one-time agency setup (run AFTER migration 0011_agency_roles.sql).
--
-- Run each STEP separately in the Supabase SQL editor, in order. Replace the placeholder emails
-- and agency name first. Steps 1 and 5 are read-only. Nothing here deletes data.
--
-- Until step 4 runs, every existing account stays exactly as private as before (visible only to
-- the broker who created it) — so it's safe to stop after any step.
--
-- After 0018_agency_invitations.sql: only a NEW agency's first admin needs steps 2–3 here. Everyone
-- else is added from the app — Team → Invite Team Member.

-- ------------------------------------------------------------------------------------------------
-- STEP 1 (read-only): who exists, and which accounts need ownership assigned.
-- ------------------------------------------------------------------------------------------------

-- 1a. Every login, with how many accounts they created and whether they're in an agency yet.
select u.id as user_id, u.email, p.role, a.name as agency,
       (select count(*) from public.submissions s where s.user_id = u.id) as accounts_created
from auth.users u
left join public.profiles p on p.user_id = u.id
left join public.agencies a on a.id = p.agency_id
order by u.email;

-- 1b. Accounts not yet in any agency (these need ownership assigned by step 4), with their creator.
select s.id, s.named_insured, u.email as created_by, s.assigned_broker ->> 'name' as assigned_broker_label, s.updated_at
from public.submissions s
join auth.users u on u.id = s.user_id
where s.organization_id is null
order by u.email, s.named_insured;

-- ------------------------------------------------------------------------------------------------
-- STEP 2: create the agency (once).
-- ------------------------------------------------------------------------------------------------

insert into public.agencies (name)
select 'YOUR AGENCY NAME'
where not exists (select 1 from public.agencies where name = 'YOUR AGENCY NAME');

-- ------------------------------------------------------------------------------------------------
-- STEP 3: put people in the agency. The user must already have signed up (exist in auth.users).
-- Re-running is safe; it updates the role.
-- ------------------------------------------------------------------------------------------------

-- 3a. The admin / agency owner (e.g. Denis).
insert into public.profiles (user_id, agency_id, role, email, display_name)
select u.id, a.id, 'admin', u.email, 'Denis'
from auth.users u, public.agencies a
where u.email = 'denis@example.com' and a.name = 'YOUR AGENCY NAME'
on conflict (user_id) do update set role = 'admin', agency_id = excluded.agency_id, email = excluded.email, display_name = excluded.display_name;

-- 3b. Each agent (repeat per broker — change the email and display name).
insert into public.profiles (user_id, agency_id, role, email, display_name)
select u.id, a.id, 'agent', u.email, 'Roman'
from auth.users u, public.agencies a
where u.email = 'roman@example.com' and a.name = 'YOUR AGENCY NAME'
on conflict (user_id) do update set role = 'agent', agency_id = excluded.agency_id, email = excluded.email, display_name = excluded.display_name;

-- (Optional) Denis also reviews /admin/feedback and appetite updates — that's the separate
-- admin_users list from 0001, unchanged. Only needed if he isn't in it already:
insert into public.admin_users (user_id, email)
select id, email from auth.users where email = 'denis@example.com'
on conflict (user_id) do nothing;

-- ------------------------------------------------------------------------------------------------
-- STEP 4: move existing accounts into the agency. Each account is assigned to the broker who
-- CREATED it, so every agent keeps seeing exactly the accounts they see today, and the admin
-- starts seeing them too. Only accounts whose creator is now in an agency are touched; accounts
-- created by anyone not added in step 3 stay private to their creator.
-- Review the output of 1b first. If an account should go to someone other than its creator,
-- reassign it afterwards from the app (admin → Agent dropdown) or with the statement in step 6.
-- ------------------------------------------------------------------------------------------------

update public.submissions s
set organization_id = p.agency_id,
    assigned_user_id = coalesce(s.assigned_user_id, s.user_id)
from public.profiles p
where p.user_id = s.user_id
  and s.organization_id is null;

-- ------------------------------------------------------------------------------------------------
-- STEP 5 (read-only): check the result.
-- ------------------------------------------------------------------------------------------------

select a.name as agency, coalesce(ap.email, '(unassigned)') as assigned_agent, count(*) as accounts
from public.submissions s
left join public.agencies a on a.id = s.organization_id
left join public.profiles ap on ap.user_id = s.assigned_user_id
group by 1, 2
order by 1, 2;

-- ------------------------------------------------------------------------------------------------
-- STEP 6 (as needed): reassign one account from SQL (the app's admin dropdown does the same).
-- ------------------------------------------------------------------------------------------------

-- update public.submissions
-- set assigned_user_id = (select user_id from public.profiles where email = 'agentb@example.com')
-- where id = 'acct_xxxxxxxx';

-- Removing someone from the agency later: reassign their accounts first (step 6), then
--   delete from public.profiles where email = 'someone@example.com';
-- Don't delete their auth user in Authentication → Users: 0003's foreign keys cascade, so that
-- would also delete every account they created.
