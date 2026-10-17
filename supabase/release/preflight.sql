-- PREFLIGHT — read-only. Run in the Supabase SQL editor right before the release and save the result
-- (copy it into the release notes). Changes nothing.
--
-- Shows what exists now, so the verified migration's summary can be compared with it, which
-- migrations are already in, and the storage bucket settings 0048 will replace (for rollback).

select 'accounts' as what, count(*)::text as value from public.submissions
union all select 'accounts archived', count(*)::text from public.submissions where archived
union all select 'documents', count(*)::text from public.documents
union all select 'documents with a stored file', count(*)::text from public.documents where storage_path is not null
union all select 'checklist items', coalesce(sum(case when jsonb_typeof(missing_items) = 'array' then jsonb_array_length(missing_items) end), 0)::text from public.submissions
union all select 'account follow-ups', coalesce(sum(case when jsonb_typeof(follow_ups) = 'array' then jsonb_array_length(follow_ups) end), 0)::text from public.submissions
union all select 'client requests', count(*)::text from public.document_requests
union all select 'client requests open', count(*)::text from public.document_requests where status in ('waiting', 'partial')
union all select 'client requests with a next follow-up', count(*)::text from public.document_requests where next_follow_up is not null
union all select 'client request files', count(*)::text from public.document_request_files
union all select 'stored files', count(*)::text from storage.objects
union all select 'users', count(*)::text from auth.users
union all select 'agencies', count(*)::text from public.agencies
union all select '0047 already applied?', (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'document_requests' and column_name = 'delivery_status'))::text
union all select '0048 already applied?', (to_regclass('public.upload_verifications') is not null)::text
union all select 'bucket ' || id || ' size limit', coalesce(file_size_limit::text, 'none') from storage.buckets where id in ('submission-documents', 'intake-uploads')
union all select 'bucket ' || id || ' allowed types', coalesce(array_to_string(allowed_mime_types, ', '), 'any') from storage.buckets where id in ('submission-documents', 'intake-uploads');
