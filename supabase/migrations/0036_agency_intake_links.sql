-- Submission Intake: an agency admin sees (and can delete or pause) every intake link in the agency.
--
-- Until now each broker saw only their own links, and only the link's creator could change or
-- delete it. An agency admin now sees the links of every member of their agency — with whose link
-- it is and how many submissions came through it — and can deactivate, reactivate or delete them.
-- Agents still see and manage only their own. Everything goes through these functions, which check
-- the caller server-side; the table policies are unchanged.
--
-- Deleting a link would also delete (ON DELETE CASCADE) every submission received through it, so a
-- link with submissions nobody has imported or dismissed yet can't be deleted — deactivate it, or
-- deal with those first. Imported submissions' files were already copied into the account.
--
-- Additive; safe to run more than once. Must run after 0029 (and 0011/0013).

-- Who may manage a link: its creator, or an admin of the creator's agency.
create or replace function public.can_manage_intake_link(p_owner uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    p_owner = auth.uid()
    or (public.is_agency_admin() and exists (select 1 from public.profiles p where p.user_id = p_owner and p.agency_id = public.current_agency_id()))
  )
$$;
revoke all on function public.can_manage_intake_link(uuid) from public, anon;
grant execute on function public.can_manage_intake_link(uuid) to authenticated;

-- The links the caller manages: their own, and — for an agency admin — every member's.
create or replace function public.list_manageable_intake_links()
returns table (id text, user_id uuid, owner_name text, label text, organization_name text, token text, active boolean, created_at timestamptz, open_submissions integer, total_submissions integer)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.user_id,
         coalesce(nullif(btrim(p.display_name), ''), p.email, 'A former member'),
         l.label, l.organization_name, l.token, l.active, l.created_at,
         (select count(*)::int from public.intake_submissions s where s.intake_link_id = l.id and s.status in ('uploading', 'pending', 'incomplete')),
         (select count(*)::int from public.intake_submissions s where s.intake_link_id = l.id)
    from public.intake_links l
    left join public.profiles p on p.user_id = l.user_id
   where public.can_manage_intake_link(l.user_id)
   order by l.created_at desc
$$;
revoke all on function public.list_manageable_intake_links() from public, anon;
grant execute on function public.list_manageable_intake_links() to authenticated;

create or replace function public.set_intake_link_active(p_id text, p_active boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.intake_links;
begin
  select * into l from public.intake_links where id = p_id for update;
  if not found or not public.can_manage_intake_link(l.user_id) then
    raise exception 'You can''t change this link.' using errcode = '42501';
  end if;
  update public.intake_links set active = p_active where id = p_id;
end;
$$;
revoke all on function public.set_intake_link_active(text, boolean) from public, anon;
grant execute on function public.set_intake_link_active(text, boolean) to authenticated;

create or replace function public.delete_intake_link(p_id text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.intake_links;
  v_open integer;
begin
  select * into l from public.intake_links where id = p_id for update;
  if not found then
    return; -- already gone (a retry)
  end if;
  if not public.can_manage_intake_link(l.user_id) then
    raise exception 'You can''t delete this link.' using errcode = '42501';
  end if;
  select count(*) into v_open from public.intake_submissions where intake_link_id = p_id and status in ('uploading', 'pending', 'incomplete');
  if v_open > 0 then
    raise exception '% submission% from this link % not been imported or dismissed yet — deal with % first, or deactivate the link instead.',
      v_open, case when v_open = 1 then '' else 's' end, case when v_open = 1 then 'has' else 'have' end, case when v_open = 1 then 'it' else 'them' end
      using errcode = '23503';
  end if;
  delete from public.intake_links where id = p_id;
end;
$$;
revoke all on function public.delete_intake_link(text) from public, anon;
grant execute on function public.delete_intake_link(text) to authenticated;
