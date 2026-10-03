-- Team management for agency admins: change a member's role, and remove a member from the agency
-- without orphaning their accounts.
--
-- profiles still has NO insert/update/delete policy for app users (0011/0017) — these two
-- SECURITY DEFINER functions are the only way the app changes someone's role or membership, and
-- each re-checks everything itself:
--
-- set_agency_member_role(user, role)
--   * the caller must be an admin of an agency, and the person a member of that same agency;
--   * the agency always keeps at least one admin (demoting the last one is refused).
--
-- remove_agency_member(user, reassign_to)
--   * the caller must be an admin of the same agency, and can't remove themselves;
--   * every agency account assigned to the person is reassigned to reassign_to (required when
--     there are any; must be another member of the agency) — nothing is deleted or left without
--     an owner. Each moved account gets an Activity entry saying so;
--   * the person is taken off every agency account's collaborators (0026);
--   * then their profile row is removed, so they lose access to all of the agency's accounts at
--     once (RLS, 0011). Their login and any personal accounts of their own are untouched; they can
--     be invited back later.
--
-- Additive; safe to run more than once. Must run after 0011, 0014 and 0026.

create or replace function public.set_agency_member_role(p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_old text;
begin
  if auth.uid() is null or v_agency is null or not public.is_agency_admin() then
    raise exception 'Only an agency admin can change roles.' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('agent', 'admin') then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;
  -- Lock the agency's admins so two admins can't demote each other at the same moment.
  perform 1 from public.profiles where agency_id = v_agency and role = 'admin' for update;
  select role into v_old from public.profiles where user_id = p_user_id and agency_id = v_agency for update;
  if not found then
    raise exception 'That person is not a member of your agency.' using errcode = '42501';
  end if;
  if v_old = p_role then
    return;
  end if;
  if v_old = 'admin' and (select count(*) from public.profiles where agency_id = v_agency and role = 'admin') <= 1 then
    raise exception 'The agency needs at least one admin — make someone else an admin first.' using errcode = '42501';
  end if;
  update public.profiles set role = p_role where user_id = p_user_id and agency_id = v_agency;
end;
$$;

create or replace function public.remove_agency_member(p_user_id uuid, p_reassign_to uuid default null) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_actor text;
  v_removed text;
  v_new text;
  v_count integer;
begin
  if auth.uid() is null or v_agency is null or not public.is_agency_admin() then
    raise exception 'Only an agency admin can remove team members.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t remove yourself from the agency.' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(display_name), ''), email, 'a team member') into v_removed
    from public.profiles where user_id = p_user_id and agency_id = v_agency for update;
  if not found then
    raise exception 'That person is not a member of your agency.' using errcode = '42501';
  end if;

  select count(*) into v_count from public.submissions where organization_id = v_agency and assigned_user_id = p_user_id;
  if v_count > 0 then
    if p_reassign_to is null then
      raise exception 'Choose who takes over their % account(s) before removing them.', v_count using errcode = '22023';
    end if;
    if p_reassign_to = p_user_id then
      raise exception 'Their accounts must go to someone else.' using errcode = '22023';
    end if;
    select coalesce(nullif(btrim(display_name), ''), email, 'a team member') into v_new
      from public.profiles where user_id = p_reassign_to and agency_id = v_agency;
    if not found then
      raise exception 'The person taking over is not a member of your agency.' using errcode = '42501';
    end if;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), u.email) into v_actor
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = auth.uid();

  -- Activity first (it names the accounts being moved), then the move itself.
  insert into public.activity_events (id, submission_id, user_id, type, message, occurred_at, actor_name)
  select 'evt_' || replace(gen_random_uuid()::text, '-', ''), s.id, auth.uid(), 'broker_assigned',
         format('Reassigned from %s to %s — %s was removed from the agency by %s.', v_removed, v_new, v_removed, coalesce(v_actor, 'an admin')),
         now(), v_actor
    from public.submissions s
   where s.organization_id = v_agency and s.assigned_user_id = p_user_id;

  update public.submissions set assigned_user_id = p_reassign_to
   where organization_id = v_agency and assigned_user_id = p_user_id;

  update public.submissions set collaborator_ids = array_remove(collaborator_ids, p_user_id)
   where organization_id = v_agency and p_user_id = any (collaborator_ids);

  delete from public.profiles where user_id = p_user_id and agency_id = v_agency;
  return v_count;
end;
$$;

revoke all on function public.set_agency_member_role(uuid, text) from public, anon;
revoke all on function public.remove_agency_member(uuid, uuid) from public, anon;
grant execute on function public.set_agency_member_role(uuid, text) to authenticated;
grant execute on function public.remove_agency_member(uuid, uuid) to authenticated;
