-- Rollback of 0084: no more recording payments to agents. The payments already recorded are kept (re-running
-- 0084 shows them again).
begin;
drop function if exists public.record_agent_payments(date, jsonb);
drop function if exists public.undo_agent_payment(uuid, text);
commit;
notify pgrst, 'reload schema';
