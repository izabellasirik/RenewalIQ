-- Saving an account's Risk Profile rows in ONE transaction.
--
-- Until now the app saved an account's fields, coverage lines, vehicles, drivers and losses by
-- deleting them all and inserting the current set, as separate requests. If anything interrupted
-- the save between the delete and the insert — the tab closed, the connection dropped, an insert
-- was refused — the account's drivers/vehicles/losses/fields were left deleted in the database.
--
-- replace_submission_children() does the same delete + insert inside a single transaction, so a
-- save either lands completely or changes nothing. It is SECURITY INVOKER: every row-level-security
-- policy on these tables applies exactly as it does to the app's direct requests (who can see,
-- edit, insert and delete an account's rows is unchanged). The app uses it when it exists and
-- falls back to the old requests until this migration is applied.
--
-- Additive; safe to run more than once. Must run after 0010 and 0024.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drivers' and column_name = 'details') then
    raise exception 'Run 0024_record_details.sql before 0028_atomic_account_save.sql.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drivers' and column_name = 'experience_months') then
    raise exception 'Run 0010_driver_experience_months.sql before 0028_atomic_account_save.sql.';
  end if;
end $$;

-- Inserts a JSON array of rows into one of the account's child tables. Only the columns present
-- in the rows are written, so every other column keeps its default (created_at, …); a row missing
-- a NOT NULL column that has a default gets that default.
create or replace function public.insert_submission_rows(p_table text, p_rows jsonb) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_cols text;
  v_vals text;
begin
  if p_table not in ('field_values', 'field_alternates', 'coverage_lines', 'vehicles', 'drivers', 'losses') then
    raise exception 'Unsupported table %', p_table using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return;
  end if;
  -- A row that leaves a column out (or sends null for a NOT NULL column) gets the column's default.
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg(case when c.column_default is not null and c.is_nullable = 'NO'
                         then format('coalesce(r.%I, %s)', c.column_name, c.column_default)
                         else format('r.%I', c.column_name) end, ', ' order by c.ordinal_position)
    into v_cols, v_vals
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table
     and exists (select 1 from jsonb_array_elements(p_rows) e where e ? c.column_name);
  if v_cols is null then
    return;
  end if;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) r', p_table, v_cols, v_vals, p_table) using p_rows;
end;
$$;

create or replace function public.replace_submission_children(
  p_submission_id text,
  p_field_values jsonb,
  p_field_alternates jsonb,
  p_coverage_lines jsonb,
  p_vehicles jsonb,
  p_drivers jsonb,
  p_losses jsonb
) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.can_access_submission(p_submission_id) then
    raise exception 'You don''t have access to this account.' using errcode = '42501';
  end if;
  -- Every row must belong to this account (alternates to one of its field values).
  if exists (
    select 1 from (
      select e->>'submission_id' as sid from jsonb_array_elements(coalesce(p_field_values, '[]')) e
      union all select e->>'submission_id' from jsonb_array_elements(coalesce(p_coverage_lines, '[]')) e
      union all select e->>'submission_id' from jsonb_array_elements(coalesce(p_vehicles, '[]')) e
      union all select e->>'submission_id' from jsonb_array_elements(coalesce(p_drivers, '[]')) e
      union all select e->>'submission_id' from jsonb_array_elements(coalesce(p_losses, '[]')) e
    ) r where r.sid is distinct from p_submission_id
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_field_alternates, '[]')) a
     where not exists (select 1 from jsonb_array_elements(coalesce(p_field_values, '[]')) v where v->>'id' = a->>'field_value_id')
  ) then
    raise exception 'Every row must belong to account %.', p_submission_id using errcode = '22023';
  end if;

  delete from public.field_values where submission_id = p_submission_id; -- alternates go with them (on delete cascade)
  delete from public.coverage_lines where submission_id = p_submission_id;
  delete from public.vehicles where submission_id = p_submission_id;
  delete from public.drivers where submission_id = p_submission_id;
  delete from public.losses where submission_id = p_submission_id;

  perform public.insert_submission_rows('field_values', p_field_values);
  perform public.insert_submission_rows('field_alternates', p_field_alternates);
  perform public.insert_submission_rows('coverage_lines', p_coverage_lines);
  perform public.insert_submission_rows('vehicles', p_vehicles);
  perform public.insert_submission_rows('drivers', p_drivers);
  perform public.insert_submission_rows('losses', p_losses);
end;
$$;

revoke all on function public.insert_submission_rows(text, jsonb) from public, anon;
revoke all on function public.replace_submission_children(text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.insert_submission_rows(text, jsonb) to authenticated;
grant execute on function public.replace_submission_children(text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
