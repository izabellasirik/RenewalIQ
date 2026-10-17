-- Account notes: human-written notes on an account (Workspace → Notes), separate from the automatic
-- Activity log. Each note: { id, text, createdAt, authorId, authorName, updatedAt?, updatedByName? }.
--
-- Stored on `submissions` like the rest of the account workflow (0007 / 0009 / 0016), so the
-- existing agency permissions (0011) apply unchanged: anyone who can see / edit the account can
-- see / edit its notes — an admin for every agency account, an agent for the accounts assigned to
-- them. No new policies.
--
-- Purely additive and safe to run more than once. Must run after 0003.

alter table public.submissions add column if not exists account_notes jsonb not null default '[]'::jsonb;

alter table public.submissions drop constraint if exists submissions_account_notes_is_array;
alter table public.submissions add constraint submissions_account_notes_is_array check (jsonb_typeof(account_notes) = 'array');
