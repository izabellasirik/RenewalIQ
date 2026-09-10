-- Broker accounts + private cloud workspaces: lets a signed-up broker's submissions (business
-- info, transportation info, vehicles, drivers, loss history, coverage, documents, field
-- provenance/conflicts, activity history) follow them across devices instead of living only in
-- one browser's localStorage. This is a distinct concern from the existing appetite-update /
-- product-feedback / admin_users system in 0001/0002 — a broker signing up here NEVER becomes an
-- admin, and admin_users is untouched by anything in this file.
--
-- DATA MODEL — mirrors the existing client-side RiskProfile shape one-for-one so no meaning or
-- provenance is lost in translation:
--   submissions       — one row per broker "account" (Account + RiskProfile header). organization_id
--                        is present but unused (nullable, no FK yet) — reserved so a future
--                        agency/team workspace doesn't require a schema rewrite, per product
--                        direction; every policy below is user_id-scoped only, not org-scoped, until
--                        that phase actually exists.
--   field_values      — one row per FieldValue<T> across business/transportation/coverage (e.g.
--                        section='business', field_key='namedInsured'). This IS the provenance +
--                        conflict model: is_conflicting + the paired field_alternates rows are
--                        exactly the alternateValues[] the client already tracks. Resolving a
--                        conflict is just updating this row (see resolveFieldConflict client-side);
--                        no separate "conflict resolutions" table is needed because there is nothing
--                        to record beyond the new state of this row plus the demoted alternate.
--   field_alternates  — the un-chosen conflicting observations for a field_values row (history).
--   coverage_lines    — which CoverageType lines exist for a submission (independent of whether a
--                        limit has been filled in yet — mirrors addCoverageLine()).
--   vehicles / drivers / losses — itemized rows (VehicleEntry/DriverEntry/LossEntry). Each has
--                        exactly one source (or is_manual for a broker-added row) — unlike scalar
--                        fields these never carry alternates, matching the existing client model.
--   documents         — UploadedDocument metadata. storage_path points into the private
--                        `submission-documents` Storage bucket (see the Storage section below);
--                        preview_data_url mirrors the small, already-capped image preview the
--                        client generates today (see services/ingestion/parseImage.ts) — small
--                        enough to store as text, so a second Storage object isn't needed for it.
--   activity_events   — ActivityEvent audit log, one row per user-visible history entry.
--
-- OWNERSHIP: every table below carries its own `user_id` (denormalized rather than requiring a
-- join through submissions on every policy check) plus a `submission_id` FK with ON DELETE CASCADE,
-- so deleting a submission deletes every dependent row automatically and a single flat
-- `user_id = auth.uid()` policy is sufficient and fast on every table.
--
-- ID TYPE: every entity's primary key is `text`, not `uuid` — deliberately, so a row's id is
-- exactly the same client-generated id (see utils/id.ts's generateId(), e.g. "veh_x7fk2n1m...")
-- already used in local Zustand state today. This means creating a row in Supabase never requires
-- reading back a server-generated id and reconciling it into local state — the client decides the
-- id once, and it's identical locally and in the cloud. Only `user_id` (and `auth.users.id` it
-- references) is a real uuid, since that's Supabase Auth's own id format.
--
-- SECURITY MODEL (read before applying):
--   anon (unauthenticated visitor): NO access to any table in this file, in any direction. There is
--     no public/anonymous flow for broker submission data, unlike the appetite-update queue.
--   authenticated, not the owner: NO access to another user's rows, in any direction, on any table.
--   authenticated owner (user_id = auth.uid()): full select/insert/update/delete on their own rows
--     only, on every table.
--   admin_users membership grants NOTHING here — this file does not reference is_admin() or
--     admin_users anywhere, by explicit product requirement: a broker signing up must never gain
--     admin access, and an admin must never automatically gain broker-data access.
-- This migration has not been applied to any live project yet, so it's written correctly the first
-- time rather than patched — see SUPABASE_SETUP.md for the exact steps to apply it and configure
-- the Storage bucket this file's policies assume already exists.

create extension if not exists "pgcrypto";

-- ============================================================================================
-- Tables
-- ============================================================================================

create table if not exists submissions (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid, -- reserved for a future team/agency workspace; unused and unenforced today
  named_insured text not null,
  state text,
  status text not null default 'new',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submissions_status_check
    check (status in ('new', 'documents_uploaded', 'profile_in_review', 'ready_for_market')),
  constraint submissions_named_insured_not_blank check (btrim(named_insured) <> '')
);

create index if not exists submissions_user_id_idx on submissions (user_id);

create table if not exists field_values (
  id text primary key,
  submission_id text not null references submissions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  section text not null,
  field_key text not null,
  value jsonb,
  confidence text not null default 'low',
  is_missing boolean not null default true,
  is_conflicting boolean not null default false,
  extraction_method text,
  source_document_id text,
  source_page int,
  source_excerpt text,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint field_values_section_check check (section in ('business', 'transportation', 'coverage')),
  constraint field_values_confidence_check check (confidence in ('high', 'medium', 'low', 'manual')),
  constraint field_values_extraction_method_check
    check (extraction_method is null or extraction_method in ('ai_extraction', 'deterministic_import', 'manual_entry', 'image_ocr')),
  unique (submission_id, section, field_key)
);

create index if not exists field_values_submission_id_idx on field_values (submission_id);
create index if not exists field_values_user_id_idx on field_values (user_id);

create table if not exists field_alternates (
  id text primary key,
  field_value_id text not null references field_values (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  value jsonb not null,
  extraction_method text
    check (extraction_method is null or extraction_method in ('ai_extraction', 'deterministic_import', 'manual_entry', 'image_ocr')),
  source_document_id text,
  source_page int,
  source_excerpt text,
  created_at timestamptz not null default now()
);

create index if not exists field_alternates_field_value_id_idx on field_alternates (field_value_id);
create index if not exists field_alternates_user_id_idx on field_alternates (user_id);

create table if not exists coverage_lines (
  id text primary key,
  submission_id text not null references submissions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  coverage_type text not null,
  created_at timestamptz not null default now(),
  constraint coverage_lines_type_check
    check (coverage_type in ('auto_liability', 'motor_truck_cargo', 'physical_damage', 'general_liability', 'warehouse_legal_liability')),
  unique (submission_id, coverage_type)
);

create index if not exists coverage_lines_submission_id_idx on coverage_lines (submission_id);
create index if not exists coverage_lines_user_id_idx on coverage_lines (user_id);

create table if not exists vehicles (
  id text primary key,
  submission_id text not null references submissions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vin text,
  make text,
  model text,
  year int,
  value numeric,
  body_type text,
  is_manual boolean not null default false,
  source_document_id text,
  source_page int,
  source_excerpt text,
  last_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists vehicles_submission_id_idx on vehicles (submission_id);
create index if not exists vehicles_user_id_idx on vehicles (user_id);

create table if not exists drivers (
  id text primary key,
  submission_id text not null references submissions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text,
  dob text,
  license_state text,
  years_experience int,
  violations text,
  is_manual boolean not null default false,
  source_document_id text,
  source_page int,
  source_excerpt text,
  last_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists drivers_submission_id_idx on drivers (submission_id);
create index if not exists drivers_user_id_idx on drivers (user_id);

create table if not exists losses (
  id text primary key,
  submission_id text not null references submissions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  loss_date text not null,
  claim_type text not null,
  paid numeric not null default 0,
  reserved numeric not null default 0,
  incurred numeric not null default 0,
  status text not null default 'open',
  is_manual boolean not null default false,
  source_document_id text,
  source_page int,
  source_excerpt text,
  last_updated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint losses_status_check check (status in ('open', 'closed'))
);

create index if not exists losses_submission_id_idx on losses (submission_id);
create index if not exists losses_user_id_idx on losses (user_id);

create table if not exists documents (
  id text primary key,
  submission_id text not null references submissions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  file_type text not null,
  category text not null default 'other',
  status text not null default 'processing',
  size_bytes bigint not null default 0,
  fields_extracted int,
  warnings jsonb,
  storage_path text, -- path within the private submission-documents bucket; null until upload completes
  preview_data_url text, -- small capped image preview only (see services/ingestion/parseImage.ts) — never the original file
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint documents_status_check check (status in ('processing', 'processed', 'error'))
);

create index if not exists documents_submission_id_idx on documents (submission_id);
create index if not exists documents_user_id_idx on documents (user_id);

-- field_values/vehicles/drivers/losses reference a document only loosely (by id, set from the
-- client at write time) rather than a hard FK — a document can be deleted and its dependent
-- observations retracted/promoted in the same client-driven transaction pattern already used
-- locally (removeDocumentFromRiskProfile), without requiring a DB trigger to reimplement that
-- logic. Deleting a submission cascades through submission_id regardless.

create table if not exists activity_events (
  id text primary key,
  submission_id text not null references submissions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  message text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists activity_events_submission_id_idx on activity_events (submission_id);
create index if not exists activity_events_user_id_idx on activity_events (user_id);

-- ============================================================================================
-- Row Level Security — every table: owner-only, full CRUD; nobody else, in either direction.
-- ============================================================================================

alter table submissions enable row level security;
alter table field_values enable row level security;
alter table field_alternates enable row level security;
alter table coverage_lines enable row level security;
alter table vehicles enable row level security;
alter table drivers enable row level security;
alter table losses enable row level security;
alter table documents enable row level security;
alter table activity_events enable row level security;

create policy "owner can select own submissions" on submissions for select to authenticated using (user_id = auth.uid());
create policy "owner can insert own submissions" on submissions for insert to authenticated with check (user_id = auth.uid());
create policy "owner can update own submissions" on submissions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner can delete own submissions" on submissions for delete to authenticated using (user_id = auth.uid());

create policy "owner can select own field_values" on field_values for select to authenticated using (user_id = auth.uid());
create policy "owner can insert own field_values" on field_values for insert to authenticated with check (user_id = auth.uid());
create policy "owner can update own field_values" on field_values for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner can delete own field_values" on field_values for delete to authenticated using (user_id = auth.uid());

create policy "owner can select own field_alternates" on field_alternates for select to authenticated using (user_id = auth.uid());
create policy "owner can insert own field_alternates" on field_alternates for insert to authenticated with check (user_id = auth.uid());
create policy "owner can update own field_alternates" on field_alternates for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner can delete own field_alternates" on field_alternates for delete to authenticated using (user_id = auth.uid());

create policy "owner can select own coverage_lines" on coverage_lines for select to authenticated using (user_id = auth.uid());
create policy "owner can insert own coverage_lines" on coverage_lines for insert to authenticated with check (user_id = auth.uid());
create policy "owner can update own coverage_lines" on coverage_lines for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner can delete own coverage_lines" on coverage_lines for delete to authenticated using (user_id = auth.uid());

create policy "owner can select own vehicles" on vehicles for select to authenticated using (user_id = auth.uid());
create policy "owner can insert own vehicles" on vehicles for insert to authenticated with check (user_id = auth.uid());
create policy "owner can update own vehicles" on vehicles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner can delete own vehicles" on vehicles for delete to authenticated using (user_id = auth.uid());

create policy "owner can select own drivers" on drivers for select to authenticated using (user_id = auth.uid());
create policy "owner can insert own drivers" on drivers for insert to authenticated with check (user_id = auth.uid());
create policy "owner can update own drivers" on drivers for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner can delete own drivers" on drivers for delete to authenticated using (user_id = auth.uid());

create policy "owner can select own losses" on losses for select to authenticated using (user_id = auth.uid());
create policy "owner can insert own losses" on losses for insert to authenticated with check (user_id = auth.uid());
create policy "owner can update own losses" on losses for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner can delete own losses" on losses for delete to authenticated using (user_id = auth.uid());

create policy "owner can select own documents" on documents for select to authenticated using (user_id = auth.uid());
create policy "owner can insert own documents" on documents for insert to authenticated with check (user_id = auth.uid());
create policy "owner can update own documents" on documents for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner can delete own documents" on documents for delete to authenticated using (user_id = auth.uid());

create policy "owner can select own activity_events" on activity_events for select to authenticated using (user_id = auth.uid());
create policy "owner can insert own activity_events" on activity_events for insert to authenticated with check (user_id = auth.uid());
-- No update/delete policy for activity_events for any role — an audit trail is append-only, same
-- convention as appetite_update_history in 0001.

-- No anon policy of any kind on any table above: an unauthenticated visitor has zero access, in
-- either direction, to any broker's submission data or metadata.

-- ============================================================================================
-- Private Storage — submission-documents bucket
-- ============================================================================================

-- Requires the bucket to be created once via the Supabase dashboard or API — a migration cannot
-- create a Storage bucket by itself in all Supabase versions, so this is also called out in
-- SUPABASE_SETUP.md as a manual one-time step. This insert is a convenience for tooling where
-- `storage.buckets` is already writable by the migration role; harmless if it no-ops because the
-- bucket already exists, and `public` is explicitly false either way.
insert into storage.buckets (id, name, public)
values ('submission-documents', 'submission-documents', false)
on conflict (id) do nothing;

-- Path convention (enforced below, not just documented): {user_id}/{submission_id}/{document_id}/
-- {filename} — storage.foldername(name) splits the object path on '/' into an array, so
-- foldername(name)[1] is always the owning user's id for a correctly-uploaded object. A client
-- cannot read/write/delete any object whose first path segment isn't its own auth.uid().
create policy "owner can read own submission documents"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'submission-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner can upload own submission documents"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'submission-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner can update own submission documents"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'submission-documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'submission-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner can delete own submission documents"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'submission-documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- No anon policy on storage.objects for this bucket: there is no public/unauthenticated read of
-- any broker's uploaded file, ever — every access goes through an authenticated, owner-scoped
-- request (a signed URL request still requires this same RLS check to succeed).
