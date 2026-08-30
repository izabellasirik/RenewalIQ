-- Appetite Update Request workflow: lets an external broker submit a suggested correction to a
-- carrier/MGA's appetite from their own device, and lets Renewal IQ review it before anything
-- live changes. Three tables:
--   appetite_update_requests — the broker-submitted queue (status: pending/approved/rejected/
--     needs_more_information). Never mutated except by the review action changing its status.
--   appetite_update_history  — one durable audit row per submission and per review decision.
--     Rejected requests are NEVER deleted; their history rows stay queryable forever.
--   appetite_overrides       — the ONLY table an approval actually writes a live value into. The
--     static base data in src/data/carriers.ts is never rewritten from the browser; the app reads
--     base + approved overrides at runtime instead. See services/appetite/appetiteFieldKeys.ts.
--
-- SECURITY — READ BEFORE APPLYING RLS ELSEWHERE IN THIS PROJECT:
-- There is no authentication in this application yet. The policies below are intentionally
-- permissive (anon role can insert/select/update) so the unauthenticated broker form and admin
-- page both function today. This means anyone holding the public anon key (visible in the deployed
-- JS bundle, by design — that's what "anon key" means) can read every submitted request (including
-- submitter name/email) and could in principle call the Supabase REST API directly to change a
-- request's status or write an override, bypassing the admin UI entirely. This is a real, known
-- limitation, not an oversight — see PRODUCT_ROADMAP.md / the report that shipped alongside this
-- migration. When Supabase Auth is added, tighten each "anon ..." policy below to
-- `using (auth.role() = 'authenticated')` (or a specific admin role) — the policy names are written
-- so that's a one-line change per policy, not a redesign.

create extension if not exists "pgcrypto";

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

alter table appetite_update_requests enable row level security;
alter table appetite_update_history enable row level security;
alter table appetite_overrides enable row level security;

-- Broker submission: anyone can insert a new pending request. No one (including anon) can update
-- or delete a request directly — only the review flow does that, and only via the "anon can
-- review" policy below, which is exactly as permissive since there's no auth yet.
create policy "anon can submit appetite update requests"
  on appetite_update_requests for insert
  to anon
  with check (status = 'pending');

-- TEMP (no auth yet) — tighten to `using (auth.role() = 'authenticated')` once Supabase Auth ships.
create policy "anon can read appetite update requests"
  on appetite_update_requests for select
  to anon
  using (true);

-- TEMP (no auth yet) — tighten to `using (auth.role() = 'authenticated')` once Supabase Auth ships.
create policy "anon can review appetite update requests"
  on appetite_update_requests for update
  to anon
  using (true)
  with check (status in ('approved', 'rejected', 'needs_more_information'));

-- TEMP (no auth yet) — tighten to `using (auth.role() = 'authenticated')` once Supabase Auth ships.
create policy "anon can write appetite update history"
  on appetite_update_history for insert
  to anon
  with check (true);

-- TEMP (no auth yet) — tighten to `using (auth.role() = 'authenticated')` once Supabase Auth ships.
create policy "anon can read appetite update history"
  on appetite_update_history for select
  to anon
  using (true);

-- Overrides are meant to be publicly readable — they ARE the live appetite data every visitor's
-- matching engine reads, not an admin-only view.
create policy "anyone can read appetite overrides"
  on appetite_overrides for select
  to anon
  using (true);

-- TEMP (no auth yet) — tighten to `using (auth.role() = 'authenticated')` once Supabase Auth ships.
-- Until then, anyone holding the anon key could in principle write a fake override directly via
-- the REST API, bypassing the approve button. This is the single highest-severity item in the
-- security limitations list — see the report.
create policy "anon can write appetite overrides"
  on appetite_overrides for insert
  to anon
  with check (true);

create policy "anon can update appetite overrides"
  on appetite_overrides for update
  to anon
  using (true);
