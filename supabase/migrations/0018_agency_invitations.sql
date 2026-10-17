-- Agency invitations: an agency admin invites someone by work email and role; the invited person
-- opens the link, signs up or signs in with THAT email, and joins the admin's agency with that role.
--
-- Reuses 0011 as-is: agencies, profiles (one agency per user; role 'agent' | 'admin'),
-- current_agency_id(), is_agency_admin(). No existing table, policy or function is changed, and the
-- account permission rules (submission_visible / can_access_submission) are untouched — joining an
-- agency is exactly the same as being added by the setup script.
--
-- SECURITY
--   * agency_invitations has RLS with a single SELECT policy (admins of that agency). No insert /
--     update / delete policy: invitations are created, revoked and accepted only through the
--     SECURITY DEFINER functions below, which do their own checks.
--   * create: caller must be an admin of an agency (is_agency_admin()); the agency is ALWAYS the
--     caller's own (current_agency_id()), never a parameter — an admin can't invite into another
--     agency and an agent can't invite at all.
--   * accept: the invitation must be open (not accepted, revoked or expired), and the caller's own
--     login email (auth.users.email, confirmed) must equal the invited email — a forwarded or leaked
--     link is useless to anyone else. Someone already in a different agency is refused (one agency
--     per user; moving people between agencies stays a deliberate SQL step). Someone already in this
--     agency keeps their current role. The role comes from the invitation, never from the caller.
--   * The token is 256 bits of randomness (two v4 UUIDs), single-use, and expires after 14 days.
--   * lookup (get_agency_invitation) returns only the agency name, invited email, role and status —
--     to whoever holds the link — so the invite page can say "You've been invited to join …".
--
-- Additive; safe to run more than once. Must run after 0011 (and 0017 for phone/job title copying).

create table if not exists public.agency_invitations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  email text not null,
  role text not null default 'agent',
  token text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  constraint agency_invitations_role_check check (role in ('agent', 'admin')),
  constraint agency_invitations_email_check check (email = lower(btrim(email)) and email like '%_@_%')
);

create index if not exists agency_invitations_agency_id_idx on public.agency_invitations (agency_id);
-- At most one open invitation per agency + email (re-inviting replaces the old one).
create unique index if not exists agency_invitations_one_open_idx on public.agency_invitations (agency_id, email) where accepted_at is null and revoked_at is null;

alter table public.agency_invitations enable row level security;

drop policy if exists "agency admins read their invitations" on public.agency_invitations;
create policy "agency admins read their invitations" on public.agency_invitations for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());

-- ------------------------------------------------------------------------------------------------
-- create (admins only)
-- ------------------------------------------------------------------------------------------------
create or replace function public.create_agency_invitation(p_email text, p_role text default 'agent')
returns table (id uuid, token text, email text, role text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := coalesce(nullif(btrim(p_role), ''), 'agent');
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_agency is null or not public.is_agency_admin() then raise exception 'Only an agency admin can invite team members'; end if;
  if v_role not in ('agent', 'admin') then raise exception 'Role must be agent or admin'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid work email'; end if;
  if exists (select 1 from public.profiles p where p.agency_id = v_agency and lower(p.email) = v_email) then
    raise exception 'This person is already on your team';
  end if;

  update public.agency_invitations i set revoked_at = now()
   where i.agency_id = v_agency and i.email = v_email and i.accepted_at is null and i.revoked_at is null;

  return query
  insert into public.agency_invitations (agency_id, email, role, token, invited_by)
  values (v_agency, v_email, v_role, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), auth.uid())
  returning agency_invitations.id, agency_invitations.token, agency_invitations.email, agency_invitations.role, agency_invitations.expires_at;
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- revoke (admins of that agency only)
-- ------------------------------------------------------------------------------------------------
create or replace function public.revoke_agency_invitation(p_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  updated integer;
begin
  if auth.uid() is null or not public.is_agency_admin() then raise exception 'Only an agency admin can revoke invitations'; end if;
  update public.agency_invitations i set revoked_at = now()
   where i.id = p_id and i.agency_id = public.current_agency_id() and i.accepted_at is null and i.revoked_at is null;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- lookup by link (anyone holding the link — the invite page, before sign-in)
-- ------------------------------------------------------------------------------------------------
create or replace function public.get_agency_invitation(p_token text)
returns table (agency_name text, email text, role text, status text)
language sql stable security definer set search_path = ''
as $$
  select a.name, i.email, i.role,
         case when i.accepted_at is not null then 'accepted'
              when i.revoked_at is not null then 'revoked'
              when i.expires_at < now() then 'expired'
              else 'open' end
    from public.agency_invitations i
    join public.agencies a on a.id = i.agency_id
   where i.token = p_token and length(coalesce(p_token, '')) >= 32;
$$;

-- ------------------------------------------------------------------------------------------------
-- accept (the invited person, signed in with the invited email)
-- ------------------------------------------------------------------------------------------------
create or replace function public.accept_agency_invitation(p_token text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  inv public.agency_invitations%rowtype;
  v_email text;
  v_confirmed timestamptz;
  v_meta jsonb;
  v_current uuid;
  v_agency_name text;
begin
  if auth.uid() is null then raise exception 'Sign in to accept this invitation'; end if;

  select * into inv from public.agency_invitations where token = p_token for update;
  if not found or length(coalesce(p_token, '')) < 32 then raise exception 'This invitation link is not valid'; end if;
  if inv.revoked_at is not null then raise exception 'This invitation was cancelled — ask your admin for a new one'; end if;
  if inv.accepted_at is not null and inv.accepted_by is distinct from auth.uid() then raise exception 'This invitation has already been used'; end if;
  if inv.accepted_at is null and inv.expires_at < now() then raise exception 'This invitation has expired — ask your admin for a new one'; end if;

  select lower(u.email), u.email_confirmed_at, coalesce(u.raw_user_meta_data, '{}'::jsonb)
    into v_email, v_confirmed, v_meta
    from auth.users u where u.id = auth.uid();
  if v_email is distinct from inv.email then raise exception 'This invitation was sent to a different email address — sign in as %', inv.email; end if;
  if v_confirmed is null then raise exception 'Confirm your email address first, then open the invitation again'; end if;

  select a.name into v_agency_name from public.agencies a where a.id = inv.agency_id;
  select p.agency_id into v_current from public.profiles p where p.user_id = auth.uid();

  if v_current is not null and v_current <> inv.agency_id then
    raise exception 'You are already a member of another agency. Contact support to move to %', v_agency_name;
  end if;

  if v_current is null then
    insert into public.profiles (user_id, agency_id, role, email, display_name, phone, job_title)
    values (auth.uid(), inv.agency_id, inv.role, v_email,
            nullif(btrim(v_meta ->> 'full_name'), ''), nullif(btrim(v_meta ->> 'work_phone'), ''), nullif(btrim(v_meta ->> 'job_title'), ''));
  end if;

  update public.agency_invitations set accepted_at = coalesce(accepted_at, now()), accepted_by = auth.uid() where id = inv.id;
  return v_agency_name;
end;
$$;

revoke all on function public.create_agency_invitation(text, text) from public, anon;
revoke all on function public.revoke_agency_invitation(uuid) from public, anon;
revoke all on function public.accept_agency_invitation(text) from public, anon;
revoke all on function public.get_agency_invitation(text) from public;
grant execute on function public.create_agency_invitation(text, text) to authenticated;
grant execute on function public.revoke_agency_invitation(uuid) to authenticated;
grant execute on function public.accept_agency_invitation(text) to authenticated;
grant execute on function public.get_agency_invitation(text) to anon, authenticated;
