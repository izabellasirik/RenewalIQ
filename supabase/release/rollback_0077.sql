-- Rollback of 0077: a full cancellation goes back to refunding everything left (0076). Removes the refund
-- preview and the pro-rata helpers, then re-run 0076's cancel_policy_commission after this. Cancellations
-- already recorded keep their amounts.
begin;
drop function if exists public.cancellation_refund_preview(uuid, date);
drop function if exists public.finance_fully_cancelled(public.commission_transactions);
drop function if exists public.finance_pro_rata_refund(uuid, date);
drop function if exists public.finance_unused_cents(bigint, date, date, date);
drop function if exists public.finance_policy_term(public.commission_transactions);
drop function if exists public.finance_entry_start(public.commission_transactions);
drop function if exists public.finance_entry_now(public.commission_transactions);
commit;
notify pgrst, 'reload schema';
