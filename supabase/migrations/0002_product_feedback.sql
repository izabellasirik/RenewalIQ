-- General product feedback: a broker (or anyone using the app, signed in or not) can leave
-- feedback about Renewal IQ itself — bugs, ideas, general comments — completely separate from an
-- Appetite Update Request (a correction to carrier/MGA data; see 0001_appetite_update_workflow.sql).
-- One table, admin-reviewed via a plain status column — no atomic multi-table transaction is
-- needed here (unlike the appetite workflow, which writes a live override alongside its audit
-- trail), so this deliberately does NOT add a new SECURITY DEFINER function. is_admin() already
-- exists (created in 0001) and is reused as-is as the authorization boundary for both the read and
-- the status-update policy below.
--
-- SECURITY MODEL (read before applying):
--   anon (unauthenticated broker): INSERT only, and only with status forced to 'new' (same
--     anti-spoofing pattern as appetite_update_requests — see the with-check below). No SELECT,
--     UPDATE, or DELETE of any kind — cannot read other people's feedback, including their own
--     after submitting.
--   authenticated, non-admin: identical to anon for this table — being signed in grants nothing by
--     itself, only rows in admin_users (via is_admin()) do.
--   authenticated admin: full read, and may update status (new -> reviewed -> resolved). No delete
--     policy for any role — feedback is never removed, only its status changes, so history stays
--     intact.
-- This migration has not been applied to any live project yet.

create table if not exists product_feedback (
  id uuid primary key default gen_random_uuid(),
  feedback_type text not null,
  message text not null,
  -- Optional, broker-provided — never required. No other PII is collected.
  name text,
  email text,
  -- Lightweight, non-sensitive context captured automatically by the widget. Plain client-side ids
  -- (like market_id on appetite_update_requests) — never any submission/client business data
  -- (no named insured, no fleet/driver/loss details, nothing extracted from an account's documents).
  page_path text,
  account_id text,
  appetite_record_id text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  constraint product_feedback_type_check
    check (feedback_type in ('general', 'bug', 'feature_request', 'other')),
  constraint product_feedback_status_check
    check (status in ('new', 'reviewed', 'resolved')),
  constraint product_feedback_message_not_blank check (btrim(message) <> '')
);

create index if not exists product_feedback_status_idx on product_feedback (status);
create index if not exists product_feedback_created_at_idx on product_feedback (created_at desc);

alter table product_feedback enable row level security;

create policy "anyone can submit product feedback"
  on product_feedback for insert
  to anon, authenticated
  with check (status = 'new');

create policy "admin can read product feedback"
  on product_feedback for select
  to authenticated
  using (is_admin());

-- Broad UPDATE grant at the RLS layer (same pattern as "admin can update appetite overrides" in
-- 0001) — the service layer only ever sends { status }, but RLS itself doesn't restrict which
-- columns a permitted UPDATE touches. is_admin() is still the real authorization boundary; no
-- client without an admin_users row can reach this at all.
create policy "admin can update product feedback status"
  on product_feedback for update
  to authenticated
  using (is_admin())
  with check (is_admin());

-- No delete policy at all for any role — feedback is never deleted, only its status changes.
