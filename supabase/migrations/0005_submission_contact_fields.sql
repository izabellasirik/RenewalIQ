-- Adds the applicant's own contact info to the cloud `submissions` table (see
-- 0003_broker_workspaces.sql), so it survives a reload for an account created by importing an
-- external intake submission (see 0004_intake_submissions.sql / types/intake.ts). Kept on the
-- account envelope, not the Risk Profile, since it's submission metadata (who to call about this
-- account) rather than underwriting data. All three columns are nullable and default to nothing —
-- every submission created through the normal document-upload flow simply never sets them.
-- This migration has not been applied to any live project yet.

alter table submissions add column if not exists contact_name text;
alter table submissions add column if not exists contact_email text;
alter table submissions add column if not exists contact_phone text;
