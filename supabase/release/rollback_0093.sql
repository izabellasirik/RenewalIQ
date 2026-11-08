-- Rollback of 0093: removes uploaded endorsement reports and the rates set on them (the rows read from them are deleted).
begin;
drop table if exists public.agency_qq_rates;
drop function if exists public.agency_qq_rates_stamp();
drop table if exists public.agency_qq_reports;
drop function if exists public.agency_qq_reports_stamp();
notify pgrst, 'reload schema';
commit;
