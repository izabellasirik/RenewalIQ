-- Rollback of 0094: removes the links between QQCatalyst agent names and RenewalIQ agents.
begin;
drop table if exists public.agency_qq_agent_links;
drop function if exists public.agency_qq_agent_links_stamp();
notify pgrst, 'reload schema';
commit;
