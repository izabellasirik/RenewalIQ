-- 0051: Invitations reach people who already have a login, and admins see where each one stands.
--
-- Until now an invitation was accepted only by clicking "Join" on its link page. Someone who signed
-- up without the link, or left the page before clicking, kept working with no agency — every
-- account they created was personal (only they could see it) — while the admin's Team page showed
-- the invitation as Pending indefinitely. And someone added to the team another way (e.g. by
-- support) left their invitation open forever.
--
--   * my_open_invitations(): the signed-in person's own open invitations — only those sent to their
--     own confirmed login email (never matched by email domain or anything else).
--   * accept_my_invitation(id): accept one of them from inside the app. The same rules as the link
--     (accept_agency_invitation, 0018): the email must match and be confirmed, someone already in
--     another agency is refused, the role comes from the invitation, one membership per person.
--   * Becoming a member of an agency by any route closes that agency's open invitation for the
--     person's email, so the Team page never shows a member as Pending again.
--   * list_agency_invitations(): for an agency's admins, each open invitation with its status:
--     waiting / expired / already on your team. Deliberately NOT "has a login" or "joined another
--     agency" — that would let any admin learn whether an email address uses RenewalIQ elsewhere.
--   * create_agency_invitation: "already on your team" also recognises the member by login email
--     (a member's profile email can be empty).
--   * Creating an agency while an invitation to another agency is open is refused (the person is
--     asked to accept or decline it first), so an invited person can't end up in a duplicate agency.
--
-- Nothing existing is changed: no membership, account, document, submission or invitation row is
-- created, moved or closed by this migration. Invitations that are ALREADY stale (the person is on
-- the team) are shown as "Already on your team" and can be closed by the admin, or in bulk with
-- supabase/release/0051_close_stale_invitations.sql after review.
--
-- Additive and re-runnable. Needs 0011, 0018, 0027. Independent of 0047–0050.

-- 1. The signed-in person's own open invitations.
create or replace function public.my_open_invitations()
returns table (id uuid, agency_name text, role text, expires_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select i.id, a.name, i.role, i.expires_at
    from public.agency_invitations i
    join public.agencies a on a.id = i.agency_id
    join auth.users u on u.id = auth.uid()
   where u.email_confirmed_at is not null
     and i.email = lower(btrim(u.email))
     and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     and not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.agency_id = i.agency_id)
   order by i.created_at desc
$$;
revoke all on function public.my_open_invitations() from public, anon;
grant execute on function public.my_open_invitations() to authenticated;

-- 2. Accept one of them in the app — exactly the link's rules (accept_agency_invitation does every check).
create or replace function public.accept_my_invitation(p_invitation_id uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_token text;
begin
  if auth.uid() is null then raise exception 'Sign in to accept this invitation'; end if;
  select i.token into v_token
    from public.agency_invitations i
    join auth.users u on u.id = auth.uid()
   where i.id = p_invitation_id and i.email = lower(btrim(u.email));
  if v_token is null then raise exception 'This invitation isn''t for your account'; end if;
  return public.accept_agency_invitation(v_token);
end;
$$;
revoke all on function public.accept_my_invitation(uuid) from public, anon;
grant execute on function public.accept_my_invitation(uuid) to authenticated;

-- 3. Becoming a member (any route) closes that agency's open invitation for the person's email.
create or replace function public.profiles_close_invitation() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.agency_invitations i
     set accepted_at = now(), accepted_by = new.user_id
    from auth.users u
   where u.id = new.user_id
     and i.agency_id = new.agency_id
     and i.email = lower(btrim(u.email))
     and i.accepted_at is null and i.revoked_at is null;
  return null;
end;
$$;
revoke all on function public.profiles_close_invitation() from public, anon, authenticated;
drop trigger if exists profiles_close_invitation on public.profiles;
create trigger profiles_close_invitation after insert on public.profiles
  for each row execute function public.profiles_close_invitation();

-- 4. The admin's view of the agency's open invitations, with an accurate status.
create or replace function public.list_agency_invitations()
returns table (id uuid, email text, role text, token text, created_at timestamptz, expires_at timestamptz, status text)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.email, i.role, i.token, i.created_at, i.expires_at,
         case when exists (select 1 from public.profiles p join auth.users u on u.id = p.user_id
                            where p.agency_id = i.agency_id and (lower(p.email) = i.email or lower(u.email) = i.email))
                then 'already_member'
              when i.expires_at < now() then 'expired'
              else 'waiting' end
    from public.agency_invitations i
   where public.is_agency_admin() and i.agency_id = public.current_agency_id()
     and i.accepted_at is null and i.revoked_at is null
   order by i.created_at desc
$$;
revoke all on function public.list_agency_invitations() from public, anon;
grant execute on function public.list_agency_invitations() to authenticated;

-- 5. create_agency_invitation (0018) — unchanged except "already on your team" also matches login email.
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
  if exists (select 1 from public.profiles p join auth.users u on u.id = p.user_id
              where p.agency_id = v_agency and (lower(p.email) = v_email or lower(u.email) = v_email)) then
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
revoke all on function public.create_agency_invitation(text, text) from public, anon;
grant execute on function public.create_agency_invitation(text, text) to authenticated;

-- 6. No new agency for someone with an open invitation (self-service agency creation runs as the
--    signed-in user; the SQL editor and service role are unaffected).
create or replace function public.agencies_refuse_if_invited() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_agency text;
begin
  if auth.uid() is null then return new; end if;
  select a.name into v_agency
    from public.agency_invitations i
    join public.agencies a on a.id = i.agency_id
    join auth.users u on u.id = auth.uid()
   where i.email = lower(btrim(u.email)) and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
   order by i.created_at desc limit 1;
  if v_agency is not null then
    raise exception 'You''ve been invited to join % — accept that invitation instead (or ask its admin to cancel it).', v_agency using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.agencies_refuse_if_invited() from public, anon, authenticated;
drop trigger if exists agencies_refuse_if_invited on public.agencies;
create trigger agencies_refuse_if_invited before insert on public.agencies
  for each row execute function public.agencies_refuse_if_invited();
