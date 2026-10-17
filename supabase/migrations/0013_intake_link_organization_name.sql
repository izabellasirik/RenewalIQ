-- The agency / organization name a client sees on a submission link ("You're submitting this
-- directly to {organization_name} for review."). Until now the public form showed the link's
-- `label`, which is the broker's own internal note for telling sources apart and was never meant
-- for the client. The broker enters the name when creating a link (pre-filled from their last one).
--
-- Same column as eloquent-planck's 0007_intake_link_organization_name.sql, added here under its own
-- number; if that file was already run, this does nothing. Nullable and additive (existing links
-- read "your insurance broker" until they have a name); the existing "anyone can read an intake
-- link to validate it" policy already covers the new column — no RLS change. Safe to run more than
-- once. Must run after 0004.

alter table public.intake_links add column if not exists organization_name text;
