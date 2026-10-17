-- Share a personal account with the agency.
--
-- Accounts created before their creator's agency existed (or before they joined it) stay personal
-- (organization_id null, 0011): only the creator sees them. Until now the only way in was for an
-- agency ADMIN who created the account to assign it (0022) — an agent had no way at all.
--
-- share_account_with_agency(id): the account's CREATOR moves it into their agency, whatever their
-- role. It stays assigned to them (unless it's already assigned to someone in the agency), so
-- nothing changes about who works on it — the agency's admins can now see it and collaborators can
-- be added. Nobody can share someone else's personal account, or into an agency they're not in.
-- Personal accounts are still never moved in bulk behind anyone's back (0018/0022).
--
-- Additive (a new function, and 0022's update trigger function replaced with a superset that only
-- lets this function change organization_id); safe to run more than once. Must run after 0022.

create or replace function public.share_account_with_agency(p_submission_id text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.submissions;
  v_agency uuid := public.current_agency_id();
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Join or create an agency first.' using errcode = '42501';
  end if;
  select * into s from public.submissions where id = p_submission_id for update;
  if not found or s.user_id is distinct from auth.uid() then
    raise exception 'Only the person who created this account can share it with the agency.' using errcode = '42501';
  end if;
  if s.organization_id is not null then
    return; -- already an agency account (a retry)
  end if;
  -- The update trigger lets organization_id change only while this is set, for this account, in
  -- this transaction (set_config(..., true) is transaction-local).
  perform set_config('renewaliq.share_account', p_submission_id, true);
  update public.submissions
     set organization_id = v_agency,
         assigned_user_id = case
           when assigned_user_id is not null
            and exists (select 1 from public.profiles p where p.user_id = s.assigned_user_id and p.agency_id = v_agency)
           then assigned_user_id
           else auth.uid()
         end
   where id = p_submission_id;
  perform set_config('renewaliq.share_account', '', true);
end;
$$;
revoke all on function public.share_account_with_agency(text) from public, anon;
grant execute on function public.share_account_with_agency(text) to authenticated;

-- 0022's rules, plus: share_account_with_agency() may move the caller's own personal account into
-- the caller's agency.
create or replace function public.submissions_before_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new; -- SQL editor / service role (e.g. the one-time agency backfill)
  end if;
  new.user_id := old.user_id;
  if old.organization_id is null and new.organization_id is not null
     and current_setting('renewaliq.share_account', true) = old.id
     and old.user_id = auth.uid()
     and new.organization_id = public.current_agency_id() then
    -- Shared by its creator (share_account_with_agency checked the assignee).
    return new;
  end if;
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
