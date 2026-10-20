-- Rollback for 0069: restores 0011's rules and 0047's self-service agency creation exactly (and 0029's intake policies).
create or replace function public.submission_visible(p_agency_id uuid, p_assigned_user_id uuid, p_creator_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    case
      when auth.uid() is null then false
      when p_agency_id is null then p_creator_id = auth.uid()
      else p_agency_id = public.current_agency_id() and (public.is_agency_admin() or p_assigned_user_id = auth.uid())
    end,
    false)
$$;

drop policy if exists "account access: read submission documents" on storage.objects;
create policy "account access: read submission documents" on storage.objects for select to authenticated
  using (
    bucket_id = 'submission-documents'
    and (
      public.can_access_submission((storage.foldername(name))[2])
      or ((storage.foldername(name))[1] = auth.uid()::text and not public.submission_exists((storage.foldername(name))[2]))
    )
  );

drop policy if exists "account access: upload submission documents" on storage.objects;
create policy "account access: upload submission documents" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'submission-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.can_access_submission((storage.foldername(name))[2]) or not public.submission_exists((storage.foldername(name))[2]))
  );

drop policy if exists "account access: delete submission documents" on storage.objects;
create policy "account access: delete submission documents" on storage.objects for delete to authenticated
  using (
    bucket_id = 'submission-documents'
    and (
      public.can_access_submission((storage.foldername(name))[2])
      or ((storage.foldername(name))[1] = auth.uid()::text and not public.submission_exists((storage.foldername(name))[2]))
    )
  );

drop policy if exists "owner can insert own intake links" on public.intake_links;
create policy "owner can insert own intake links" on public.intake_links for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "owner can update own intake links" on public.intake_links;
create policy "owner can update own intake links" on public.intake_links for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "owner can select own intake submissions" on public.intake_submissions;
create policy "owner can select own intake submissions" on public.intake_submissions for select to authenticated using (user_id = auth.uid());
drop policy if exists "owner can update own intake submissions" on public.intake_submissions;
create policy "owner can update own intake submissions" on public.intake_submissions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "owner can select own intake documents" on public.intake_documents;
create policy "owner can select own intake documents" on public.intake_documents for select to authenticated using (user_id = auth.uid());

do $$ begin
  if to_regprocedure('public.create_my_agency(text)') is not null then
    grant execute on function public.create_my_agency(text) to authenticated;
  end if;
end $$;
drop function if exists public.has_product_access();
