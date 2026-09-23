-- RenewalIQ: create the Send Feedback table (same result as migration 0002), safe to run any number of times.
-- Fixes "Could not find the table 'public.product_feedback' in the schema cache". Paste into Supabase → SQL Editor → Run.
create table if not exists public.product_feedback (
  id uuid primary key default gen_random_uuid(),
  feedback_type text not null,
  message text not null,
  name text,
  email text,
  page_path text,
  account_id text,
  appetite_record_id text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  constraint product_feedback_type_check check (feedback_type in ('general', 'bug', 'feature_request', 'other')),
  constraint product_feedback_status_check check (status in ('new', 'reviewed', 'resolved')),
  constraint product_feedback_message_not_blank check (btrim(message) <> '')
);
create index if not exists product_feedback_status_idx on public.product_feedback (status);
create index if not exists product_feedback_created_at_idx on public.product_feedback (created_at desc);
alter table public.product_feedback enable row level security;
grant insert on public.product_feedback to anon, authenticated;
grant select, update on public.product_feedback to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'product_feedback' and policyname = 'anyone can submit product feedback') then
    create policy "anyone can submit product feedback" on public.product_feedback for insert to anon, authenticated with check (status = 'new');
  end if;
  -- Admin read/review policies need is_admin() from migration 0001; skipped (not an error) if 0001 isn't applied yet.
  if to_regprocedure('public.is_admin()') is not null then
    if not exists (select 1 from pg_policies where tablename = 'product_feedback' and policyname = 'admin can read product feedback') then
      create policy "admin can read product feedback" on public.product_feedback for select to authenticated using (public.is_admin());
    end if;
    if not exists (select 1 from pg_policies where tablename = 'product_feedback' and policyname = 'admin can update product feedback status') then
      create policy "admin can update product feedback status" on public.product_feedback for update to authenticated using (public.is_admin()) with check (public.is_admin());
    end if;
  else
    raise notice 'is_admin() not found: feedback can be submitted, but apply 0001 and re-run this to let admins read it.';
  end if;
end $$;

notify pgrst, 'reload schema';
