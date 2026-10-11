-- 0049: Carrier 101 (how the agency reaches a market) + Carrier 102 (individual underwriting rules).
--
-- Extends 0023's agency_carriers — the agency's own, private carrier list — instead of adding a
-- second one. Everything here belongs to one agency and is invisible to every other agency.
--
-- 1. Carrier 101 — market access, as columns on agency_carriers:
--      access_route     direct | indirect (through an intermediary)
--      access_status    ready | partial | not_ready | inactive
--                       ("ready" = a submission route exists. It says nothing about whether a given
--                        risk is eligible — that is Carrier 102.)
--      mga_name, wholesaler_name, paper_carrier   the chain: agency → wholesaler → MGA → carrier paper
--      portal_name, portal_url, submission_email   where submissions go
--      producer_code, appointment_status, appointment_notes
--      contacts         jsonb array of {name, role, email, phone, coverage, notes}
--      access_source, access_source_date, access_verified_at, access_notes
--      access_documented_status   the status exactly as the agency's source states it (e.g.
--                       "PENDING VERIFICATION / PARTIAL") — kept apart from access_verified_at,
--                       which is set only when the agency has independently confirmed the route
--    Passwords/credentials are never stored (there is no column for them).
--
-- 2. Carrier 102 — agency_carrier_rules: one row per underwriting rule of one market:
--      coverage         null = every coverage, else one coverage line
--      category/operator/value   what the rule is about, as a structured test on the account
--                       (e.g. commodity any_of ["hazmat"], fleet_size gt 25, telematics is_false)
--      answer           yes | no | referral | unknown   — the market's answer for such accounts
--      strength         hard | soft | info
--      conditions       extra tests that must hold for the rule to apply (+ conditions_text)
--      source, source_date, last_verified_at, verified_by, notes
--      documented_status   the verification wording of the source (e.g. "VERIFIED", "SUPPORTED",
--                          "Underwriter-confirmed") — a record of what the source says, NOT a
--                          RenewalIQ verification; it never makes a rule decline on its own
--    Only a VERIFIED (last_verified_at set) HARD "no" can make Market Finder say Not Eligible.
--    "unknown" never declines. Unverified rules are shown as "confirm with the market".
--
-- 3. import_agency_carrier_directory(payload, dry_run): an agency admin's reviewed import of a
--    directory (Carrier 101 records + their Carrier 102 rules). Matches existing markets by import
--    reference, then the agency market the admin chose to link (linkTo, own agency only), then the
--    agency's version of a chosen built-in (baseRecordId — a new market is created as that version),
--    then by name. Two imported markets are never merged into one. NEVER changes a market's existing appetite criteria (0023's
--    criteria / rule_strictness) and never deletes anything. dry_run returns the exact counts and
--    rolls everything back. Each real import is recorded in agency_carrier_imports.
--
-- SECURITY (enforced here): members of an agency read its markets and rules; only that agency's
-- admins add or change them (directly or by import); other agencies see nothing. Rules carry the
-- agency of their market, set by the database. No deletes — archive instead.
--
-- Additive and re-runnable. Needs 0011 (agencies, current_agency_id, is_agency_admin) and 0023.
-- Independent of 0047/0048.

-- 1. Carrier 101 columns ------------------------------------------------------------------------
alter table public.agency_carriers
  add column if not exists access_route text,
  add column if not exists access_status text,
  add column if not exists mga_name text,
  add column if not exists wholesaler_name text,
  add column if not exists paper_carrier text,
  add column if not exists portal_name text,
  add column if not exists portal_url text,
  add column if not exists submission_email text,
  add column if not exists producer_code text,
  add column if not exists appointment_status text,
  add column if not exists appointment_notes text,
  add column if not exists contacts jsonb not null default '[]'::jsonb,
  add column if not exists access_source text,
  add column if not exists access_source_date date,
  add column if not exists access_verified_at date,
  add column if not exists access_notes text,
  add column if not exists access_documented_status text;

do $$ begin
  alter table public.agency_carriers add constraint agency_carriers_access_route_check check (access_route is null or access_route in ('direct', 'indirect'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.agency_carriers add constraint agency_carriers_access_status_check check (access_status is null or access_status in ('ready', 'partial', 'not_ready', 'inactive'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.agency_carriers add constraint agency_carriers_contacts_check check (jsonb_typeof(contacts) = 'array' and jsonb_array_length(contacts) <= 50);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.agency_carriers add constraint agency_carriers_portal_url_check check (portal_url is null or portal_url ~* '^https?://[^\s]+$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.agency_carriers add constraint agency_carriers_access_text_check check (
    coalesce(length(mga_name), 0) <= 200 and coalesce(length(wholesaler_name), 0) <= 200 and coalesce(length(paper_carrier), 0) <= 200
    and coalesce(length(portal_name), 0) <= 200 and coalesce(length(portal_url), 0) <= 1000 and coalesce(length(submission_email), 0) <= 320
    and coalesce(length(producer_code), 0) <= 200 and coalesce(length(appointment_status), 0) <= 200 and coalesce(length(appointment_notes), 0) <= 4000
    and coalesce(length(access_source), 0) <= 500 and coalesce(length(access_notes), 0) <= 4000 and coalesce(length(access_documented_status), 0) <= 500);
exception when duplicate_object then null; end $$;
-- One market per import reference per agency.
create unique index if not exists agency_carriers_external_ref_idx on public.agency_carriers (agency_id, external_ref) where external_ref is not null;

-- 2. Carrier 102 rules ----------------------------------------------------------------------------
create table if not exists public.agency_carrier_rules (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  carrier_id uuid not null references public.agency_carriers (id) on delete cascade,
  external_ref text,
  coverage text,
  category text not null,
  operator text not null,
  value jsonb,
  answer text not null,
  strength text not null default 'soft',
  conditions jsonb not null default '[]'::jsonb,
  conditions_text text,
  source text,
  source_date date,
  last_verified_at date,
  verified_by text,
  documented_status text,
  notes text,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint agency_carrier_rules_coverage_check check (coverage is null or coverage in ('auto_liability', 'motor_truck_cargo', 'physical_damage', 'general_liability', 'warehouse_legal_liability', 'trailer_interchange', 'non_trucking_liability')),
  constraint agency_carrier_rules_category_check check (category in ('state', 'commodity', 'operation_type', 'radius_miles', 'fleet_size', 'years_in_business', 'driver_age', 'driver_experience', 'vehicle_type', 'operation_class', 'vehicle_age', 'claims_3y', 'telematics', 'dashcam', 'dot_number', 'coverage_offered', 'other')),
  constraint agency_carrier_rules_operator_check check (operator in ('any_of', 'lt', 'lte', 'gt', 'gte', 'between', 'is_true', 'is_false', 'missing', 'offered', 'text')),
  constraint agency_carrier_rules_answer_check check (answer in ('yes', 'no', 'referral', 'unknown')),
  constraint agency_carrier_rules_strength_check check (strength in ('hard', 'soft', 'info')),
  constraint agency_carrier_rules_conditions_check check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 10),
  constraint agency_carrier_rules_value_check check (value is null or length(value::text) <= 4000),
  constraint agency_carrier_rules_text_check check (
    coalesce(length(external_ref), 0) <= 200 and coalesce(length(conditions_text), 0) <= 2000 and coalesce(length(source), 0) <= 500
    and coalesce(length(verified_by), 0) <= 200 and coalesce(length(notes), 0) <= 4000 and coalesce(length(documented_status), 0) <= 300)
);
alter table public.agency_carrier_rules add column if not exists documented_status text;
-- Re-runnable: the category list is (re)set here, so a re-run picks up the full list.
alter table public.agency_carrier_rules drop constraint if exists agency_carrier_rules_category_check;
alter table public.agency_carrier_rules add constraint agency_carrier_rules_category_check check (category in ('state', 'commodity', 'operation_type', 'radius_miles', 'fleet_size', 'years_in_business', 'driver_age', 'driver_experience', 'vehicle_type', 'operation_class', 'vehicle_age', 'claims_3y', 'telematics', 'dashcam', 'dot_number', 'coverage_offered', 'other'));
create index if not exists agency_carrier_rules_carrier_idx on public.agency_carrier_rules (carrier_id);
create index if not exists agency_carrier_rules_agency_idx on public.agency_carrier_rules (agency_id);
create unique index if not exists agency_carrier_rules_external_ref_idx on public.agency_carrier_rules (carrier_id, external_ref) where external_ref is not null;

-- The rule's agency is its market's agency, set here; a rule can only be attached to a market of
-- the signed-in admin's own agency, and never moved to another market.
create or replace function public.agency_carrier_rules_stamp() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_agency uuid;
begin
  select c.agency_id into v_agency from public.agency_carriers c where c.id = new.carrier_id;
  if v_agency is null then
    raise exception 'Unknown market.' using errcode = '23503';
  end if;
  if auth.uid() is not null and v_agency is distinct from public.current_agency_id() then
    raise exception 'That market belongs to another agency.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.agency_id := v_agency;
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.carrier_id is distinct from old.carrier_id then
      raise exception 'A rule can''t be moved to another market.' using errcode = '22023';
    end if;
    new.agency_id := old.agency_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.agency_carrier_rules_stamp() from public, anon, authenticated;

drop trigger if exists agency_carrier_rules_stamp on public.agency_carrier_rules;
create trigger agency_carrier_rules_stamp before insert or update on public.agency_carrier_rules
  for each row execute function public.agency_carrier_rules_stamp();

alter table public.agency_carrier_rules enable row level security;

drop policy if exists "agency members read their carrier rules" on public.agency_carrier_rules;
create policy "agency members read their carrier rules" on public.agency_carrier_rules for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "agency admins add carrier rules" on public.agency_carrier_rules;
create policy "agency admins add carrier rules" on public.agency_carrier_rules for insert to authenticated
  with check (public.current_agency_id() is not null and public.is_agency_admin());

drop policy if exists "agency admins update carrier rules" on public.agency_carrier_rules;
create policy "agency admins update carrier rules" on public.agency_carrier_rules for update to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin())
  with check (agency_id = public.current_agency_id() and public.is_agency_admin());

revoke all on public.agency_carrier_rules from public, anon;
grant select, insert, update on public.agency_carrier_rules to authenticated;

-- 3. Import ------------------------------------------------------------------------------------
create table if not exists public.agency_carrier_imports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  imported_by uuid references auth.users (id) on delete set null,
  imported_at timestamptz not null default now(),
  file_name text,
  markets_added integer not null default 0,
  markets_updated integer not null default 0,
  rules_added integer not null default 0,
  rules_updated integer not null default 0
);
alter table public.agency_carrier_imports enable row level security;
drop policy if exists "agency admins read their imports" on public.agency_carrier_imports;
create policy "agency admins read their imports" on public.agency_carrier_imports for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
revoke all on public.agency_carrier_imports from public, anon;
grant select on public.agency_carrier_imports to authenticated;

create or replace function public.import_agency_carrier_directory(p_payload jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
  m jsonb;
  r jsonb;
  v_carrier uuid;
  v_rule uuid;
  v_counts jsonb;
  n_added int := 0; n_updated int := 0; n_rules_added int := 0; n_rules_updated int := 0;
  v_base text;
  t text;
begin
  if auth.uid() is null or v_agency is null or not public.is_agency_admin() then
    raise exception 'Only an agency admin can import the carrier directory.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload -> 'markets') <> 'array' or jsonb_array_length(p_payload -> 'markets') = 0 then
    raise exception 'Nothing to import.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload -> 'markets') > 500 then
    raise exception 'At most 500 markets per import.' using errcode = '22023';
  end if;

  begin  -- a sub-transaction: a dry run raises at the end and rolls back everything below
    for m in select * from jsonb_array_elements(p_payload -> 'markets') loop
      if coalesce(btrim(m ->> 'ref'), '') = '' or coalesce(btrim(m ->> 'name'), '') = '' then
        raise exception 'Every market needs a reference and a name.' using errcode = '22023';
      end if;
      if jsonb_typeof(coalesce(m -> 'rules', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(m -> 'rules', '[]'::jsonb)) > 200 then
        raise exception 'Market %: rules must be a list of at most 200.', m ->> 'ref' using errcode = '22023';
      end if;
      v_base := nullif(btrim(m ->> 'baseRecordId'), '');
      if v_base is not null and v_base !~ '^[a-z0-9_]{1,100}$' then
        raise exception 'Market %: baseRecordId is not a built-in market id.', m ->> 'ref' using errcode = '22023';
      end if;
      -- Existing market, in this order: by import reference; the agency's own market the admin chose
      -- to link (linkTo); the agency's version of the chosen built-in (baseRecordId); its name (not archived).
      select c.id into v_carrier from public.agency_carriers c where c.agency_id = v_agency and c.external_ref = m ->> 'ref';
      if v_carrier is null and nullif(m ->> 'linkTo', '') is not null then
        if (m ->> 'linkTo') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'Market %: linkTo is not a market id.', m ->> 'ref' using errcode = '22023';
        end if;
        select c.id into v_carrier from public.agency_carriers c where c.agency_id = v_agency and c.id = (m ->> 'linkTo')::uuid;
        if v_carrier is null then
          raise exception 'Market %: the market to link to is not one of your agency''s markets.', m ->> 'ref' using errcode = '22023';
        end if;
      end if;
      if v_carrier is null and v_base is not null then
        select c.id into v_carrier from public.agency_carriers c where c.agency_id = v_agency and c.base_record_id = v_base;
      end if;
      if v_carrier is null then
        select c.id into v_carrier from public.agency_carriers c
         where c.agency_id = v_agency and c.archived_at is null and lower(btrim(c.name)) = lower(btrim(m ->> 'name'))
         order by c.created_at limit 1;
      end if;
      -- Two imported markets never merge into one: a market already holding another import
      -- reference is not linked again (separate programs and rules stay separate).
      if v_carrier is not null and exists (select 1 from public.agency_carriers c where c.id = v_carrier and c.external_ref is not null and c.external_ref <> m ->> 'ref') then
        raise exception 'Market %: % is already linked to import reference %.', m ->> 'ref',
          (select name from public.agency_carriers where id = v_carrier), (select external_ref from public.agency_carriers where id = v_carrier) using errcode = '22023';
      end if;

      if v_carrier is null then
        insert into public.agency_carriers (agency_id, base_record_id, name, market_type, source, external_ref)
        values (v_agency, v_base, btrim(m ->> 'name'), case when m ->> 'marketType' = 'mga' then 'mga' else 'direct' end, 'import', m ->> 'ref')
        returning id into v_carrier;
        n_added := n_added + 1;
      else
        n_updated := n_updated + 1;
      end if;

      -- Carrier 101 fields only — never name, criteria or rule_strictness of an existing market.
      update public.agency_carriers set
        external_ref = coalesce(external_ref, m ->> 'ref'),
        access_route = nullif(m ->> 'accessRoute', ''),
        access_status = nullif(m ->> 'accessStatus', ''),
        mga_name = nullif(btrim(m ->> 'mga'), ''),
        wholesaler_name = nullif(btrim(m ->> 'wholesaler'), ''),
        paper_carrier = nullif(btrim(m ->> 'paper'), ''),
        portal_name = nullif(btrim(m ->> 'portalName'), ''),
        portal_url = nullif(btrim(m ->> 'portalUrl'), ''),
        submission_email = nullif(btrim(m ->> 'submissionEmail'), ''),
        producer_code = nullif(btrim(m ->> 'producerCode'), ''),
        appointment_status = nullif(btrim(m ->> 'appointment'), ''),
        appointment_notes = nullif(btrim(m ->> 'appointmentNotes'), ''),
        contacts = coalesce(m -> 'contacts', '[]'::jsonb),
        access_source = nullif(btrim(m ->> 'source'), ''),
        access_source_date = nullif(m ->> 'sourceDate', '')::date,
        access_verified_at = nullif(m ->> 'verifiedAt', '')::date,
        access_notes = nullif(btrim(m ->> 'notes'), ''),
        access_documented_status = nullif(btrim(m ->> 'documentedStatus'), '')
      where id = v_carrier;

      for r in select * from jsonb_array_elements(coalesce(m -> 'rules', '[]'::jsonb)) loop
        if coalesce(btrim(r ->> 'ref'), '') = '' then
          raise exception 'Market %: every rule needs a reference.', m ->> 'ref' using errcode = '22023';
        end if;
        select id into v_rule from public.agency_carrier_rules where carrier_id = v_carrier and external_ref = r ->> 'ref';
        if v_rule is null then
          insert into public.agency_carrier_rules (agency_id, carrier_id, external_ref, coverage, category, operator, value, answer, strength, conditions, conditions_text, source, source_date, last_verified_at, verified_by, notes, documented_status)
          values (v_agency, v_carrier, r ->> 'ref', nullif(r ->> 'coverage', ''), r ->> 'category', r ->> 'operator', r -> 'value', r ->> 'answer', coalesce(nullif(r ->> 'strength', ''), 'soft'),
                  coalesce(r -> 'conditions', '[]'::jsonb), nullif(btrim(r ->> 'conditionsText'), ''), nullif(btrim(r ->> 'source'), ''), nullif(r ->> 'sourceDate', '')::date,
                  nullif(r ->> 'lastVerifiedAt', '')::date, nullif(btrim(r ->> 'verifiedBy'), ''), nullif(btrim(r ->> 'notes'), ''), nullif(btrim(r ->> 'documentedStatus'), ''));
          n_rules_added := n_rules_added + 1;
        else
          update public.agency_carrier_rules set
            coverage = nullif(r ->> 'coverage', ''), category = r ->> 'category', operator = r ->> 'operator', value = r -> 'value', answer = r ->> 'answer',
            strength = coalesce(nullif(r ->> 'strength', ''), 'soft'), conditions = coalesce(r -> 'conditions', '[]'::jsonb), conditions_text = nullif(btrim(r ->> 'conditionsText'), ''),
            source = nullif(btrim(r ->> 'source'), ''), source_date = nullif(r ->> 'sourceDate', '')::date, last_verified_at = nullif(r ->> 'lastVerifiedAt', '')::date,
            verified_by = nullif(btrim(r ->> 'verifiedBy'), ''), notes = nullif(btrim(r ->> 'notes'), ''), documented_status = nullif(btrim(r ->> 'documentedStatus'), ''), archived_at = null
          where id = v_rule;
          n_rules_updated := n_rules_updated + 1;
        end if;
        v_rule := null;
      end loop;
      v_carrier := null;
    end loop;

    v_counts := jsonb_build_object('marketsAdded', n_added, 'marketsUpdated', n_updated, 'rulesAdded', n_rules_added, 'rulesUpdated', n_rules_updated, 'dryRun', p_dry_run);
    if p_dry_run then
      raise exception using errcode = 'P0001', message = 'release_dry_run', detail = v_counts::text;
    end if;
    insert into public.agency_carrier_imports (agency_id, imported_by, file_name, markets_added, markets_updated, rules_added, rules_updated)
    values (v_agency, auth.uid(), left(p_payload ->> 'fileName', 300), n_added, n_updated, n_rules_added, n_rules_updated);
  exception when sqlstate 'P0001' then
    get stacked diagnostics t = message_text;
    if t <> 'release_dry_run' then raise; end if;
    get stacked diagnostics t = pg_exception_detail;
    return t::jsonb;
  end;
  return v_counts;
end;
$$;
revoke all on function public.import_agency_carrier_directory(jsonb, boolean) from public, anon;
grant execute on function public.import_agency_carrier_directory(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
