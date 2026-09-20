-- Adds Trailer Interchange and Non-Trucking Liability to the Coverage Requested options
-- (src/types/coverage.ts's CoverageType) per broker feedback that these two common trucking
-- coverages were missing from the public Submission Link's "Coverage requested" section. Existing
-- coverage types (auto_liability, motor_truck_cargo, physical_damage, general_liability,
-- warehouse_legal_liability) are preserved exactly as-is — this only widens the allowed-value list
-- on coverage_lines.coverage_type. Safe to run against a live project with existing coverage_lines
-- rows: every row already there satisfies the OLD (narrower) list, which is a subset of the new one.
--
-- Without this, a broker importing an intake submission that requested either new coverage type
-- would hit a check-constraint violation (Postgres error 23514) when the imported account is first
-- saved to the cloud — the intake_submissions.coverage_requested column itself has no such
-- constraint (it's a plain text[]), so the failure would only surface later, at import/save time.
--
-- Constraint name is looked up dynamically rather than hard-coded, since it runs correctly
-- regardless of exactly how the live project ended up naming the original unnamed CHECK.

do $$
declare
  r record;
begin
  for r in
    select con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'coverage_lines'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%coverage_type%'
  loop
    execute format('alter table %I drop constraint %I', r.relname, r.conname);
  end loop;
end $$;

alter table coverage_lines
  add constraint coverage_lines_type_check
  check (coverage_type in ('auto_liability', 'motor_truck_cargo', 'physical_damage', 'general_liability', 'warehouse_legal_liability', 'trailer_interchange', 'non_trucking_liability'));
