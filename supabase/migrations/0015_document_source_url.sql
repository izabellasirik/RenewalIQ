-- The link a document came from, when it arrived as a URL (a .url/.webloc shortcut, a text file
-- that's only a link, or a link dropped/pasted into the upload box) instead of the file itself.
-- Kept for traceability whether or not the link could be opened: when it couldn't, the document
-- shows "Document could not be accessed — upload the file directly." and nothing is extracted.
--
-- Purely additive and nullable (existing documents have none); covered by the existing documents
-- policies (0011) — no RLS change. Safe to run more than once. Must run after 0003. Until it's
-- applied, the app still saves the document, just without the link.

alter table public.documents add column if not exists source_url text;
