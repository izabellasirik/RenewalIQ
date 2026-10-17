-- Safer account deletion: Archive first, permanent delete only for agency admins.
--
-- Reuses the existing `submissions.archived` flag (0003) — no second archive concept — and adds
-- who/when, stamped by the database (the app can't forge them).
--
-- WHO CAN DO WHAT (enforced here, not just in the app)
--   * Archive: anyone who can edit the account (unchanged — an agent their assigned accounts, an
--     admin every account in their agency).
--   * Restore (un-archive): an agency admin for their agency's accounts; for a personal account
--     outside any agency, its owner. Anyone else's attempt leaves the account archived (silently,
--     so a stale copy of the account being saved can't un-archive it either).
--   * Permanently delete: ONLY an account that is already archived, and ONLY by an admin of the
--     account's own agency (or, for a personal account outside any agency, its owner). Agents can
--     never delete. Cross-agency isolation is unchanged: submission_visible() still applies first.
--   * can_delete_account(id): the same rule, for the app to check BEFORE removing any files, so a
--     refused delete never leaves an account with its documents already gone.
--
-- Archiving changes nothing else: documents, files, notes, quotes and activity stay as they are.
-- Permanent delete removes the row, and ON DELETE CASCADE (0003) removes its field values,
-- coverage, vehicles, drivers, losses, documents rows and activity; the app removes the stored files
-- first (only after can_delete_account said yes).
--
-- Additive; safe to run more than once. Must run after 0011.

alter table public.submissions add column if not exists archived_at timestamptz;
alter table public.submissions add column if not exists archived_by uuid references auth.users (id) on delete set null;

create or replace function public.can_manage_archive(p_agency_id uuid, p_creator_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    case
      when auth.uid() is null then false
      when p_agency_id is null then p_creator_id = auth.uid()
      else p_agency_id = public.current_agency_id() and public.is_agency_admin()
    end,
    false)
$$;

create or replace function public.submissions_archive_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- SQL editor / service role: leave alone.
  if auth.uid() is null then
    return new;
  end if;
  -- Un-archiving is for an admin (or a personal account's owner) only; otherwise it stays archived.
  if old.archived and not new.archived and not public.can_manage_archive(old.organization_id, old.user_id) then
    new.archived := true;
  end if;
  -- Who/when is always set here, never taken from the app.
  if new.archived and not old.archived then
    new.archived_at := now();
    new.archived_by := auth.uid();
  elsif not new.archived then
    new.archived_at := null;
    new.archived_by := null;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_archive_guard on public.submissions;
create trigger submissions_archive_guard before update on public.submissions
  for each row execute function public.submissions_archive_guard();

-- Replace 0011's delete rule (anyone with access could delete) with: archived + admin/owner.
drop policy if exists "agency access: delete submissions" on public.submissions;
create policy "agency access: delete submissions" on public.submissions for delete to authenticated
  using (
    archived
    and public.submission_visible(organization_id, assigned_user_id, user_id)
    and public.can_manage_archive(organization_id, user_id)
  );

create or replace function public.can_delete_account(p_submission_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.submissions s
     where s.id = p_submission_id
       and s.archived
       and public.submission_visible(s.organization_id, s.assigned_user_id, s.user_id)
       and public.can_manage_archive(s.organization_id, s.user_id)
  )
$$;

revoke all on function public.can_manage_archive(uuid, uuid) from public;
revoke all on function public.can_delete_account(text) from public;
grant execute on function public.can_manage_archive(uuid, uuid) to authenticated;
grant execute on function public.can_delete_account(text) to authenticated;
