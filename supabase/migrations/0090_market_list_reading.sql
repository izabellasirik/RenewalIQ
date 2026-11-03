-- 0090 The AI usage log and read cache accept 'market_directory' (Market Directory → Import of a PDF / Word market
-- list, read by AI and reviewed before saving). Needs 0082. Re-runnable. Rollback: supabase/release/rollback_0090.sql.

do $$
begin
  if to_regclass('public.ai_usage_events') is null or to_regclass('public.ai_read_cache') is null then
    raise exception '0090 needs 0082.';
  end if;
end $$;

alter table public.ai_read_cache drop constraint if exists ai_read_cache_operation_check;
alter table public.ai_read_cache add constraint ai_read_cache_operation_check
  check (operation in ('structured_extraction', 'transcription', 'email_extraction', 'notes_summary', 'market_directory'));
alter table public.ai_usage_events drop constraint if exists ai_usage_events_operation_check;
alter table public.ai_usage_events add constraint ai_usage_events_operation_check
  check (operation in ('structured_extraction', 'transcription', 'email_extraction', 'notes_summary', 'market_directory'));
