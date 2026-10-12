-- REMOVE 0049 COMPLETELY — DESTRUCTIVE. Deletes every agency's Carrier 101 access details, Carrier 102
-- rules and import log. Markets themselves (agency_carriers rows, their names and appetite criteria)
-- are kept. Only for abandoning the feature; rollback_0049.sql is the normal rollback (no change).
--
-- Refuses to run unless the session confirms it:
--   set renewaliq.confirm_remove_0049 = 'yes';
-- Re-running 0049 afterwards recreates the empty structure.

do $$
begin
  if coalesce(current_setting('renewaliq.confirm_remove_0049', true), '') <> 'yes' then
    raise exception 'Refusing: set renewaliq.confirm_remove_0049 = ''yes'' first (this deletes Carrier 101/102 data).';
  end if;
end $$;

begin;
drop function if exists public.import_agency_carrier_directory(jsonb, boolean);
drop table if exists public.agency_carrier_imports;
drop table if exists public.agency_carrier_rules;
drop function if exists public.agency_carrier_rules_stamp();
drop index if exists public.agency_carriers_external_ref_idx;
alter table public.agency_carriers
  drop constraint if exists agency_carriers_access_route_check,
  drop constraint if exists agency_carriers_access_status_check,
  drop constraint if exists agency_carriers_portal_url_check,
  drop constraint if exists agency_carriers_contacts_check,
  drop constraint if exists agency_carriers_access_text_check,
  drop column if exists access_route, drop column if exists access_status, drop column if exists mga_name,
  drop column if exists wholesaler_name, drop column if exists paper_carrier, drop column if exists portal_name,
  drop column if exists portal_url, drop column if exists submission_email, drop column if exists producer_code,
  drop column if exists appointment_status, drop column if exists appointment_notes, drop column if exists contacts,
  drop column if exists access_source, drop column if exists access_source_date, drop column if exists access_verified_at,
  drop column if exists access_notes, drop column if exists access_documented_status;
commit;
notify pgrst, 'reload schema';
