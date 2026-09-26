-- Account workflow: contacts, assigned broker, the submission checklist (missing items, including
-- items a carrier asked for), and markets & quotes (with dated notes) — see src/types/workflow.ts.
--
-- Stored as jsonb columns on `submissions` rather than new tables, deliberately:
--   * it is always read and written together with its submission (submissionsRepo.ts's
--     full-snapshot save stays a single upsert — no new delete/reinsert child tables);
--   * the existing owner-only RLS policies on `submissions` (0003) already cover these columns —
--     no new policies, nothing widened, anon still has zero access;
--   * ON DELETE CASCADE behavior is unchanged (the data is on the row itself).
-- If cross-account querying server-side is ever needed (e.g. an agency-wide Today's Plate), these
-- can be promoted to real tables in a later migration without changing the client model.
--
-- Purely additive. Every column is nullable / defaulted, so existing rows remain valid and a client
-- older than this migration keeps working (it simply never writes these columns). A client newer
-- than a database WITHOUT this migration also keeps working: it falls back to saving without these
-- columns and shows "Failed to save to your account" until this is applied.

alter table submissions add column if not exists contacts jsonb;
alter table submissions add column if not exists assigned_broker jsonb;
alter table submissions add column if not exists missing_items jsonb not null default '[]'::jsonb;
alter table submissions add column if not exists market_quotes jsonb not null default '[]'::jsonb;

-- Shape guards only (arrays / objects) — contents are validated client-side on read.
alter table submissions drop constraint if exists submissions_contacts_is_array;
alter table submissions add constraint submissions_contacts_is_array check (contacts is null or jsonb_typeof(contacts) = 'array');
alter table submissions drop constraint if exists submissions_assigned_broker_is_object;
alter table submissions add constraint submissions_assigned_broker_is_object check (assigned_broker is null or jsonb_typeof(assigned_broker) = 'object');
alter table submissions drop constraint if exists submissions_missing_items_is_array;
alter table submissions add constraint submissions_missing_items_is_array check (jsonb_typeof(missing_items) = 'array');
alter table submissions drop constraint if exists submissions_market_quotes_is_array;
alter table submissions add constraint submissions_market_quotes_is_array check (jsonb_typeof(market_quotes) = 'array');
