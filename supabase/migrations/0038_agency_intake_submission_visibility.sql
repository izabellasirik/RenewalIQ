-- New client submissions are visible to the agency's admins, not only to the broker whose link it was.
--
-- Until now an intake submission (and its files and history) could be read only by the owner of the
-- link it came through. An agency admin now sees — and can import or dismiss — every submission that
-- came through a link of a member of their own agency, the same rule 0036 uses for the links
-- themselves (can_manage_intake_link). Agents are unchanged: only their own. Nobody in another agency
-- sees anything. Document-request uploads already follow the account's own access rules (0030).
--
-- Additive; safe to run more than once. Must run after 0036.

drop policy if exists "agency admins read agency intake submissions" on public.intake_submissions;
create policy "agency admins read agency intake submissions" on public.intake_submissions for select to authenticated
  using (user_id <> auth.uid() and public.can_manage_intake_link(user_id));

drop policy if exists "agency admins update agency intake submissions" on public.intake_submissions;
create policy "agency admins update agency intake submissions" on public.intake_submissions for update to authenticated
  using (user_id <> auth.uid() and public.can_manage_intake_link(user_id))
  with check (public.can_manage_intake_link(user_id));

-- The submission always stays with the broker whose link it came through.
create or replace function public.intake_submissions_owner_fixed() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id or new.intake_link_id is distinct from old.intake_link_id then
    raise exception 'A submission can''t be moved to another link or broker.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists intake_submissions_owner_fixed on public.intake_submissions;
create trigger intake_submissions_owner_fixed before update on public.intake_submissions
  for each row execute function public.intake_submissions_owner_fixed();

drop policy if exists "agency admins read agency intake documents" on public.intake_documents;
create policy "agency admins read agency intake documents" on public.intake_documents for select to authenticated
  using (user_id <> auth.uid() and public.can_manage_intake_link(user_id));

drop policy if exists "agency admins read agency intake events" on public.intake_events;
create policy "agency admins read agency intake events" on public.intake_events for select to authenticated
  using (exists (select 1 from public.intake_submissions s where s.id = intake_submission_id and public.can_manage_intake_link(s.user_id)));

-- The uploaded files themselves: <submission id>/<…> in the private intake-uploads bucket.
create or replace function public.intake_file_readable_by_admin(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.intake_submissions s
     where s.id = (storage.foldername(p_name))[1] and s.user_id <> auth.uid() and public.can_manage_intake_link(s.user_id)
  )
$$;
revoke all on function public.intake_file_readable_by_admin(text) from public, anon;
grant execute on function public.intake_file_readable_by_admin(text) to authenticated;

drop policy if exists "agency admins read agency intake files" on storage.objects;
create policy "agency admins read agency intake files" on storage.objects for select to authenticated
  using (bucket_id = 'intake-uploads' and public.intake_file_readable_by_admin(name));
