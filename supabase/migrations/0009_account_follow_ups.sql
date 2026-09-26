-- Manually scheduled follow-ups per account (src/types/workflow.ts FollowUp): who to follow up
-- with, when, and optional notes — shown on Today's Plate on their date. Stored as jsonb on
-- `submissions` like the rest of the account workflow (0007), covered by the existing owner-only
-- RLS — no new policies.
--
-- Purely additive and safe to run more than once. Must run after 0003.

alter table submissions add column if not exists follow_ups jsonb not null default '[]'::jsonb;

alter table submissions drop constraint if exists submissions_follow_ups_is_array;
alter table submissions add constraint submissions_follow_ups_is_array check (jsonb_typeof(follow_ups) = 'array');
