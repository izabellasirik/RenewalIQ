-- Rollback of 0090: market list reads are removed from the AI log and cache, then the 0082 checks come back.
begin;
delete from public.ai_read_cache where operation = 'market_directory';
delete from public.ai_usage_events where operation = 'market_directory';
alter table public.ai_read_cache drop constraint if exists ai_read_cache_operation_check;
alter table public.ai_read_cache add constraint ai_read_cache_operation_check
  check (operation in ('structured_extraction', 'transcription', 'email_extraction', 'notes_summary'));
alter table public.ai_usage_events drop constraint if exists ai_usage_events_operation_check;
alter table public.ai_usage_events add constraint ai_usage_events_operation_check
  check (operation in ('structured_extraction', 'transcription', 'email_extraction', 'notes_summary'));
commit;
