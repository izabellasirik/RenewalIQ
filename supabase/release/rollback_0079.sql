-- Rollback of 0079: deleting a policy goes back to only flagging its record ("Removed from the account").
-- Records already taken out of the totals stay voided / balanced (the history is kept either way).
begin;
drop trigger if exists finance_sync_zremoved on public.submissions;
drop function if exists public.finance_sync_removed();
drop function if exists public.finance_remove_entry(public.commission_transactions, text);
commit;
notify pgrst, 'reload schema';
