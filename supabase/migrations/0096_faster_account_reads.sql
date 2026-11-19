-- 0096 Faster account loading. Reading an account's rows (fields, vehicles, drivers, losses, documents,
-- coverage, activity) checked "may this user see this account?" once PER ROW — 10,000+ separate checks
-- for activity alone, about 7 seconds, close to the database's 8-second limit. Now the accounts the user
-- may see are worked out once per read, and each row is matched against that list.
--
-- The rule itself is unchanged: the same visibility function (submission_visible_with_collaborators)
-- decides, for the same accounts. Only reading (SELECT) changes; adding, changing and deleting rows keep
-- their per-row checks. Re-runnable.

create or replace function public.visible_submission_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.submissions s
  where public.submission_visible_with_collaborators(s.organization_id, s.assigned_user_id, s.user_id, s.collaborator_ids)
$$;
revoke execute on function public.visible_submission_ids() from public, anon;
grant execute on function public.visible_submission_ids() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['field_values', 'coverage_lines', 'vehicles', 'drivers', 'losses', 'documents', 'activity_events'] loop
    execute format('drop policy if exists "account access: select %1$s" on public.%1$I', t);
    execute format('create policy "account access: select %1$s" on public.%1$I for select to authenticated using (submission_id in (select public.visible_submission_ids()))', t);
  end loop;
end;
$$;

-- field_alternates hang off field_values (no submission_id of their own).
drop policy if exists "account access: select field_alternates" on public.field_alternates;
create policy "account access: select field_alternates" on public.field_alternates for select to authenticated
  using (field_value_id in (select f.id from public.field_values f where f.submission_id in (select public.visible_submission_ids())));

notify pgrst, 'reload schema';
