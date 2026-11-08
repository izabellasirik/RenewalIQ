-- 0093 Endorsement reports: QQCatalyst reports (Endorsements, Cancelled policies) an admin uploads under
-- Analytics → Endorsement reports. The app reads the PDF in the browser and saves the rows it read, so
-- the analytics are there for every admin of the agency. Only the agency's admins can see, add or delete
-- them (as income and expenses, 0059). Who uploaded and when is stamped by the database. Re-runnable.

create table if not exists public.agency_qq_reports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null check (kind in ('endorsements', 'cancellations')),
  title text not null default '' check (length(title) <= 200),
  period text not null default '' check (length(period) <= 300),
  file_name text not null default '' check (length(file_name) <= 300),
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) <= 20000),
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists agency_qq_reports_agency on public.agency_qq_reports (agency_id, uploaded_at desc);

create or replace function public.agency_qq_reports_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.uploaded_by := auth.uid();
  new.uploaded_at := now();
  return new;
end $$;
drop trigger if exists agency_qq_reports_stamp on public.agency_qq_reports;
create trigger agency_qq_reports_stamp before insert on public.agency_qq_reports
  for each row execute function public.agency_qq_reports_stamp();

alter table public.agency_qq_reports enable row level security;
drop policy if exists agency_qq_reports_admin_select on public.agency_qq_reports;
create policy agency_qq_reports_admin_select on public.agency_qq_reports for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists agency_qq_reports_admin_insert on public.agency_qq_reports;
create policy agency_qq_reports_admin_insert on public.agency_qq_reports for insert to authenticated
  with check (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists agency_qq_reports_admin_delete on public.agency_qq_reports;
create policy agency_qq_reports_admin_delete on public.agency_qq_reports for delete to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());

-- The agency commission rate of an endorsement, when an admin set it (otherwise the app uses 10%).
-- Keyed by the endorsement (date, amount, client, agent, description), so it holds for the same row
-- in any report uploaded later.
create table if not exists public.agency_qq_rates (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  row_key text not null check (length(row_key) between 1 and 2000),
  rate numeric(7,4) not null check (rate >= 0 and rate <= 1),
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now(),
  primary key (agency_id, row_key)
);
create or replace function public.agency_qq_rates_stamp()
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
drop trigger if exists agency_qq_rates_stamp on public.agency_qq_rates;
create trigger agency_qq_rates_stamp before insert or update on public.agency_qq_rates
  for each row execute function public.agency_qq_rates_stamp();
alter table public.agency_qq_rates enable row level security;
drop policy if exists agency_qq_rates_admin on public.agency_qq_rates;
create policy agency_qq_rates_admin on public.agency_qq_rates for all to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin())
  with check (agency_id = public.current_agency_id() and public.is_agency_admin());
revoke all on public.agency_qq_rates from public, anon;
grant select, insert, update, delete on public.agency_qq_rates to authenticated;

-- Read and delete only: an uploaded report is never edited (upload it again instead).
revoke all on public.agency_qq_reports from public, anon;
grant select, insert, delete on public.agency_qq_reports to authenticated;

notify pgrst, 'reload schema';
