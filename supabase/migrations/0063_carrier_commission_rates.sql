-- 0063 Carrier commission % per carrier: the share of the net premium a carrier pays the agency, as the
-- agency arranged it with that carrier (10% unless an admin sets the carrier's own). It applies to every
-- policy and endorsement written with that carrier, and it is the agency's income on them. The agent's
-- commission does NOT depend on it: an agent always gets their % of 10% of the net premium.
--
-- Carrier agreements are confidential: only the agency's admins can read or set them, through
-- set_carrier_commission_rate, which keeps a history of every change. Records only: nothing here moves
-- money. Re-runnable.
--
-- Replaces 0060's per-policy rates (policy_carrier_rates), which this app no longer reads. Those tables
-- and their rows are left as they are (nothing is deleted or copied); only who can read them changes:
-- admins only, as for the per-carrier rates (0060 also let an agent read the rates on their own accounts).

-- One carrier however it's typed ("Granite  Mutual " = "granite mutual"); the app uses the same rule.
create or replace function public.carrier_key(p_carrier text) returns text
language sql immutable set search_path = ''
as $$ select lower(regexp_replace(btrim(coalesce(p_carrier, '')), '\s+', ' ', 'g')) $$;

create table if not exists public.carrier_commission_rates (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  carrier_key text not null check (length(carrier_key) between 1 and 200),
  carrier_name text not null check (length(carrier_name) between 1 and 200),
  rate numeric(7, 6) not null check (rate >= 0 and rate <= 1),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (agency_id, carrier_key)
);
alter table public.carrier_commission_rates enable row level security;

create table if not exists public.carrier_commission_rate_history (
  id bigserial primary key,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  carrier_key text not null,
  carrier_name text not null,
  old_rate numeric(7, 6),
  new_rate numeric(7, 6),
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists carrier_commission_rate_history_carrier on public.carrier_commission_rate_history (agency_id, carrier_key, changed_at);
alter table public.carrier_commission_rate_history enable row level security;

drop policy if exists carrier_commission_rates_read on public.carrier_commission_rates;
create policy carrier_commission_rates_read on public.carrier_commission_rates for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists carrier_commission_rate_history_read on public.carrier_commission_rate_history;
create policy carrier_commission_rate_history_read on public.carrier_commission_rate_history for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());

revoke all on public.carrier_commission_rates from public, anon, authenticated;
revoke all on public.carrier_commission_rate_history from public, anon, authenticated;
grant select on public.carrier_commission_rates to authenticated;
grant select on public.carrier_commission_rate_history to authenticated;

-- An admin sets a carrier's commission % (0–1) for the agency, or clears it (null) to go back to 10%.
create or replace function public.set_carrier_commission_rate(p_carrier text, p_rate numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  k text := public.carrier_key(p_carrier);
  v_before numeric;
begin
  if auth.uid() is null or a is null or not public.is_agency_admin() then
    raise exception 'Only an agency admin can set a carrier commission.' using errcode = '42501';
  end if;
  if length(k) not between 1 and 200 then
    raise exception 'Name the carrier.' using errcode = '22023';
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate > 1) then
    raise exception 'The carrier commission must be between 0%% and 100%%.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(a::text || k, 1060));
  select rate into v_before from public.carrier_commission_rates where agency_id = a and carrier_key = k;
  if p_rate is null then
    delete from public.carrier_commission_rates where agency_id = a and carrier_key = k;
  else
    insert into public.carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, updated_by, updated_at)
    values (a, k, btrim(p_carrier), p_rate, auth.uid(), now())
    on conflict (agency_id, carrier_key) do update set rate = excluded.rate, carrier_name = excluded.carrier_name, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  if v_before is distinct from p_rate then
    insert into public.carrier_commission_rate_history (agency_id, carrier_key, carrier_name, old_rate, new_rate, changed_by)
    values (a, k, btrim(p_carrier), v_before, p_rate, auth.uid());
  end if;
end $$;
revoke all on function public.set_carrier_commission_rate(text, numeric) from public, anon;
grant execute on function public.set_carrier_commission_rate(text, numeric) to authenticated;

-- 0060's per-policy rates, where present: admins only from now on.
do $$
begin
  if to_regclass('public.policy_carrier_rates') is not null then
    drop policy if exists policy_carrier_rates_read on public.policy_carrier_rates;
    create policy policy_carrier_rates_read on public.policy_carrier_rates for select to authenticated
      using (agency_id = public.current_agency_id() and public.is_agency_admin());
  end if;
end $$;

notify pgrst, 'reload schema';
