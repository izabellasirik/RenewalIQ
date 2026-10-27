-- Rollback of 0075. Agents go back to requesting cancellations (admins approve). Cancellations already made
-- stay as recorded (with their negative commission records), and so does their review table.
begin;
drop function if exists public.cancel_policy_commission(uuid, text, date, text, bigint, text[]);
drop function if exists public.agent_cancellation_reviews();
drop function if exists public.review_agent_cancellation(uuid, boolean);
commit;
