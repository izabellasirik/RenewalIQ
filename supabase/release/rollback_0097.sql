-- Rollback of 0097: Analytics takes commission from the policies again for every agency.
begin;
drop function if exists public.set_agency_commission_source(text);
drop function if exists public.agency_commission_source();
alter table public.agencies drop constraint if exists agencies_commission_source_check;
alter table public.agencies drop column if exists commission_source;
notify pgrst, 'reload schema';
commit;
