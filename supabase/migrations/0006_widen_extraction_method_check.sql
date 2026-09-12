-- Fixes a live schema-vs-frontend drift discovered while diagnosing "Failed to save to your
-- account" in production: the frontend's ExtractionMethod union (src/types/common.ts) grew two
-- values — 'vision_extraction' (Claude-vision image extraction, see
-- services/ingestion/visionExtraction.ts) and 'applicant_provided' (Submission Intake, migration
-- 0004) — after 0003_broker_workspaces.sql was written, but 0003's CHECK constraints on
-- field_values.extraction_method and field_alternates.extraction_method were never updated to
-- match. Any field whose value came from either of those two paths fails to insert into
-- field_values/field_alternates with a check-constraint violation (Postgres error code 23514),
-- which surfaced in the app as a generic "Failed to save to your account" — see
-- src/services/supabase/submissionsRepo.ts's logAndFail for the accompanying fix that makes a
-- failure like this show its actual code/message/details/hint instead of only that generic string.
--
-- This does not touch RLS, table structure, or any other constraint — purely widens the two
-- allowed-value lists to match what the frontend has actually been sending. Safe to run against a
-- live project with existing data: every row already in these tables satisfies the OLD (narrower)
-- list, which is a subset of the new one.
--
-- Constraint names are looked up dynamically (rather than hard-coded to the name Postgres would
-- have auto-assigned an unnamed column-level CHECK) so this runs correctly regardless of exactly
-- how the live project ended up naming them.

do $$
declare
  r record;
begin
  for r in
    select con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname in ('field_values', 'field_alternates')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%extraction_method%'
  loop
    execute format('alter table %I drop constraint %I', r.relname, r.conname);
  end loop;
end $$;

alter table field_values
  add constraint field_values_extraction_method_check
  check (extraction_method is null or extraction_method in ('ai_extraction', 'deterministic_import', 'manual_entry', 'image_ocr', 'vision_extraction', 'applicant_provided'));

alter table field_alternates
  add constraint field_alternates_extraction_method_check
  check (extraction_method is null or extraction_method in ('ai_extraction', 'deterministic_import', 'manual_entry', 'image_ocr', 'vision_extraction', 'applicant_provided'));
