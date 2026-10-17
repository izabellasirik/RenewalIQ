-- Account pipeline status set by the broker (src/types/workflow.ts AccountStage), so the Accounts
-- list can be filtered by it across devices. NULL means "automatic" — the app derives the status
-- from the checklist and quotes — so every existing row stays valid with no backfill.
--
-- Purely additive; covered by the existing owner-only RLS on `submissions` (0003) — no new
-- policies. Must run after 0003. Safe to run more than once.
--
-- Note: an unrelated branch (claude/eloquent-planck-c8spdl) also has a file numbered 0008
-- (0008_submission_intake_source_label.sql). They don't conflict — different columns.

alter table submissions add column if not exists stage text;

alter table submissions drop constraint if exists submissions_stage_check;
alter table submissions add constraint submissions_stage_check
  check (stage is null or stage in ('new', 'collecting_info', 'ready_to_submit', 'submitted', 'quoted', 'bound', 'on_hold', 'lost'));
