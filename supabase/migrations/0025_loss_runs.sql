-- Loss runs as structured records: each loss-run report the account has (insurance carrier, policy
-- number, report date, coverage period, claim count and totals). The individual claims stay in the
-- `losses` table and point at their report through losses.details.lossRunId (0024).
--
-- One jsonb column on submissions, like account_notes (0020): it follows the account's existing
-- agency permissions with no new policies. The report date is what the 14-day freshness check reads.
--
-- Additive; safe to run more than once. Must run after 0003.

alter table public.submissions add column if not exists loss_runs jsonb not null default '[]'::jsonb;

alter table public.submissions drop constraint if exists submissions_loss_runs_array;
alter table public.submissions add constraint submissions_loss_runs_array check (jsonb_typeof(loss_runs) = 'array');
