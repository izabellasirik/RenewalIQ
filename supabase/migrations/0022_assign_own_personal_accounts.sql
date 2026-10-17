-- Fix: an agency owner/admin couldn't assign their own older accounts ("Only an agency admin can
-- reassign an account.").
--
-- Accounts created before their creator's agency existed (or before they joined it) keep
-- organization_id = null — they are personal, visible only to their creator (0011). 0011's update
-- trigger refuses any reassignment of such an account, even by an admin, so the owner saw the Agent
-- dropdown (they ARE an admin) but every change was rejected.
--
-- Now: the account's own creator, when they are an agency admin, may assign it — and doing so moves
-- it into their agency. Nothing else changes:
--   * agents still can't reassign anything (is_agency_admin() is still required);
--   * nobody can take another user's personal account (only its creator, old.user_id = auth.uid());
--   * agency accounts follow 0011 exactly as before; the assignee must be a member of the agency.
-- Personal accounts are NOT moved in bulk — joining an agency still doesn't expose them (0018);
-- each one moves only when its owner assigns it.
--
-- Additive (replaces one trigger function with a superset); safe to run more than once. Must run
-- after 0011.

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
    if not public.is_agency_admin() then
      raise exception 'Only an agency admin can reassign an account.' using errcode = '42501';
    end if;
    if old.organization_id is null then
      -- A personal account: only its creator may bring it into their agency by assigning it.
      if old.user_id is distinct from auth.uid() then
        raise exception 'Only an agency admin can reassign an account.' using errcode = '42501';
      end if;
      new.organization_id := public.current_agency_id();
    end if;
    if new.assigned_user_id is not null
       and not exists (select 1 from public.profiles p where p.user_id = new.assigned_user_id and p.agency_id = new.organization_id) then
      raise exception 'The assigned agent is not a member of this agency.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
