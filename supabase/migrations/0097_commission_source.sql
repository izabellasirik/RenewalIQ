-- 0097 Where an agency's carrier commission and agent payouts come from in Analytics: 'policies' (worked
-- out from the policies and endorsements — the default, as before) or 'statements' (the agency imports its
-- weekly income & expense statements, and those amounts are used instead). Every member can read it; only
-- the agency's admins can change it. Re-runnable.

alter table public.agencies add column if not exists commission_source text not null default 'policies';
alter table public.agencies drop constraint if exists agencies_commission_source_check;
alter table public.agencies add constraint agencies_commission_source_check check (commission_source in ('policies', 'statements'));

create or replace function public.agency_commission_source()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.commission_source from public.agencies a where a.id = public.current_agency_id()), 'policies')
$$;

create or replace function public.set_agency_commission_source(p_source text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.current_agency_id() is null or not public.is_agency_admin() then
    raise exception 'Only an agency admin can change this.' using errcode = '42501';
  end if;
  if p_source not in ('policies', 'statements') then
    raise exception 'Unknown setting.' using errcode = '22023';
  end if;
  update public.agencies set commission_source = p_source where id = public.current_agency_id();
  return p_source;
end $$;

revoke execute on function public.agency_commission_source() from public, anon;
revoke execute on function public.set_agency_commission_source(text) from public, anon;
grant execute on function public.agency_commission_source() to authenticated;
grant execute on function public.set_agency_commission_source(text) to authenticated;

notify pgrst, 'reload schema';
