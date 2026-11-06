-- Rollback of 0092: removes receipts from income and expenses (the list of files on each entry, and
-- access to the files). The files themselves stay in the agency-receipts bucket until deleted there.
begin;
drop policy if exists agency_receipts_select on storage.objects;
drop policy if exists agency_receipts_insert on storage.objects;
drop policy if exists agency_receipts_delete on storage.objects;
alter table public.agency_money_entries drop constraint if exists agency_money_entries_receipts_ok;
alter table public.agency_money_entries drop column if exists receipts;
drop function if exists public.money_receipts_ok(jsonb, uuid);
notify pgrst, 'reload schema';
commit;
