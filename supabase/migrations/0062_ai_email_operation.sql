-- 0062 AI reading of emails (the Email Assistant's hybrid read): lets the AI read cache and the AI
-- usage log (0046) record the new 'email_extraction' operation alongside document extraction and
-- transcription. Only the two CHECK constraints change; no rows are touched, and nothing else
-- about either table changes. Without it, the email reads still work, just uncached and unlogged.
-- Re-runnable.

alter table public.ai_read_cache drop constraint if exists ai_read_cache_operation_check;
alter table public.ai_read_cache add constraint ai_read_cache_operation_check check (operation in ('structured_extraction', 'transcription', 'email_extraction'));

alter table public.ai_usage_events drop constraint if exists ai_usage_events_operation_check;
alter table public.ai_usage_events add constraint ai_usage_events_operation_check check (operation in ('structured_extraction', 'transcription', 'email_extraction'));
