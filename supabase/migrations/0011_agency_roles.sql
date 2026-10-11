-- Agency-level permissions: AGENT vs ADMIN, enforced by Row Level Security.
--
-- WHAT CHANGES
--   agencies   — one row per agency (brokerage).
--   profiles   — one row per Supabase Auth user who belongs to an agency: agency_id + role
--                ('agent' | 'admin'). Written ONLY from the SQL editor / service role (there is no
--                insert/update/delete policy for app users), so nobody can promote themselves.
--   submissions.organization_id — the column 0003 reserved "for a future team/agency workspace"
--                is that agency id now (FK to agencies). Reused rather than adding a second column.
--   submissions.assigned_user_id — the Supabase Auth user id of the agent the account belongs to.
--                THIS (a uuid), never the display-only assigned_broker name/email, is what grants
--                access.
--
-- WHO CAN SEE / CHANGE AN ACCOUNT (submission_visible below — one rule, reused everywhere):
--   * account in an agency (organization_id set):
--       admin of that agency  → yes;  agent → only if assigned_user_id = their own user id;
--       anyone outside the agency → no.
--   * legacy account with no agency yet (everything saved before this migration): only the user who
--     created it (user_id) — exactly the owner-only access 0003 gave. Nothing becomes visible to
--     anyone new until the agency setup script (supabase/setup/agency_setup.sql) moves it into an
--     agency, and nothing disappears from its creator.
--   Every workflow table (field values/alternates, coverage, vehicles, drivers, losses, documents,
--   activity, and the files in the submission-documents bucket) inherits the account's rule via
--   can_access_submission() — contacts, checklist items, quotes, carrier requests and follow-ups
--   are columns on `submissions` itself (0007/0009), so they're covered by the submissions policies.
--
-- INTEGRITY (triggers, not the client):
--   * insert: user_id is forced to the caller, organization_id to the caller's agency, and
--     assigned_user_id to the caller unless an admin names another member of the same agency.
--   * update: user_id (creator) and organization_id never change from the app; only an agency
--     admin can change assigned_user_id, and only to a member of the same agency (or to null).
--   SQL-editor / service-role statements (auth.uid() is null) are left alone, so the one-time
--   backfill in the setup script works.
--
-- The old owner-only policies from 0003 are dropped and replaced: permissive policies are OR'ed,
-- so leaving them would let a creator keep reading an account after it was reassigned away.
--
-- Additive otherwise (new tables/columns/functions); safe to run more than once. Must run after
-- 0003 (and 0007/0009 if applied — no dependency on them). The existing product-feedback /
-- appetite-update admin (admin_users / is_admin() from 0001) is separate and unchanged.

-- ============================================================================================
-- Tables
-- ============================================================================================

create table if not exists agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint agencies_name_not_blank check (btrim(name) <> '')
);

create table if not exists profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  agency_id uuid not null references agencies (id) on delete restrict,
  role text not null default 'agent',
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('agent', 'admin'))
);

create index if not exists profiles_agency_id_idx on profiles (agency_id);

alter table submissions add column if not exists assigned_user_id uuid references auth.users (id) on delete set null;
create index if not exists submissions_assigned_user_id_idx on submissions (assigned_user_id);
create index if not exists submissions_organization_id_idx on submissions (organization_id);

alter table submissions drop constraint if exists submissions_organization_id_fkey;
alter table submissions add constraint submissions_organization_id_fkey foreign key (organization_id) references agencies (id) on delete restrict;

-- ============================================================================================
-- Helper functions. SECURITY DEFINER so they can read profiles/submissions regardless of those
-- tables' own RLS (no recursion), with an empty search_path and schema-qualified names so nothing
-- earlier on a path can shadow them — same convention as is_admin() in 0001.
-- ============================================================================================

create or replace function public.current_agency_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select agency_id from public.profiles where user_id = auth.uid() $$;

create or replace function public.is_agency_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin') $$;

-- The one access rule. Arguments are the submission's own columns.
create or replace function public.submission_visible(p_agency_id uuid, p_assigned_user_id uuid, p_creator_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    case
      when auth.uid() is null then false
      when p_agency_id is null then p_creator_id = auth.uid()
      else p_agency_id = public.current_agency_id() and (public.is_agency_admin() or p_assigned_user_id = auth.uid())
    end,
    false)
$$;

create or replace function public.can_access_submission(p_submission_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.submissions s
    where s.id = p_submission_id and public.submission_visible(s.organization_id, s.assigned_user_id, s.user_id)
  )
$$;

create or replace function public.can_access_field_value(p_field_value_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.field_values f where f.id = p_field_value_id and public.can_access_submission(f.submission_id))
$$;

-- Storage uploads can race the first save of a brand-new account; this lets a user write into
-- their OWN folder for an id that doesn't exist as a submission yet (and nobody else's).
create or replace function public.submission_exists(p_submission_id text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.submissions where id = p_submission_id) $$;

revoke execute on function public.current_agency_id() from public;
revoke execute on function public.is_agency_admin() from public;
revoke execute on function public.submission_visible(uuid, uuid, uuid) from public;
revoke execute on function public.can_access_submission(text) from public;
revoke execute on function public.can_access_field_value(text) from public;
revoke execute on function public.submission_exists(text) from public;
grant execute on function public.current_agency_id() to authenticated;
grant execute on function public.is_agency_admin() to authenticated;
grant execute on function public.submission_visible(uuid, uuid, uuid) to authenticated;
grant execute on function public.can_access_submission(text) to authenticated;
grant execute on function public.can_access_field_value(text) to authenticated;
grant execute on function public.submission_exists(text) to authenticated;

-- ============================================================================================
-- Integrity triggers on submissions
-- ============================================================================================

create or replace function public.submissions_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new; -- SQL editor / service role
  end if;
  new.user_id := auth.uid();
  new.organization_id := public.current_agency_id();
  if new.assigned_user_id is null or new.organization_id is null or not public.is_agency_admin() then
    new.assigned_user_id := auth.uid();
  elsif not exists (select 1 from public.profiles p where p.user_id = new.assigned_user_id and p.agency_id = new.organization_id) then
    raise exception 'The assigned agent is not a member of this agency.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.submissions_before_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new; -- SQL editor / service role (e.g. the one-time agency backfill)
  end if;
  new.user_id := old.user_id;
  new.organization_id := old.organization_id;
  if new.assigned_user_id is distinct from old.assigned_user_id then
    if old.organization_id is null or not public.is_agency_admin() then
      raise exception 'Only an agency admin can reassign an account.' using errcode = '42501';
    end if;
    if new.assigned_user_id is not null
       and not exists (select 1 from public.profiles p where p.user_id = new.assigned_user_id and p.agency_id = old.organization_id) then
      raise exception 'The assigned agent is not a member of this agency.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_before_insert on submissions;
create trigger submissions_before_insert before insert on submissions for each row execute function public.submissions_before_insert();
drop trigger if exists submissions_before_update on submissions;
create trigger submissions_before_update before update on submissions for each row execute function public.submissions_before_update();

-- ============================================================================================
-- RLS — agencies / profiles (read-only from the app)
-- ============================================================================================

alter table agencies enable row level security;
alter table profiles enable row level security;

drop policy if exists "members can read their agency" on agencies;
create policy "members can read their agency" on agencies for select to authenticated using (id = public.current_agency_id());

-- Everyone reads their own profile (to learn their role); an admin reads the whole agency's (to
-- list and assign agents). Agents can't list other agents. No write policies at all.
drop policy if exists "read own profile or agency profiles as admin" on profiles;
create policy "read own profile or agency profiles as admin" on profiles for select to authenticated
  using (user_id = auth.uid() or (agency_id = public.current_agency_id() and public.is_agency_admin()));

-- ============================================================================================
-- RLS — submissions
-- ============================================================================================

drop policy if exists "owner can select own submissions" on submissions;
drop policy if exists "owner can insert own submissions" on submissions;
drop policy if exists "owner can update own submissions" on submissions;
drop policy if exists "owner can delete own submissions" on submissions;
drop policy if exists "agency access: select submissions" on submissions;
drop policy if exists "agency access: insert submissions" on submissions;
drop policy if exists "agency access: update submissions" on submissions;
drop policy if exists "agency access: delete submissions" on submissions;

create policy "agency access: select submissions" on submissions for select to authenticated
  using (public.submission_visible(organization_id, assigned_user_id, user_id));
create policy "agency access: insert submissions" on submissions for insert to authenticated
  with check (user_id = auth.uid() and public.submission_visible(organization_id, assigned_user_id, user_id));
create policy "agency access: update submissions" on submissions for update to authenticated
  using (public.submission_visible(organization_id, assigned_user_id, user_id))
  with check (public.submission_visible(organization_id, assigned_user_id, user_id));
create policy "agency access: delete submissions" on submissions for delete to authenticated
  using (public.submission_visible(organization_id, assigned_user_id, user_id));

-- ============================================================================================
-- RLS — every table hanging off a submission inherits its access
-- ============================================================================================

do $$
declare
  t text;
begin
  foreach t in array array['field_values', 'coverage_lines', 'vehicles', 'drivers', 'losses', 'documents'] loop
    execute format('drop policy if exists "owner can select own %1$s" on %1$I', t);
    execute format('drop policy if exists "owner can insert own %1$s" on %1$I', t);
    execute format('drop policy if exists "owner can update own %1$s" on %1$I', t);
    execute format('drop policy if exists "owner can delete own %1$s" on %1$I', t);
    execute format('drop policy if exists "account access: select %1$s" on %1$I', t);
    execute format('drop policy if exists "account access: insert %1$s" on %1$I', t);
    execute format('drop policy if exists "account access: update %1$s" on %1$I', t);
    execute format('drop policy if exists "account access: delete %1$s" on %1$I', t);
    execute format('create policy "account access: select %1$s" on %1$I for select to authenticated using (public.can_access_submission(submission_id))', t);
    execute format('create policy "account access: insert %1$s" on %1$I for insert to authenticated with check (user_id = auth.uid() and public.can_access_submission(submission_id))', t);
    execute format('create policy "account access: update %1$s" on %1$I for update to authenticated using (public.can_access_submission(submission_id)) with check (public.can_access_submission(submission_id))', t);
    execute format('create policy "account access: delete %1$s" on %1$I for delete to authenticated using (public.can_access_submission(submission_id))', t);
  end loop;
end;
$$;

-- field_alternates hang off field_values (no submission_id of their own).
drop policy if exists "owner can select own field_alternates" on field_alternates;
drop policy if exists "owner can insert own field_alternates" on field_alternates;
drop policy if exists "owner can update own field_alternates" on field_alternates;
drop policy if exists "owner can delete own field_alternates" on field_alternates;
drop policy if exists "account access: select field_alternates" on field_alternates;
drop policy if exists "account access: insert field_alternates" on field_alternates;
drop policy if exists "account access: update field_alternates" on field_alternates;
drop policy if exists "account access: delete field_alternates" on field_alternates;
create policy "account access: select field_alternates" on field_alternates for select to authenticated using (public.can_access_field_value(field_value_id));
create policy "account access: insert field_alternates" on field_alternates for insert to authenticated with check (user_id = auth.uid() and public.can_access_field_value(field_value_id));
create policy "account access: update field_alternates" on field_alternates for update to authenticated using (public.can_access_field_value(field_value_id)) with check (public.can_access_field_value(field_value_id));
create policy "account access: delete field_alternates" on field_alternates for delete to authenticated using (public.can_access_field_value(field_value_id));

-- activity_events stays append-only (no update/delete policy), as in 0003.
drop policy if exists "owner can select own activity_events" on activity_events;
drop policy if exists "owner can insert own activity_events" on activity_events;
drop policy if exists "account access: select activity_events" on activity_events;
drop policy if exists "account access: insert activity_events" on activity_events;
create policy "account access: select activity_events" on activity_events for select to authenticated using (public.can_access_submission(submission_id));
create policy "account access: insert activity_events" on activity_events for insert to authenticated with check (user_id = auth.uid() and public.can_access_submission(submission_id));

-- ============================================================================================
-- Storage — submission-documents bucket. Path stays {uploader_user_id}/{submission_id}/{file_id}/
-- {filename}; access now follows the submission (segment 2), so an admin, or the agent an account
-- was reassigned to, can open files another member uploaded. Uploads still go into the uploader's
-- own folder.
-- ============================================================================================

drop policy if exists "owner can read own submission documents" on storage.objects;
drop policy if exists "owner can upload own submission documents" on storage.objects;
drop policy if exists "owner can update own submission documents" on storage.objects;
drop policy if exists "owner can delete own submission documents" on storage.objects;
drop policy if exists "account access: read submission documents" on storage.objects;
drop policy if exists "account access: upload submission documents" on storage.objects;
drop policy if exists "account access: update submission documents" on storage.objects;
drop policy if exists "account access: delete submission documents" on storage.objects;

create policy "account access: read submission documents" on storage.objects for select to authenticated
  using (
    bucket_id = 'submission-documents'
    and (
      public.can_access_submission((storage.foldername(name))[2])
      or ((storage.foldername(name))[1] = auth.uid()::text and not public.submission_exists((storage.foldername(name))[2]))
    )
  );

create policy "account access: upload submission documents" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'submission-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.can_access_submission((storage.foldername(name))[2]) or not public.submission_exists((storage.foldername(name))[2]))
  );

create policy "account access: update submission documents" on storage.objects for update to authenticated
  using (bucket_id = 'submission-documents' and public.can_access_submission((storage.foldername(name))[2]))
  with check (bucket_id = 'submission-documents' and (storage.foldername(name))[1] = auth.uid()::text and public.can_access_submission((storage.foldername(name))[2]));

create policy "account access: delete submission documents" on storage.objects for delete to authenticated
  using (
    bucket_id = 'submission-documents'
    and (
      public.can_access_submission((storage.foldername(name))[2])
      or ((storage.foldername(name))[1] = auth.uid()::text and not public.submission_exists((storage.foldername(name))[2]))
    )
  );
