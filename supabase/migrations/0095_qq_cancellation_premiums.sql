-- 0095 Endorsement reports → cancellation chargebacks: the annual premium of a cancelled policy when an
-- admin enters or corrects it (otherwise the app takes it from the client's policy in RenewalIQ).
-- Keyed by the cancellation (effective date, cancellation date, insured). Admins only. Re-runnable.

create table if not exists public.agency_qq_premiums (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  row_key text not null check (length(row_key) between 1 and 600),
  premium_cents bigint not null check (premium_cents >= 0 and premium_cents < 100000000000),
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now(),
  primary key (agency_id, row_key)
);

create or replace function public.agency_qq_premiums_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.agency_id := old.agency_id;
    new.row_key := old.row_key;
  end if;
  new.set_by := auth.uid();
  new.set_at := now();
  return new;
end $$;
drop trigger if exists agency_qq_premiums_stamp on public.agency_qq_premiums;
create trigger agency_qq_premiums_stamp before insert or update on public.agency_qq_premiums
  for each row execute function public.agency_qq_premiums_stamp();

alter table public.agency_qq_premiums enable row level security;
drop policy if exists agency_qq_premiums_admin on public.agency_qq_premiums;
create policy agency_qq_premiums_admin on public.agency_qq_premiums for all to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin())
  with check (agency_id = public.current_agency_id() and public.is_agency_admin());
revoke all on public.agency_qq_premiums from public, anon;
grant select, insert, update, delete on public.agency_qq_premiums to authenticated;

notify pgrst, 'reload schema';
