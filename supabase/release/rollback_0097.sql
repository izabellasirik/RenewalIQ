-- Rollback of 0097: entries no longer say which dates they cover (imported commission adds up again).
begin;
alter table public.agency_money_entries drop constraint if exists agency_money_entries_covers_check;
alter table public.agency_money_entries drop column if exists covers_to;
alter table public.agency_money_entries drop column if exists covers_from;
notify pgrst, 'reload schema';
commit;
