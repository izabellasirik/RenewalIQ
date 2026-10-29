-- Rollback of 0082: no more saved notes summaries (the cards show no summary). The AI usage rows already
-- logged as 'notes_summary' are kept, so the operation stays allowed in both checks.
begin;
drop table if exists public.account_note_summaries;
commit;
notify pgrst, 'reload schema';
