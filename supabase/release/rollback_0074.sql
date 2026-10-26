-- Rollback of 0074. Removes the read and check functions and restores 0073's enter_policy_carrier_rate
-- (run 0073's create-or-replace of that function after this, or simply leave it: the 0074 version only
-- additionally clears the check). The reviewed_* columns are kept (harmless).
begin;
drop function if exists public.policy_carrier_rates(text);
drop function if exists public.review_policy_carrier_rate(text, text, boolean);
commit;
