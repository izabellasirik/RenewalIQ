-- ROLLBACK 0049 — for running the PREVIOUS app version again on a database that has 0049.
--
-- 0049 only adds things: new columns on agency_carriers (all nullable or defaulted), two new tables
-- (agency_carrier_rules, agency_carrier_imports) and one function (import_agency_carrier_directory).
-- The previous app reads agency_carriers with select('*') and never touches the rest, so NOTHING has
-- to change: redeploy the previous app and leave the data (an agency's imported directory and rules)
-- in place for when the new app is back. This file only checks that state.
--
-- To remove 0049 completely (abandoning the feature and its data), see remove_0049.sql.

select
  (select count(*) from public.agency_carriers) as markets,
  (select count(*) from public.agency_carriers where access_status is not null) as markets_with_access,
  (select count(*) from public.agency_carrier_rules) as rules,
  (select count(*) from public.agency_carrier_imports) as imports;
