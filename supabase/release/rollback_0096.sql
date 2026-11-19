-- Rollback of 0096: reading checks access row by row again (as 0011/0026).
begin;
do $$
declare
  t text;
begin
  foreach t in array array['field_values', 'coverage_lines', 'vehicles', 'drivers', 'losses', 'documents', 'activity_events'] loop
    execute format('drop policy if exists "account access: select %1$s" on public.%1$I', t);
    execute format('create policy "account access: select %1$s" on public.%1$I for select to authenticated using (public.can_access_submission(submission_id))', t);
  end loop;
end;
$$;
drop policy if exists "account access: select field_alternates" on public.field_alternates;
create policy "account access: select field_alternates" on public.field_alternates for select to authenticated using (public.can_access_field_value(field_value_id));
drop function if exists public.visible_submission_ids();
notify pgrst, 'reload schema';
commit;
