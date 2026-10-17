-- Extraction integrity: what a document read but did NOT apply.
--
-- Renewal IQ now validates everything a document reader returns before it touches an account
-- (document type, entity checks, cardinality — see src/services/extraction/validation). Values it
-- can't trust on its own are held "for review" on the document instead of going into the Risk
-- Profile: the broker applies them (as read, or corrected) or ignores them from the document's
-- "Extracted Data" panel. These two columns keep that list — and how many unreadable fragments were
-- thrown away — with the document, so they survive a reload and show on every device.
--
-- Same row, same owner, same RLS as the rest of the document's metadata. Additive; safe to run
-- more than once. The app works without it (review items then stay on the device that read them).

alter table public.documents add column if not exists review_candidates jsonb;
alter table public.documents add column if not exists rejected_count integer;
