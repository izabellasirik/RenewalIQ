-- Lets the database accept every "how was this field filled in" value the app writes
-- (src/types/common.ts ExtractionMethod). 0003 only allowed ai_extraction / deterministic_import /
-- manual_entry / image_ocr, so saving a field read from a photo ('vision_extraction') or filled in
-- by a client on a submission link ('applicant_provided') was rejected (check-constraint error
-- 23514) and the account showed "Failed to save to your account".
--
-- Same change as eloquent-planck's 0006_widen_extraction_method_check.sql, added here under its own
-- number. If that file was already run on your project, running this one is harmless: it drops
-- and re-creates the same two constraints with the same allowed values.
--
-- Only widens the allowed list — every existing row already satisfies it. No RLS, table, or data
-- changes. Safe to run more than once. Must run after 0003. Constraint names are looked up rather
-- than assumed, so it works however the project ended up naming them.

do $$
declare
  r record;
begin
  for r in
    select con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname in ('field_values', 'field_alternates')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%extraction_method%'
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
  end loop;
end $$;

alter table public.field_values
  add constraint field_values_extraction_method_check
  check (extraction_method is null or extraction_method in ('ai_extraction', 'deterministic_import', 'manual_entry', 'image_ocr', 'vision_extraction', 'applicant_provided'));

alter table public.field_alternates
  add constraint field_alternates_extraction_method_check
  check (extraction_method is null or extraction_method in ('ai_extraction', 'deterministic_import', 'manual_entry', 'image_ocr', 'vision_extraction', 'applicant_provided'));
