-- ROLLBACK 0051 — back to invitations as before 0051 (0018). The app falls back by itself (no
-- in-app join prompt, Team page without statuses). Memberships, accounts and invitations that were
-- accepted or closed meanwhile stay as they are.
begin;
drop trigger if exists profiles_close_invitation on public.profiles;
drop function if exists public.profiles_close_invitation();
drop trigger if exists agencies_refuse_if_invited on public.agencies;
drop function if exists public.agencies_refuse_if_invited();
drop function if exists public.list_agency_invitations();
drop function if exists public.accept_my_invitation(uuid);
drop function if exists public.my_open_invitations();
-- 0018's create_agency_invitation.
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
revoke all on function public.create_agency_invitation(text, text) from public, anon;
grant execute on function public.create_agency_invitation(text, text) to authenticated;
select 'rolled back 0051: in-app invitations present=' || (to_regprocedure('public.my_open_invitations()') is not null) as result;
commit;
