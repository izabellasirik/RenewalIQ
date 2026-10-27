-- Rollback of 0078: the database stops recording saved work itself, and the app's neutral-named call is
-- removed (the app then falls back to track_product_event). Activity already recorded is kept.
begin;
drop trigger if exists activity_from_account_save on public.submissions;
drop trigger if exists activity_from_document_save on public.documents;
drop function if exists public.activity_from_account_save();
drop function if exists public.activity_from_document_save();
drop function if exists public.record_saved_work(text, uuid, uuid, text, jsonb, text);
drop function if exists public.note_work(text, text, jsonb, text);
commit;
notify pgrst, 'reload schema';
