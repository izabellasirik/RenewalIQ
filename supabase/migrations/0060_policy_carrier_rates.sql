-- 0060 Carrier commission % per policy / endorsement: the share of the net premium the carrier pays the
-- agency (10% unless an admin sets the policy's own). The agent's commission is their % of that.
--
-- Only the agency's admins can set it (through set_policy_carrier_rate, which keeps a history). Admins
-- read every rate in the agency; an agent reads only the rates on accounts assigned to them, which the
-- app needs to work out their commission. Records only: nothing here moves money. Re-runnable.

create table if not exists public.policy_carrier_rates (
  submission_id text not null references public.submissions (id) on delete cascade,
  policy_id text not null check (length(policy_id) between 1 and 100),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  rate numeric(7, 6) not null check (rate >= 0 and rate <= 1),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (submission_id, policy_id)
);
create index if not exists policy_carrier_rates_agency on public.policy_carrier_rates (agency_id);
alter table public.policy_carrier_rates enable row level security;

create table if not exists public.policy_carrier_rate_history (
  id bigserial primary key,
  submission_id text not null,
  policy_id text not null,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  old_rate numeric(7, 6),
  new_rate numeric(7, 6),
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);
alter table public.policy_carrier_rate_history enable row level security;

drop policy if exists policy_carrier_rates_read on public.policy_carrier_rates;
create policy policy_carrier_rates_read on public.policy_carrier_rates for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and (public.is_agency_admin()
         or exists (select 1 from public.submissions s where s.id = submission_id and s.assigned_user_id = auth.uid()))
  );
drop policy if exists policy_carrier_rate_history_read on public.policy_carrier_rate_history;
create policy policy_carrier_rate_history_read on public.policy_carrier_rate_history for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());

revoke all on public.policy_carrier_rates from public, anon, authenticated;
revoke all on public.policy_carrier_rate_history from public, anon, authenticated;
grant select on public.policy_carrier_rates to authenticated;
grant select on public.policy_carrier_rate_history to authenticated;

-- An admin sets a policy's carrier commission % (0–1), or clears it (null) to go back to the 10% default.
create or replace function public.set_policy_carrier_rate(p_submission_id text, p_policy_id text, p_rate numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  v_before numeric;
begin
  if auth.uid() is null or a is null or not public.is_agency_admin() then
    raise exception 'Only an agency admin can set a carrier commission.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.submissions where id = p_submission_id and organization_id = a) then
    raise exception 'That account isn''t in your agency.' using errcode = '42501';
  end if;
  if p_policy_id is null or length(p_policy_id) not between 1 and 100 then
    raise exception 'Unknown policy.' using errcode = '22023';
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate > 1) then
    raise exception 'The carrier commission must be between 0%% and 100%%.' using errcode = '22023';
  end if;
  select rate into v_before from public.policy_carrier_rates where submission_id = p_submission_id and policy_id = p_policy_id;
  if p_rate is null then
    delete from public.policy_carrier_rates where submission_id = p_submission_id and policy_id = p_policy_id;
  else
    insert into public.policy_carrier_rates (submission_id, policy_id, agency_id, rate, updated_by, updated_at)
    values (p_submission_id, p_policy_id, a, p_rate, auth.uid(), now())
    on conflict (submission_id, policy_id) do update set rate = excluded.rate, agency_id = excluded.agency_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  if v_before is distinct from p_rate then
    insert into public.policy_carrier_rate_history (submission_id, policy_id, agency_id, old_rate, new_rate, changed_by)
    values (p_submission_id, p_policy_id, a, v_before, p_rate, auth.uid());
  end if;
end $$;
revoke all on function public.set_policy_carrier_rate(text, text, numeric) from public, anon;
grant execute on function public.set_policy_carrier_rate(text, text, numeric) to authenticated;

notify pgrst, 'reload schema';
