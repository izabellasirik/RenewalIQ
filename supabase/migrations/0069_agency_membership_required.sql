-- 0069: RenewalIQ is invitation-only. A signed-in person who isn't a member of an agency (and isn't
-- the founder) can't read or create anything until they join through an invitation (0018 link or
-- 0051 accept_my_invitation). Enforced in the database, not only by the app's Join screen.
--
--   * has_product_access(): agency member (a profile row) or the founder (0043).
--   * Personal accounts (no agency) are visible only to their creator AND only while the creator has
--     product access. Members keep their personal accounts; non-members see none until they join.
--     Every account-scoped table (documents, drivers, field values, …) follows through
--     can_access_submission → submission_visible.
--   * Document storage: the "own folder, not yet linked to an account" path needs product access too.
--   * Client intake links: creating/updating them and reading their submissions needs product access.
--   * Self-service agency creation (0047 create_my_agency) is turned off for signed-in users;
--     new agencies are set up by RenewalIQ (SQL editor / service role are unaffected).
--
-- Nothing existing is moved or deleted. Existing members and their access are unchanged.
-- Needs 0011, 0029, 0043, 0051 (0047 optional). Re-runnable. Rollback: supabase/release/rollback_0069.sql.

create or replace function public.has_product_access() returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
     and (exists (select 1 from public.profiles p where p.user_id = auth.uid()) or public.is_founder())
$$;
revoke all on function public.has_product_access() from public, anon;
grant execute on function public.has_product_access() to authenticated;

-- 0011's rule, with the personal-account branch gated on product access.
create or replace function public.submission_visible(p_agency_id uuid, p_assigned_user_id uuid, p_creator_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    case
      when auth.uid() is null then false
      when p_agency_id is null then p_creator_id = auth.uid() and public.has_product_access()
      else p_agency_id = public.current_agency_id() and (public.is_agency_admin() or p_assigned_user_id = auth.uid())
    end,
    false)
$$;

-- 0011's document policies; only the "own folder, no account yet" branch gains has_product_access().
drop policy if exists "account access: read submission documents" on storage.objects;
create policy "account access: read submission documents" on storage.objects for select to authenticated
  using (
    bucket_id = 'submission-documents'
    and (
      public.can_access_submission((storage.foldername(name))[2])
      or ((storage.foldername(name))[1] = auth.uid()::text and not public.submission_exists((storage.foldername(name))[2]) and public.has_product_access())
    )
  );

drop policy if exists "account access: upload submission documents" on storage.objects;
create policy "account access: upload submission documents" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'submission-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.can_access_submission((storage.foldername(name))[2]) or (not public.submission_exists((storage.foldername(name))[2]) and public.has_product_access()))
  );

drop policy if exists "account access: delete submission documents" on storage.objects;
create policy "account access: delete submission documents" on storage.objects for delete to authenticated
  using (
    bucket_id = 'submission-documents'
    and (
      public.can_access_submission((storage.foldername(name))[2])
      or ((storage.foldername(name))[1] = auth.uid()::text and not public.submission_exists((storage.foldername(name))[2]) and public.has_product_access())
    )
  );

-- Client intake links (0029/0036): creating or changing one, and reading what arrives through
-- one's own links, needs product access too.
drop policy if exists "owner can insert own intake links" on public.intake_links;
create policy "owner can insert own intake links" on public.intake_links for insert to authenticated
  with check (user_id = auth.uid() and public.has_product_access());
drop policy if exists "owner can update own intake links" on public.intake_links;
create policy "owner can update own intake links" on public.intake_links for update to authenticated
  using (user_id = auth.uid() and public.has_product_access()) with check (user_id = auth.uid() and public.has_product_access());
drop policy if exists "owner can select own intake submissions" on public.intake_submissions;
create policy "owner can select own intake submissions" on public.intake_submissions for select to authenticated
  using (user_id = auth.uid() and public.has_product_access());
drop policy if exists "owner can update own intake submissions" on public.intake_submissions;
create policy "owner can update own intake submissions" on public.intake_submissions for update to authenticated
  using (user_id = auth.uid() and public.has_product_access()) with check (user_id = auth.uid() and public.has_product_access());
drop policy if exists "owner can select own intake documents" on public.intake_documents;
create policy "owner can select own intake documents" on public.intake_documents for select to authenticated
  using (user_id = auth.uid() and public.has_product_access());

-- No self-service agencies (0047, where installed): joining is by invitation only.
do $$ begin
  if to_regprocedure('public.create_my_agency(text)') is not null then
    revoke execute on function public.create_my_agency(text) from authenticated;
  end if;
end $$;
