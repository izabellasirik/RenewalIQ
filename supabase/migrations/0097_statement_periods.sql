-- 0097 Imported statements: an income or expense entry can say which dates it covers ("November 16–22").
-- A carrier commission or agent commission entry imported from a statement then counts INSTEAD of the
-- amounts worked out from the policies on those dates (the app shows those as replaced), so nothing is
-- counted twice. Both empty = an ordinary entry, as before. Re-runnable.

alter table public.agency_money_entries add column if not exists covers_from date;
alter table public.agency_money_entries add column if not exists covers_to date;
alter table public.agency_money_entries drop constraint if exists agency_money_entries_covers_check;
alter table public.agency_money_entries add constraint agency_money_entries_covers_check
  check ((covers_from is null and covers_to is null) or (covers_from is not null and covers_to is not null and covers_from <= covers_to and covers_to - covers_from <= 366));

notify pgrst, 'reload schema';
