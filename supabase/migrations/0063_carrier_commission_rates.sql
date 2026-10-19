-- 0063 Carrier commission % per carrier, from a date: the share of the net premium a carrier pays the
-- agency, as the agency arranged it with that carrier (10% where no rate is set). The agent's commission
-- does NOT depend on it: an agent always gets their % of 10% of the net premium.
--
-- Rates are effective-dated and never rewritten: changing a carrier's % adds a rate from a date, so a
-- policy or endorsement uses the rate in force on its bound / endorsed date, and commissions already
-- recorded (0064) keep the rate they were recorded with. A rate set by mistake is retired (with a reason),
-- never deleted; a new rate for the same carrier and date replaces the earlier one the same way. Each
-- rate can carry its evidence (the agreement or statement it comes from) — separate from a policy's proof.
--
-- Carrier agreements are confidential: only the agency's admins can read or set them. Records only:
-- nothing here moves money. Re-runnable.
--
-- Also makes 0060's per-policy rates (policy_carrier_rates), which the app no longer reads, readable by
-- admins only (0060 also let an agent read the rate on their own accounts). Their rows are left as they are.

-- One carrier however it's typed ("Granite  Mutual " = "granite mutual"); the app uses the same rule.
create or replace function public.carrier_key(p_carrier text) returns text
language sql immutable set search_path = ''
as $$ select lower(regexp_replace(btrim(coalesce(p_carrier, '')), '\s+', ' ', 'g')) $$;

-- An earlier draft of 0063 (one rate per carrier, no dates) was only ever applied to test copies; if it's
-- there, keep its rows aside instead of mixing them in.
do $$
begin
  if to_regclass('public.carrier_commission_rates') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'carrier_commission_rates' and column_name = 'effective_from') then
    alter table public.carrier_commission_rates rename to carrier_commission_rates_draft;
    revoke all on public.carrier_commission_rates_draft from public, anon, authenticated;
    if to_regclass('public.carrier_commission_rate_history') is not null then
      alter table public.carrier_commission_rate_history rename to carrier_commission_rate_history_draft;
      revoke all on public.carrier_commission_rate_history_draft from public, anon, authenticated;
    end if;
  end if;
end $$;
drop function if exists public.set_carrier_commission_rate(text, numeric);

create table if not exists public.carrier_commission_rates (
  id bigint generated always as identity primary key,
  agency_id uuid not null references public.agencies (id),
  carrier_key text not null check (length(carrier_key) between 1 and 200),
  carrier_name text not null check (length(carrier_name) between 1 and 200),
  rate numeric(7, 6) not null check (rate >= 0 and rate <= 1),
  effective_from date not null,
  evidence text check (length(evidence) <= 500),
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references auth.users (id) on delete set null,
  retired_reason text check (length(retired_reason) <= 500),
  constraint carrier_commission_rates_retired check ((retired_at is null) = (retired_reason is null))
);
create unique index if not exists carrier_commission_rates_one_per_date on public.carrier_commission_rates (agency_id, carrier_key, effective_from) where retired_at is null;
create index if not exists carrier_commission_rates_lookup on public.carrier_commission_rates (agency_id, carrier_key, effective_from desc);
alter table public.carrier_commission_rates enable row level security;

-- A rate is history: it can only be retired, once; never changed or deleted.
create or replace function public.carrier_commission_rates_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Carrier rates are kept as history: retire a rate instead of deleting it.' using errcode = '42501';
  end if;
  if old.retired_at is not null
     or (new.agency_id, new.carrier_key, new.carrier_name, new.rate, new.effective_from, new.evidence, new.set_by, new.set_at)
        is distinct from (old.agency_id, old.carrier_key, old.carrier_name, old.rate, old.effective_from, old.evidence, old.set_by, old.set_at) then
    raise exception 'A carrier rate can''t be changed: add a rate from a new date, or retire this one.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists carrier_commission_rates_guard on public.carrier_commission_rates;
create trigger carrier_commission_rates_guard before update or delete on public.carrier_commission_rates
  for each row execute function public.carrier_commission_rates_guard();

drop policy if exists carrier_commission_rates_read on public.carrier_commission_rates;
create policy carrier_commission_rates_read on public.carrier_commission_rates for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
revoke all on public.carrier_commission_rates from public, anon, authenticated;
grant select on public.carrier_commission_rates to authenticated;

-- The rate in force for a carrier on a date (the latest one starting on or before it), or none.
create or replace function public.carrier_rate_on(p_agency uuid, p_carrier_key text, p_date date)
returns public.carrier_commission_rates
language sql stable security definer set search_path = ''
as $$
  select r.* from public.carrier_commission_rates r
   where r.agency_id = p_agency and r.carrier_key = p_carrier_key and r.retired_at is null and r.effective_from <= p_date
   order by r.effective_from desc, r.set_at desc
   limit 1
$$;
revoke all on function public.carrier_rate_on(uuid, text, date) from public, anon, authenticated;

-- An admin sets a carrier's commission % (0–1) from a date, with optional evidence. A rate already set for
-- that carrier and date is retired in its favour (kept in the history). Returns the new rate's id.
create or replace function public.set_carrier_commission_rate(p_carrier text, p_rate numeric, p_effective_from date, p_evidence text default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  k text := public.carrier_key(p_carrier);
  new_id bigint;
begin
  if auth.uid() is null or a is null or not public.is_agency_admin() then
    raise exception 'Only an agency admin can set a carrier commission.' using errcode = '42501';
  end if;
  if length(k) not between 1 and 200 then raise exception 'Name the carrier.' using errcode = '22023'; end if;
  if p_rate is null or p_rate < 0 or p_rate > 1 then
    raise exception 'The carrier commission must be between 0%% and 100%%.' using errcode = '22023';
  end if;
  if p_effective_from is null then raise exception 'Choose the date the rate applies from.' using errcode = '22023'; end if;
  if length(coalesce(p_evidence, '')) > 500 then raise exception 'The evidence note is too long (500 characters at most).' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(a::text || k, 1063));
  update public.carrier_commission_rates set retired_at = now(), retired_by = auth.uid(), retired_reason = 'Replaced by a new rate from the same date.'
   where agency_id = a and carrier_key = k and effective_from = p_effective_from and retired_at is null;
  insert into public.carrier_commission_rates (agency_id, carrier_key, carrier_name, rate, effective_from, evidence, set_by)
  values (a, k, btrim(p_carrier), p_rate, p_effective_from, nullif(btrim(coalesce(p_evidence, '')), ''), auth.uid())
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.set_carrier_commission_rate(text, numeric, date, text) from public, anon;
grant execute on function public.set_carrier_commission_rate(text, numeric, date, text) to authenticated;

-- An admin retires a rate set by mistake (with a reason). Policies then use the rate before it, if any.
create or replace function public.retire_carrier_commission_rate(p_id bigint, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
begin
  if auth.uid() is null or a is null or not public.is_agency_admin() then
    raise exception 'Only an agency admin can retire a carrier commission.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Say why the rate is retired.' using errcode = '22023'; end if;
  if length(p_reason) > 500 then raise exception 'The reason is too long (500 characters at most).' using errcode = '22023'; end if;
  update public.carrier_commission_rates set retired_at = now(), retired_by = auth.uid(), retired_reason = btrim(p_reason)
   where id = p_id and agency_id = a and retired_at is null;
  if not found then raise exception 'That rate doesn''t exist or is already retired.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.retire_carrier_commission_rate(bigint, text) from public, anon;
grant execute on function public.retire_carrier_commission_rate(bigint, text) to authenticated;

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
