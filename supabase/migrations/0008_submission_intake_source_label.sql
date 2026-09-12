-- Same pattern as 0005_submission_contact_fields.sql: adds one nullable column to the existing
-- `submissions` table (see 0003_broker_workspaces.sql) so an account created by importing an
-- external intake submission keeps its source attribution — the intake link's internal `label`
-- (e.g. "ABC Agency") — after a reload, instead of that information only ever existing transiently
-- on the pre-import intake_submissions row. Never shown to the applicant/recipient — this is the
-- broker-internal "Source: ABC Agency" label (see components/IntakeLinksPage.tsx's SubmissionCard
-- and services/intake/importIntakeSubmission.ts), distinct from the recipient-facing organization
-- name added in 0007_intake_link_organization_name.sql.
--
-- Nullable and defaults to nothing — every submission created through the normal document-upload
-- flow (never imported from an intake link) simply never sets it.

alter table submissions add column if not exists intake_link_label text;
