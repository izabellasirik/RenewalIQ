-- Primary assigned broker + collaborators, and in-app notifications for assignments.
--
-- COLLABORATORS (submissions.collaborator_ids)
--   Team members helping on an account besides its primary assigned broker (assigned_user_id,
--   unchanged). A collaborator can see and edit the account exactly like the assigned broker —
--   the one access rule (0011) gains that single case. They can't delete (0021 is unchanged) or
--   reassign (0011's trigger is unchanged).
--   Only an agency admin or the account's primary broker can change the collaborators, only on an
--   agency account, and only to members of that agency. The database enforces all of it.
--
-- ORIGINAL ASSIGNMENT (submissions.original_assigned_user_id)
--   Who the account was first assigned to — set once, never changed afterwards. The full history
--   of reassignments stays in Activity.
--
-- NOTIFICATIONS
--   Written only by the database (a trigger), whenever someone is made the primary broker of an
--   account or added as a collaborator by someone else — so a notification always reflects a real
--   change and can't be forged from the app. Each person reads and marks read only their own.
--   Email delivery is not part of this migration (see SUPABASE_SETUP.md).
--
-- Additive; safe to run more than once. Must run after 0011 (and 0021, whose delete rule stays).

alter table public.submissions add column if not exists collaborator_ids uuid[] not null default '{}';
alter table public.submissions add column if not exists original_assigned_user_id uuid references auth.users (id) on delete set null;

-- Existing accounts: their current assignee is the earliest one we know of.
update public.submissions set original_assigned_user_id = assigned_user_id
 where original_assigned_user_id is null and assigned_user_id is not null;

-- --------------------------------------------------------------------------------------------
-- Access: the 0011 rule, plus collaborators on an account of the caller's own agency.
-- --------------------------------------------------------------------------------------------
create or replace function public.submission_visible_with_collaborators(p_agency_id uuid, p_assigned_user_id uuid, p_creator_id uuid, p_collaborator_ids uuid[]) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.submission_visible(p_agency_id, p_assigned_user_id, p_creator_id)
      or coalesce(p_agency_id is not null and p_agency_id = public.current_agency_id() and auth.uid() = any (p_collaborator_ids), false)
$$;

create or replace function public.can_access_submission(p_submission_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.submissions s
    where s.id = p_submission_id and public.submission_visible_with_collaborators(s.organization_id, s.assigned_user_id, s.user_id, s.collaborator_ids)
  )
$$;

revoke execute on function public.submission_visible_with_collaborators(uuid, uuid, uuid, uuid[]) from public;
grant execute on function public.submission_visible_with_collaborators(uuid, uuid, uuid, uuid[]) to authenticated;

drop policy if exists "agency access: select submissions" on public.submissions;
create policy "agency access: select submissions" on public.submissions for select to authenticated
  using (public.submission_visible_with_collaborators(organization_id, assigned_user_id, user_id, collaborator_ids));
drop policy if exists "agency access: update submissions" on public.submissions;
create policy "agency access: update submissions" on public.submissions for update to authenticated
  using (public.submission_visible_with_collaborators(organization_id, assigned_user_id, user_id, collaborator_ids))
  with check (public.submission_visible_with_collaborators(organization_id, assigned_user_id, user_id, collaborator_ids));

-- --------------------------------------------------------------------------------------------
-- Who may change collaborators; original assignment is set once.
-- --------------------------------------------------------------------------------------------
create or replace function public.submissions_team_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    new.original_assigned_user_id := coalesce(new.original_assigned_user_id, new.assigned_user_id);
    if auth.uid() is not null then
      new.collaborator_ids := '{}'; -- collaborators are added to a saved account, not at creation
    end if;
    return new;
  end if;

  -- Set once: the first assignee we ever saw.
  new.original_assigned_user_id := coalesce(old.original_assigned_user_id, old.assigned_user_id, new.assigned_user_id);

  if auth.uid() is null then
    return new; -- SQL editor / service role
  end if;

  -- Normalize: unique, and never the primary broker too.
  select coalesce(array_agg(distinct x), '{}') into v_ids
    from unnest(coalesce(new.collaborator_ids, '{}')) as x
   where x is distinct from new.assigned_user_id;
  new.collaborator_ids := v_ids;

  if not (new.collaborator_ids <@ coalesce(old.collaborator_ids, '{}') and coalesce(old.collaborator_ids, '{}') <@ new.collaborator_ids) then
    if old.organization_id is null then
      raise exception 'Collaborators can only be added to an agency account.' using errcode = '42501';
    end if;
    if not (public.is_agency_admin() or old.assigned_user_id = auth.uid()) then
      raise exception 'Only an agency admin or the assigned broker can change collaborators.' using errcode = '42501';
    end if;
    if exists (
      select 1 from unnest(new.collaborator_ids) as c(uid)
       where not exists (select 1 from public.profiles p where p.user_id = c.uid and p.agency_id = old.organization_id)
    ) then
      raise exception 'A collaborator must be a member of this agency.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_team_guard on public.submissions;
create trigger submissions_team_guard before insert or update on public.submissions
  for each row execute function public.submissions_team_guard();

-- --------------------------------------------------------------------------------------------
-- Notifications
-- --------------------------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  submission_id text references public.submissions (id) on delete cascade,
  message text not null,
  actor_name text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_type_check check (type in ('assigned', 'collaborator_added'))
);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "mark own notifications read" on public.notifications;
create policy "mark own notifications read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Rows are created only by the trigger below (no insert policy); the app can change only read_at.
revoke insert, delete on public.notifications from authenticated;
grant select, update on public.notifications to authenticated;

create or replace function public.notifications_read_only_fields() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Everything but read_at stays as the database wrote it.
  new.id := old.id;
  new.user_id := old.user_id;
  new.type := old.type;
  new.submission_id := old.submission_id;
  new.message := old.message;
  new.actor_name := old.actor_name;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists notifications_read_only_fields on public.notifications;
create trigger notifications_read_only_fields before update on public.notifications
  for each row execute function public.notifications_read_only_fields();

create or replace function public.submissions_notify_team() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor text;
  v_name text := coalesce(nullif(btrim(new.named_insured), ''), 'an account');
  v_uid uuid;
begin
  select coalesce(nullif(btrim(p.display_name), ''), u.email) into v_actor
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = auth.uid();

  if new.assigned_user_id is not null
     and new.assigned_user_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assigned_user_id is distinct from old.assigned_user_id) then
    insert into public.notifications (user_id, type, submission_id, message, actor_name)
    values (new.assigned_user_id, 'assigned', new.id, format('You were assigned to %s', v_name), v_actor);
  end if;

  if tg_op = 'UPDATE' then
    for v_uid in select unnest(new.collaborator_ids) except select unnest(coalesce(old.collaborator_ids, '{}')) loop
      if v_uid is distinct from auth.uid() then
        insert into public.notifications (user_id, type, submission_id, message, actor_name)
        values (v_uid, 'collaborator_added', new.id, format('You were added as a collaborator on %s', v_name), v_actor);
      end if;
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists submissions_notify_team on public.submissions;
create trigger submissions_notify_team after insert or update of assigned_user_id, collaborator_ids on public.submissions
  for each row execute function public.submissions_notify_team();

-- --------------------------------------------------------------------------------------------
-- Teammates' names, for every member (0011 lets an agent read only their own profile — fine for
-- privacy, but a primary broker who is an agent needs to pick collaborators and everyone needs to
-- see who is on an account). Returns only id, name and role of the caller's own agency.
-- --------------------------------------------------------------------------------------------
create or replace function public.agency_member_names()
returns table (user_id uuid, name text, role text)
language sql stable security definer set search_path = ''
as $$
  select p.user_id, coalesce(nullif(btrim(p.display_name), ''), p.email, 'Team member'), p.role
    from public.profiles p
   where p.agency_id = public.current_agency_id() and auth.uid() is not null
   order by 2
$$;

revoke all on function public.agency_member_names() from public, anon;
grant execute on function public.agency_member_names() to authenticated;
