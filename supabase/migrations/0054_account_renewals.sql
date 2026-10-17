-- Renewal tracking on the account: whether the client came in as a new venture or a renewal, and the
-- renewals being tracked for it (one per policy term — see src/services/workflow/renewals.ts).
--
-- The account's main renewal date is NOT stored here: it stays the Risk Profile's Renewal / effective
-- date. A renewal for another policy (another line or carrier renewing on another date) carries its
-- own date inside `renewals`. A renewal is closed only by a market bound for it.
--
-- Two columns on submissions, like account_notes (0020) and loss_runs (0025): they follow the
-- account's existing agency permissions with no new policies. Accounts from before keep business_type
-- null and renewals empty, and their renewal reminder works exactly as before.
--
-- Additive; safe to run more than once. The app saves without these columns until it's applied.

alter table public.submissions add column if not exists business_type text;
alter table public.submissions drop constraint if exists submissions_business_type_check;
alter table public.submissions add constraint submissions_business_type_check check (business_type is null or business_type in ('new_venture', 'renewal'));

alter table public.submissions add column if not exists renewals jsonb not null default '[]'::jsonb;
alter table public.submissions drop constraint if exists submissions_renewals_array;
alter table public.submissions add constraint submissions_renewals_array check (jsonb_typeof(renewals) = 'array');

notify pgrst, 'reload schema';
