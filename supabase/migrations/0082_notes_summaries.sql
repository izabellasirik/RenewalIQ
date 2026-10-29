-- 0082 A short summary of an account's notes on its card. Needs 0046 and 0062.
--
-- An account card shows a summary of the account's notes and its markets' notes, written by AI only when
-- someone clicks Summarize (never on its own). The summary is saved and shared: everyone who can see the
-- account sees the same one. notes_hash is a fingerprint of the notes it was made from; when the notes change
-- the card says "Notes updated" until someone summarizes again. The notes themselves are never stored here.
-- Also lets the AI usage log and read cache record the new 'notes_summary' operation.
-- Additive and re-runnable. Rollback: supabase/release/rollback_0082.sql.

do $$
begin
  if to_regclass('public.ai_usage_events') is null or to_regclass('public.ai_read_cache') is null then
    raise exception '0082 needs 0046.';
  end if;
end $$;

alter table public.ai_read_cache drop constraint if exists ai_read_cache_operation_check;
alter table public.ai_read_cache add constraint ai_read_cache_operation_check
  check (operation in ('structured_extraction', 'transcription', 'email_extraction', 'notes_summary'));
alter table public.ai_usage_events drop constraint if exists ai_usage_events_operation_check;
alter table public.ai_usage_events add constraint ai_usage_events_operation_check
  check (operation in ('structured_extraction', 'transcription', 'email_extraction', 'notes_summary'));

create table if not exists public.account_note_summaries (
  submission_id text primary key references public.submissions (id) on delete cascade,
  summary text not null check (length(summary) between 1 and 1000),
  notes_hash text not null check (length(notes_hash) between 1 and 128),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
alter table public.account_note_summaries enable row level security;
-- Whoever can see the account (the submissions rules decide) reads and writes its summary.
drop policy if exists account_note_summaries_read on public.account_note_summaries;
create policy account_note_summaries_read on public.account_note_summaries for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id));
drop policy if exists account_note_summaries_insert on public.account_note_summaries;
create policy account_note_summaries_insert on public.account_note_summaries for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.submissions s where s.id = submission_id));
drop policy if exists account_note_summaries_update on public.account_note_summaries;
create policy account_note_summaries_update on public.account_note_summaries for update to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id))
  with check (created_by = auth.uid() and exists (select 1 from public.submissions s where s.id = submission_id));
revoke all on public.account_note_summaries from public, anon, authenticated;
grant select, insert, update on public.account_note_summaries to authenticated;

notify pgrst, 'reload schema';
