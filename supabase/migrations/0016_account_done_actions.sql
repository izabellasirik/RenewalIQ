-- Tasks a broker marked done on the Overview / Today's Plate. Tasks aren't stored — they're derived
-- from the account (a follow-up date, a renewal date, a market not yet submitted …) — so "done" is
-- recorded as { taskKey: doneAt } on the account. The key includes the task's date and wording, so
-- if something about it changes (a new date, a new renewal), it comes back as a new task.
-- Stored on `submissions` like the rest of the account workflow (0007/0009) and covered by the
-- existing agency RLS (0011) — no new policies.
--
-- Purely additive and safe to run more than once. Must run after 0003. Until it's applied, a task
-- marked done stays done in that browser only and the app says it couldn't be saved.

alter table public.submissions add column if not exists done_actions jsonb not null default '{}'::jsonb;

alter table public.submissions drop constraint if exists submissions_done_actions_is_object;
alter table public.submissions add constraint submissions_done_actions_is_object check (jsonb_typeof(done_actions) = 'object');
