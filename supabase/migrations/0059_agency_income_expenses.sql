-- 0059 Agency income and expenses: the money coming in (carrier commission, agency fees…) and going out
-- (rent, marketing, payroll…) that the agency's admins record, so the owner can see whether the agency
-- makes or loses money. Records only: nothing here moves money.
--
-- Only the agency's admins can see or change them (agents can't, not even their own agency's). Who
-- created or last changed an entry, and when, is stamped by the database. Re-runnable.

create table if not exists public.agency_money_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  entry_date date not null,
  category text not null check (length(btrim(category)) between 1 and 80),
  description text not null default '' check (length(description) <= 300),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents < 100000000000),
  notes text not null default '' check (length(notes) <= 2000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists agency_money_entries_agency_date on public.agency_money_entries (agency_id, entry_date);

-- Stamps who and when; an entry can't be moved to another agency or have its history rewritten.
create or replace function public.agency_money_entries_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.agency_id := old.agency_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists agency_money_entries_stamp on public.agency_money_entries;
create trigger agency_money_entries_stamp before insert or update on public.agency_money_entries
  for each row execute function public.agency_money_entries_stamp();

alter table public.agency_money_entries enable row level security;
drop policy if exists agency_money_entries_admin on public.agency_money_entries;
create policy agency_money_entries_admin on public.agency_money_entries
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin())
  with check (agency_id = public.current_agency_id() and public.is_agency_admin());

revoke all on public.agency_money_entries from public, anon;
grant select, insert, update, delete on public.agency_money_entries to authenticated;

notify pgrst, 'reload schema';
