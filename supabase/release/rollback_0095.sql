-- Rollback of 0095: removes the cancelled-policy premiums admins entered.
begin;
drop table if exists public.agency_qq_premiums;
drop function if exists public.agency_qq_premiums_stamp();
notify pgrst, 'reload schema';
commit;
