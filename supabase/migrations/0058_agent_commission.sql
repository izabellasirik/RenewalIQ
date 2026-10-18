-- Agent commission: each agent's commission percentage, set by the agency's admins (Team tab), and a
-- duplicate check for policy numbers across the agency.
--
-- An agent's commission on a policy or endorsement = its net amount × the rate of the account's
-- assigned agent. The amount is never stored on the account (anyone helping on it can read the
-- account): the app works it out on display, and only the agent and the agency's admins can read the
-- rate. Every change to a rate is kept in agent_commission_rate_history (who, when, from, to).
--
-- Who can do what (enforced here, not only on screen):
--   read a rate            the agent it belongs to, and the agency's admins
--   set / clear a rate     the agency's admins only, for members of their own agency (set_agent_commission_rate)
--   read the history       the agency's admins only
--
-- Additive; safe to run more than once.

create table if not exists public.agent_commission_rates (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rate numeric(7, 6) not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (agency_id, user_id),
  constraint agent_commission_rates_rate check (rate >= 0 and rate <= 1)
);
alter table public.agent_commission_rates enable row level security;

create table if not exists public.agent_commission_rate_history (
  id bigint generated always as identity primary key,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  user_id uuid not null,
  old_rate numeric(7, 6),
  new_rate numeric(7, 6),
  changed_by uuid,
  changed_at timestamptz not null default now()
);
alter table public.agent_commission_rate_history enable row level security;

drop policy if exists agent_commission_rates_read on public.agent_commission_rates;
create policy agent_commission_rates_read on public.agent_commission_rates for select to authenticated
  using (agency_id = public.current_agency_id() and (public.is_agency_admin() or user_id = auth.uid()));

drop policy if exists agent_commission_rate_history_read on public.agent_commission_rate_history;
create policy agent_commission_rate_history_read on public.agent_commission_rate_history for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());

-- No insert / update / delete policies: changes go through set_agent_commission_rate only.
revoke all on public.agent_commission_rates from public, anon, authenticated;
revoke all on public.agent_commission_rate_history from public, anon, authenticated;
grant select on public.agent_commission_rates to authenticated;
grant select on public.agent_commission_rate_history to authenticated;

-- Sets (p_rate between 0 and 1) or clears (null) a member's rate. Admins only, own agency only.
create or replace function public.set_agent_commission_rate(p_user_id uuid, p_rate numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  old numeric(7, 6);
begin
  if auth.uid() is null or a is null or not public.is_agency_admin() then
    raise exception 'Only an agency admin can set commission rates' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user_id and agency_id = a) then
    raise exception 'That person isn''t a member of your agency' using errcode = '42501';
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate > 1) then
    raise exception 'A commission rate is between 0%% and 100%%' using errcode = '22023';
  end if;
  select rate into old from public.agent_commission_rates where agency_id = a and user_id = p_user_id for update;
  if p_rate is null then
    delete from public.agent_commission_rates where agency_id = a and user_id = p_user_id;
  else
    insert into public.agent_commission_rates (agency_id, user_id, rate, updated_by, updated_at)
    values (a, p_user_id, p_rate, auth.uid(), now())
    on conflict (agency_id, user_id) do update set rate = excluded.rate, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  if old is distinct from p_rate::numeric(7, 6) then
    insert into public.agent_commission_rate_history (agency_id, user_id, old_rate, new_rate, changed_by)
    values (a, p_user_id, old, p_rate, auth.uid());
  end if;
end;
$$;
revoke all on function public.set_agent_commission_rate(uuid, numeric) from public, anon;
grant execute on function public.set_agent_commission_rate(uuid, numeric) to authenticated;

-- Whether a policy with this number and carrier is already recorded on another client — across the
-- whole agency (or, outside an agency, across the caller's own accounts), including clients the caller
-- can't open. Answers only yes / no: it never reveals which client.
create or replace function public.policy_number_taken(p_carrier text, p_policy_number text, p_account_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with k as (
    select upper(regexp_replace(coalesce(p_policy_number, ''), '[^A-Za-z0-9]', '', 'g')) as num, lower(btrim(coalesce(p_carrier, ''))) as carrier
  )
  select auth.uid() is not null and (select num from k) <> '' and exists (
    select 1
      from public.submissions s
     cross join lateral jsonb_array_elements(case when jsonb_typeof(s.market_quotes) = 'array' then s.market_quotes else '[]'::jsonb end) q
     cross join lateral jsonb_array_elements(case when jsonb_typeof(q -> 'policies') = 'array' then q -> 'policies' else '[]'::jsonb end) p
     where (case when public.current_agency_id() is not null then s.organization_id = public.current_agency_id()
                 else s.organization_id is null and s.user_id = auth.uid() end)
       and s.id is distinct from p_account_id
       and coalesce(p ->> 'kind', 'policy') = 'policy'
       and p ->> 'removedAt' is null
       and upper(regexp_replace(coalesce(p ->> 'policyNumber', ''), '[^A-Za-z0-9]', '', 'g')) = (select num from k)
       and lower(btrim(coalesce(p ->> 'carrier', ''))) = (select carrier from k))
$$;
revoke all on function public.policy_number_taken(text, text, text) from public, anon;
grant execute on function public.policy_number_taken(text, text, text) to authenticated;

notify pgrst, 'reload schema';
