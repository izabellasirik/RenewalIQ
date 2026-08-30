-- Appetite Update Request workflow: lets an external broker submit a suggested correction to a
-- carrier/MGA's appetite from their own device, and lets Renewal IQ review it before anything
-- live changes. Three data tables, one admin-authorization table, one authorization helper, and
-- one atomic review function:
--   appetite_update_requests — the broker-submitted queue (status: pending/approved/rejected/
--     needs_more_information). Never deleted.
--   appetite_update_history  — one durable, append-only audit row per review decision. Rejected
--     requests are NEVER deleted; their history rows stay queryable forever.
--   appetite_overrides       — the ONLY table an approval actually writes a live value into. The
--     static base data in src/data/carriers.ts is never rewritten from the browser; the app reads
--     base + approved overrides at runtime instead. See services/appetite/appetiteFieldKeys.ts.
--   admin_users              — the allowlist of Supabase Auth users treated as admins. See
--     SUPABASE_SETUP.md for how to add yourself — deliberately SQL-editor-only, no in-app UI.
--   review_appetite_update_request() — the SECURITY DEFINER function the admin review page calls.
--     It re-checks admin status itself (the actual authorization boundary the app relies on — the
--     table-level RLS below is defense in depth for direct/dashboard queries, not the primary gate)
--     and performs the status update + history insert + override upsert as one transaction.
--
-- SECURITY MODEL (read before applying):
--   anon (unauthenticated broker): INSERT on appetite_update_requests only, and SELECT on
--     appetite_overrides only (the public app needs approved overrides to compute live appetite).
--     No other read or write of any kind — cannot list other brokers' submissions, cannot read or
--     write audit history, cannot write an override.
--   authenticated, non-admin: same as anon for every table below — being logged in grants nothing
--     by itself. Only rows in admin_users grant elevated access, via is_admin().
--   authenticated admin (a user_id present in admin_users): full read of the request queue and
--     history, and review actions exclusively through review_appetite_update_request().
-- This migration has not been applied to any live project yet, so it's written correctly the first
-- time rather than patched — there is no prior "temporarily permissive" state to migrate away from.

create extension if not exists "pgcrypto";

-- ============================================================================================
-- Tables
-- ============================================================================================

create table if not exists appetite_update_requests (
  id uuid primary key default gen_random_uuid(),
  market_id text not null,
  market_name text not null,
  field_key text not null,
  current_value jsonb,
  proposed_value text not null,
  notes text,
  source_url text,
  source_reference text,
  submitter_name text not null,
  submitter_email text not null,
  status text not null default 'pending',
  review_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint appetite_update_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'needs_more_information')),
  constraint appetite_update_requests_field_key_check
    check (field_key in (
      'fleet_size', 'states', 'years_in_business', 'cdl_experience', 'operation', 'coverage',
      'new_ventures', 'telematics', 'dashcams', 'driver_requirements', 'vehicle_requirements',
      'submission_requirements', 'distribution_mga', 'other'
    )),
  constraint appetite_update_requests_proposed_value_not_blank check (btrim(proposed_value) <> ''),
  constraint appetite_update_requests_submitter_name_not_blank check (btrim(submitter_name) <> ''),
  constraint appetite_update_requests_submitter_email_not_blank check (btrim(submitter_email) <> '')
);

create index if not exists appetite_update_requests_status_idx on appetite_update_requests (status);
create index if not exists appetite_update_requests_market_id_idx on appetite_update_requests (market_id);

-- Audit history: submitted_by/reviewed_by hold email addresses (broker/admin) — fine because this
-- table has no public or anon read policy anywhere below, only admin.
create table if not exists appetite_update_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references appetite_update_requests (id),
  market_id text not null,
  field_key text not null,
  previous_value jsonb,
  new_value jsonb,
  submitted_by text not null,
  submitted_at timestamptz not null,
  reviewed_by text,
  reviewed_at timestamptz,
  status text not null,
  source_url text,
  review_notes text,
  created_at timestamptz not null default now(),
  constraint appetite_update_history_status_check
    check (status in ('pending', 'approved', 'rejected', 'needs_more_information'))
);

create index if not exists appetite_update_history_request_id_idx on appetite_update_history (request_id);
create index if not exists appetite_update_history_market_id_idx on appetite_update_history (market_id);

-- The only table whose contents feed live appetite at runtime (base record + approved overrides).
-- Never stores broker name/email — approved_by is the reviewing admin, not the submitter.
create table if not exists appetite_overrides (
  id uuid primary key default gen_random_uuid(),
  market_id text not null,
  field_key text not null,
  value jsonb not null,
  verification_status text not null,
  source_url text,
  approved_by text not null,
  approved_at timestamptz not null default now(),
  request_id uuid not null references appetite_update_requests (id),
  constraint appetite_overrides_verification_status_check
    check (verification_status in ('VERIFIED', 'PARTIALLY_VERIFIED', 'NEEDS_CONFIRMATION')),
  constraint appetite_overrides_field_key_check
    check (field_key in (
      'fleet_size', 'states', 'years_in_business', 'cdl_experience', 'operation', 'coverage',
      'new_ventures', 'telematics', 'dashcams', 'driver_requirements', 'vehicle_requirements',
      'submission_requirements', 'distribution_mga', 'other'
    ))
);

-- One override per (market, field) — a newer approval replaces the prior override rather than
-- stacking; the full history of what changed and when still lives in appetite_update_history.
create unique index if not exists appetite_overrides_market_field_unique
  on appetite_overrides (market_id, field_key);

-- The admin allowlist. Populated exclusively via the Supabase SQL editor (see SUPABASE_SETUP.md) —
-- there is no in-app "add admin" UI, by design, to keep this the smallest maintainable mechanism
-- for what is, for now, effectively a single-admin tool.
create table if not exists admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- ============================================================================================
-- Authorization helper
-- ============================================================================================

-- SECURITY DEFINER so it can read admin_users regardless of that table's own RLS (below, which
-- only lets a user read their own row) — this is the one place "am I an admin" gets decided.
-- search_path is emptied (not just set to `public`) and every reference is schema-qualified, per
-- Supabase/Postgres guidance for SECURITY DEFINER functions, so no object created in any schema on
-- the resolution path — including public itself — can shadow admin_users or auth.uid().
create or replace function is_admin() returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC (i.e. every role, including anon) by
-- default — revoke that before granting narrowly, or the explicit grant below is additive, not
-- restrictive. Not granted to anon at all: brokers never need to call this.
revoke execute on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- ============================================================================================
-- Row Level Security
-- ============================================================================================

alter table appetite_update_requests enable row level security;
alter table appetite_update_history enable row level security;
alter table appetite_overrides enable row level security;
alter table admin_users enable row level security;

-- appetite_update_requests -------------------------------------------------------------------
-- Anyone (anonymous broker, or a signed-in admin using the same form) can submit a new pending
-- request. Nobody — anon or authenticated non-admin — can read, update, or delete a request
-- directly; only an admin can, and only the review action does so (see the RPC below). The check
-- below forces every review-related column to its unreviewed state at insert time — a submitter
-- cannot set status to anything but 'pending', or pre-fill reviewed_by/reviewed_at/review_notes to
-- fake a review that never happened.

create policy "anyone can submit appetite update requests"
  on appetite_update_requests for insert
  to anon, authenticated
  with check (status = 'pending' and reviewed_by is null and reviewed_at is null and review_notes is null);

create policy "admin can read appetite update requests"
  on appetite_update_requests for select
  to authenticated
  using (is_admin());

create policy "admin can review appetite update requests"
  on appetite_update_requests for update
  to authenticated
  using (is_admin())
  with check (is_admin());

-- No delete policy at all for any role — requests are never deleted.

-- appetite_update_history --------------------------------------------------------------------
-- Admin-only in both directions, and effectively append-only: no update/delete policy exists for
-- any role, so a written history row can never be altered or removed, including by an admin.

create policy "admin can read appetite update history"
  on appetite_update_history for select
  to authenticated
  using (is_admin());

create policy "admin can write appetite update history"
  on appetite_update_history for insert
  to authenticated
  with check (is_admin());

-- appetite_overrides --------------------------------------------------------------------------
-- Public read (this IS the live appetite data every visitor's matching engine reads, not an
-- admin-only view) but write access is admin-only. This closes the previous migration's most
-- serious gap: an anonymous client can no longer insert, update, or delete an override under any
-- circumstances — there is no anon policy for any of those actions.

create policy "anyone can read appetite overrides"
  on appetite_overrides for select
  to anon, authenticated
  using (true);

create policy "admin can write appetite overrides"
  on appetite_overrides for insert
  to authenticated
  with check (is_admin());

create policy "admin can update appetite overrides"
  on appetite_overrides for update
  to authenticated
  using (is_admin())
  with check (is_admin());

-- No delete policy — an override is superseded via upsert (see the RPC below), never removed.

-- admin_users -------------------------------------------------------------------------------
-- A signed-in user may confirm only their own membership (used by the app to decide whether to
-- show the admin UI at all). No client role can insert/update/delete this table under any
-- circumstances — see SUPABASE_SETUP.md for how admins are actually added.

create policy "authenticated can check their own admin status"
  on admin_users for select
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================================
-- Atomic review action
-- ============================================================================================

-- The single path the admin review page uses to approve/reject/mark-needs-more-information.
-- SECURITY DEFINER lets it perform the status update, history insert, and (on approval) override
-- upsert as one transaction regardless of the strict per-table RLS above — but the very first
-- thing it does is re-check is_admin() itself, which is the real authorization boundary the
-- frontend relies on. reviewed_by/submitted_by are looked up server-side (admin_users.email,
-- appetite_update_requests.submitter_email) rather than trusted from the caller, so a client can't
-- spoof who reviewed or who submitted something. search_path is emptied and every reference is
-- schema-qualified — same object-shadowing defense as is_admin() above.
create or replace function review_appetite_update_request(
  p_request_id uuid,
  p_decision text,
  p_review_notes text,
  p_approved_value jsonb,
  p_approved_verification_status text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.appetite_update_requests%rowtype;
  v_now timestamptz := now();
  v_reviewer text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin only.';
  end if;

  if p_decision not in ('approved', 'rejected', 'needs_more_information') then
    raise exception 'Invalid decision: %', p_decision;
  end if;

  select email into v_reviewer from public.admin_users where user_id = auth.uid();

  select * into v_request from public.appetite_update_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found: %', p_request_id;
  end if;

  update public.appetite_update_requests
  set status = p_decision, review_notes = p_review_notes, reviewed_by = v_reviewer, reviewed_at = v_now
  where id = p_request_id;

  insert into public.appetite_update_history (
    request_id, market_id, field_key, previous_value, new_value,
    submitted_by, submitted_at, reviewed_by, reviewed_at, status, source_url, review_notes
  ) values (
    p_request_id, v_request.market_id, v_request.field_key, v_request.current_value,
    case when p_decision = 'approved' then p_approved_value else null end,
    v_request.submitter_email, v_request.created_at, v_reviewer, v_now, p_decision,
    v_request.source_url, p_review_notes
  );

  if p_decision = 'approved' then
    if p_approved_verification_status not in ('VERIFIED', 'PARTIALLY_VERIFIED', 'NEEDS_CONFIRMATION') then
      raise exception 'Invalid verification status: %', p_approved_verification_status;
    end if;
    if p_approved_value is null then
      raise exception 'An approved request must include a value to write live.';
    end if;

    insert into public.appetite_overrides (market_id, field_key, value, verification_status, source_url, approved_by, approved_at, request_id)
    values (v_request.market_id, v_request.field_key, p_approved_value, p_approved_verification_status, v_request.source_url, v_reviewer, v_now, p_request_id)
    on conflict (market_id, field_key) do update set
      value = excluded.value,
      verification_status = excluded.verification_status,
      source_url = excluded.source_url,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at,
      request_id = excluded.request_id;
  end if;
end;
$$;

-- Revoke the default PUBLIC execute grant (see the is_admin() comment above) before granting
-- narrowly. Not granted to anon: an anonymous broker has no legitimate reason to call this, and
-- the internal is_admin() check would reject them anyway — this just removes the ability to even
-- attempt the call at the database privilege layer, ahead of that check.
revoke execute on function review_appetite_update_request(uuid, text, text, jsonb, text) from public;
grant execute on function review_appetite_update_request(uuid, text, text, jsonb, text) to authenticated;
