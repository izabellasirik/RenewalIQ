-- Agency-managed carrier appetite: an agency admin adds, edits and archives the carriers their
-- agency writes with, and their appetite. Market Finder matches every account in the agency against
-- this list (layered on top of Renewal IQ's built-in carrier list, src/data/carriers.ts).
--
-- One row = one carrier/program for one agency.
--   * base_record_id null  → a carrier the agency added itself.
--   * base_record_id set   → the agency's version of a built-in carrier (its id in carriers.ts).
--     It replaces the built-in for this agency only; archiving it hides the built-in for this agency.
--   * criteria (jsonb) holds only the appetite criteria the admin has set, keyed by name
--     (states, fleetSize, yearsInBusinessMin, yearsInBusinessMax, minDriverExperienceYears,
--     minDriverAge, operationTypes, maxRadius, commodities, majorExclusions, maxClaimsPast3Years).
--     A missing key means "not on file" (for a built-in: keep the built-in value); a key set to
--     null means "cleared". rule_strictness says whether Market Finder treats them as hard
--     requirements (decline when not met) or guidelines (flag, never decline).
--   * source / external_ref / last_verified_at are there so imports or carrier feeds can write the
--     same rows later. V1 only writes 'manual'.
--
-- SECURITY (enforced here, not in the app)
--   * Every member of the agency can READ its carriers (agents use them in Market Finder).
--   * Only an agency ADMIN can insert or update, and only for their own agency. There is no delete
--     policy: carriers are archived (archived_at), never deleted, so quotes and history keep their
--     market names.
--   * agency_id, created_by/at and updated_by/at are set by the database, not taken from the app.
--   * Other agencies never see or change these rows. Users outside an agency have no rows.
--
-- Additive; safe to run more than once. Must run after 0011.

create table if not exists public.agency_carriers (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  base_record_id text,
  name text not null,
  market_type text not null default 'direct',
  available_through text,
  website text,
  contact_name text,
  contact_email text,
  contact_phone text,
  criteria jsonb not null default '{}'::jsonb,
  rule_strictness text not null default 'hard',
  notes text,
  source text not null default 'manual',
  external_ref text,
  last_verified_at timestamptz,
  archived_at timestamptz,
  archived_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint agency_carriers_name_check check (length(btrim(name)) between 1 and 200),
  constraint agency_carriers_market_type_check check (market_type in ('direct', 'mga')),
  constraint agency_carriers_strictness_check check (rule_strictness in ('hard', 'guideline')),
  constraint agency_carriers_source_check check (source in ('manual', 'import', 'carrier_feed')),
  constraint agency_carriers_criteria_check check (jsonb_typeof(criteria) = 'object')
);

create index if not exists agency_carriers_agency_id_idx on public.agency_carriers (agency_id);
-- One version of each built-in carrier per agency.
create unique index if not exists agency_carriers_one_per_base_idx on public.agency_carriers (agency_id, base_record_id) where base_record_id is not null;

create or replace function public.agency_carriers_stamp() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new; -- SQL editor / service role (future imports)
  end if;
  if tg_op = 'INSERT' then
    new.agency_id := public.current_agency_id();
    new.created_by := auth.uid();
    new.created_at := now();
    new.archived_at := null;
    new.archived_by := null;
  else
    new.agency_id := old.agency_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.base_record_id := old.base_record_id;
    if new.archived_at is not null and old.archived_at is null then
      new.archived_at := now();
      new.archived_by := auth.uid();
    elsif new.archived_at is null then
      new.archived_by := null;
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agency_carriers_stamp on public.agency_carriers;
create trigger agency_carriers_stamp before insert or update on public.agency_carriers
  for each row execute function public.agency_carriers_stamp();

alter table public.agency_carriers enable row level security;

drop policy if exists "agency members read their carriers" on public.agency_carriers;
create policy "agency members read their carriers" on public.agency_carriers for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "agency admins add carriers" on public.agency_carriers;
create policy "agency admins add carriers" on public.agency_carriers for insert to authenticated
  with check (public.current_agency_id() is not null and public.is_agency_admin());

drop policy if exists "agency admins update carriers" on public.agency_carriers;
create policy "agency admins update carriers" on public.agency_carriers for update to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin())
  with check (agency_id = public.current_agency_id() and public.is_agency_admin());

grant select, insert, update on public.agency_carriers to authenticated;
