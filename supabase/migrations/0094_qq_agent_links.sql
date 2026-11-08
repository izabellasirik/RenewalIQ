-- 0094 Endorsement reports: which RenewalIQ agent a QQCatalyst agent name is ("LEONID PETROV" → Leo),
-- for names the app can't match on its own. Set by the agency's admins; one link per name. Re-runnable.

create table if not exists public.agency_qq_agent_links (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  qq_name text not null check (length(qq_name) between 1 and 200),
  user_id uuid not null references auth.users(id) on delete cascade,
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now(),
  primary key (agency_id, qq_name)
);

create or replace function public.agency_qq_agent_links_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.agency_id := old.agency_id;
    new.qq_name := old.qq_name;
  end if;
  -- The linked person must be in the same agency.
  if not exists (select 1 from public.profiles p where p.user_id = new.user_id and p.agency_id = new.agency_id) then
    raise exception 'That person is not in this agency.';
  end if;
  new.set_by := auth.uid();
  new.set_at := now();
  return new;
end $$;
drop trigger if exists agency_qq_agent_links_stamp on public.agency_qq_agent_links;
create trigger agency_qq_agent_links_stamp before insert or update on public.agency_qq_agent_links
  for each row execute function public.agency_qq_agent_links_stamp();

alter table public.agency_qq_agent_links enable row level security;
drop policy if exists agency_qq_agent_links_admin on public.agency_qq_agent_links;
create policy agency_qq_agent_links_admin on public.agency_qq_agent_links for all to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin())
  with check (agency_id = public.current_agency_id() and public.is_agency_admin());
revoke all on public.agency_qq_agent_links from public, anon;
grant select, insert, update, delete on public.agency_qq_agent_links to authenticated;

notify pgrst, 'reload schema';
