-- Rollback of 0076: removes undo and the cancellations list, and puts back 0075's cancel function (re-run
-- 0075's cancel_policy_commission after this). Undo columns and already-undone (voided) records are kept.
begin;
drop function if exists public.undo_policy_cancellation(uuid, text);
drop function if exists public.decline_cancellation_undo(uuid);
drop function if exists public.policy_cancellations(text);
drop function if exists public.finance_same_week(timestamptz);
commit;
