-- ROLLBACK 0048 — upload limits and server-side checks off. No file, account or request is touched.
--
-- Use if uploads are being refused that shouldn't be. Afterwards the buckets accept any size/type
-- again (as before 0048) and client uploads no longer need the server check. The two 0048 tables
-- (upload_verifications, app_settings) stay — they're inert without the triggers.
--
-- If preflight.sql showed bucket limits BEFORE 0048 (not null), put those values back instead of null.
-- Re-applying 0048 later (0048_verified.sql) is safe.

begin;
update public.app_settings set value = 'false', updated_at = now() where key = 'require_upload_verification';
drop trigger if exists document_request_files_verified_upload on public.document_request_files;
drop trigger if exists intake_documents_verified_upload on public.intake_documents;
update storage.buckets set file_size_limit = null, allowed_mime_types = null
 where id in ('submission-documents', 'intake-uploads');
commit;

select id, file_size_limit, allowed_mime_types from storage.buckets where id in ('submission-documents', 'intake-uploads');
