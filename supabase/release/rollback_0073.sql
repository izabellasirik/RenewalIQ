-- Rollback of 0073 (carrier % per policy). Run in one transaction:
--   1. this file's statements below, then
--   2. supabase/migrations/0067_agent_commission_from_carrier.sql again (re-runnable): it restores 0067's
--      guard and recording function, so new records use the carrier's rate again.
-- Kept on purpose: the policy_carrier_commission table (the % entered so far) and the widened
-- carrier_rate_source check, because records already made with 'policy_rate' must stay valid.
-- No commission record is changed by the rollback.
drop function if exists public.enter_policy_carrier_rate(text, text, numeric);
