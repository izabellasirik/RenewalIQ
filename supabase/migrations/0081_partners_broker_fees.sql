-- 0081 Partnerships, referral sources and broker fee splits. Needs 0011, 0058, 0064.
--
-- * Referral sources (Team and Partners → Partnerships), managed by the agency's admins: e.g. "Safety", "DXP agency".
--   Each can have an agreed partner amount: a fixed $ the partner gets ONCE PER CLIENT, from the broker fee.
--   Agents see the names (to pick one on a new submission), never the amounts.
-- * Every account records where it came from: submissions.referral_source = a source id, or 'none' (No referral).
-- * Each agent's share of the broker fee, set by an admin on the Team tab: a fixed $ or a % of what's left after
--   the partner's amount. Agents read only their own.
-- * broker_fee_splits(from, to): every policy (not endorsements) with a broker fee bound in the range, split into
--   partner (the client's referral source, on the client's first policy with a broker fee) → agent (the account's
--   agent, their share) → agency (the rest). Admins see everything; an agent sees only their own policies and
--   their share — no partner names or amounts.
-- Partners get a share of the broker fee only, never of the carrier commission. Additive and re-runnable.
-- Rollback: supabase/release/rollback_0081.sql.

do $$
begin
  if to_regprocedure('public.current_agency_id()') is null or to_regprocedure('public.finance_entries(jsonb)') is null then
    raise exception '0081 needs 0011 and 0064.';
  end if;
end $$;

create table if not exists public.referral_sources (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- The partner's agreed amount, once per client, from the broker fee (null: no partner share).
  partner_fee_cents bigint check (partner_fee_cents is null or partner_fee_cents between 0 and 10000000),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists referral_sources_name on public.referral_sources (agency_id, lower(btrim(name)));
alter table public.referral_sources enable row level security;
-- Admins read the table (with the amounts); everyone else uses referral_source_names().
drop policy if exists referral_sources_admin_read on public.referral_sources;
create policy referral_sources_admin_read on public.referral_sources for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
revoke all on public.referral_sources from public, anon, authenticated;
grant select on public.referral_sources to authenticated;

create table if not exists public.agent_broker_fee_shares (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('amount', 'percent')),
  -- amount: cents; percent: a share between 0 and 1.
  value numeric(14, 6) not null check (value >= 0),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (agency_id, user_id),
  constraint agent_broker_fee_shares_percent check (mode <> 'percent' or value <= 1)
);
alter table public.agent_broker_fee_shares enable row level security;
drop policy if exists agent_broker_fee_shares_read on public.agent_broker_fee_shares;
create policy agent_broker_fee_shares_read on public.agent_broker_fee_shares for select to authenticated
  using (agency_id = public.current_agency_id() and (public.is_agency_admin() or user_id = auth.uid()));
revoke all on public.agent_broker_fee_shares from public, anon, authenticated;
grant select on public.agent_broker_fee_shares to authenticated;

-- Where an account came from: a referral source id, or 'none'. Unset on accounts from before.
alter table public.submissions add column if not exists referral_source text;
alter table public.submissions drop constraint if exists submissions_referral_source;
alter table public.submissions add constraint submissions_referral_source
  check (referral_source is null or referral_source = 'none' or referral_source ~ '^[0-9a-f-]{36}$');

-- Everyone in the agency: the source names, active first (no amounts).
create or replace function public.referral_source_names()
returns table (id uuid, name text, active boolean)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.name, r.active from public.referral_sources r
   where auth.uid() is not null and r.agency_id = public.current_agency_id()
   order by r.active desc, lower(r.name)
$$;
revoke all on function public.referral_source_names() from public, anon;
grant execute on function public.referral_source_names() to authenticated;

-- Admins: add (p_id null) or change a source. Returns its id.
create or replace function public.save_referral_source(p_id uuid, p_name text, p_partner_fee_cents bigint, p_active boolean default true)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  nm text := btrim(coalesce(p_name, ''));
  rid uuid;
begin
  if auth.uid() is null or a is null or not public.is_agency_admin() then raise exception 'Only an agency admin can manage partnerships.' using errcode = '42501'; end if;
  if nm = '' or length(nm) > 80 then raise exception 'Enter a name (up to 80 characters).' using errcode = '22023'; end if;
  if lower(nm) in ('none', 'no referral') then raise exception '"No referral" is always offered; choose another name.' using errcode = '22023'; end if;
  if p_partner_fee_cents is not null and (p_partner_fee_cents < 0 or p_partner_fee_cents > 10000000) then raise exception 'Enter the agreed amount in dollars.' using errcode = '22023'; end if;
  if exists (select 1 from public.referral_sources r where r.agency_id = a and lower(btrim(r.name)) = lower(nm) and r.id is distinct from p_id) then
    raise exception 'There''s already a partner called %.', nm using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.referral_sources (agency_id, name, partner_fee_cents, active, created_by) values (a, nm, p_partner_fee_cents, coalesce(p_active, true), auth.uid())
    returning id into rid;
  else
    update public.referral_sources set name = nm, partner_fee_cents = p_partner_fee_cents, active = coalesce(p_active, true), updated_at = now()
     where id = p_id and agency_id = a returning id into rid;
    if rid is null then raise exception 'No such partner.' using errcode = '42501'; end if;
  end if;
  return rid;
end $$;
revoke all on function public.save_referral_source(uuid, text, bigint, boolean) from public, anon;
grant execute on function public.save_referral_source(uuid, text, bigint, boolean) to authenticated;

-- Admins: an agent's broker fee share — 'amount' (cents) or 'percent' (0–1); null mode clears it.
create or replace function public.set_agent_broker_fee_share(p_user_id uuid, p_mode text, p_value numeric)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
begin
  if auth.uid() is null or a is null or not public.is_agency_admin() then raise exception 'Only an agency admin can set broker fee shares.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where user_id = p_user_id and agency_id = a) then raise exception 'That person isn''t a member of your agency.' using errcode = '42501'; end if;
  if p_mode is null then
    delete from public.agent_broker_fee_shares where agency_id = a and user_id = p_user_id;
    return;
  end if;
  if p_mode not in ('amount', 'percent') or p_value is null or p_value < 0 or (p_mode = 'percent' and p_value > 1) or (p_mode = 'amount' and p_value > 10000000) then
    raise exception 'Enter a dollar amount, or a %% between 0 and 100.' using errcode = '22023';
  end if;
  insert into public.agent_broker_fee_shares (agency_id, user_id, mode, value, updated_by, updated_at)
  values (a, p_user_id, p_mode, p_value, auth.uid(), now())
  on conflict (agency_id, user_id) do update set mode = excluded.mode, value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;
revoke all on function public.set_agent_broker_fee_share(uuid, text, numeric) from public, anon;
grant execute on function public.set_agent_broker_fee_share(uuid, text, numeric) to authenticated;

-- Broker fees bound in [p_from, p_to], split partner → agent → agency (see the header).
create or replace function public.broker_fee_splits(p_from date, p_to date)
returns table (submission_id text, client_name text, policy_id text, policy_number text, bound_date date, broker_fee_cents bigint,
               partner_name text, partner_cents bigint, agent_user_id uuid, agent_name text, agent_cents bigint, agency_cents bigint)
language sql stable security definer set search_path = ''
as $$
  with me as (select auth.uid() as uid, public.current_agency_id() as agency, public.is_agency_admin() as admin),
  fees as (
    select s.id as sid, s.named_insured, s.referral_source, coalesce(s.assigned_user_id, s.user_id) as agent, e.entry,
           public.finance_cents(e.entry -> 'brokerFeeCents') as fee,
           public.finance_date(left(e.entry ->> 'boundDate', 10)) as bound
      from public.submissions s, me
      cross join lateral public.finance_entries(s.market_quotes) e
     where me.uid is not null and s.organization_id = me.agency
       and (me.admin or coalesce(s.assigned_user_id, s.user_id) = me.uid)
       and coalesce(e.entry ->> 'kind', 'policy') = 'policy' and e.entry ->> 'removedAt' is null
  ),
  ranked as (
    -- The partner is paid once per client: on the client's first policy with a broker fee.
    select f.*, row_number() over (partition by f.sid order by f.bound nulls last, f.entry ->> 'createdAt', f.entry ->> 'id') as nth
      from fees f where coalesce(f.fee, 0) > 0
  ),
  split as (
    select r.*, src.name as src_name,
           case when r.nth = 1 and src.active is not null then least(coalesce(src.partner_fee_cents, 0), r.fee) else 0 end as partner
      from ranked r
      left join public.referral_sources src on src.id::text = r.referral_source
  ),
  shared as (
    select sp.*,
           case when sh.mode = 'amount' then least(sh.value::bigint, sp.fee - sp.partner)
                when sh.mode = 'percent' then round((sp.fee - sp.partner) * sh.value)::bigint
                else 0 end as agent_share
      from split sp
      left join public.agent_broker_fee_shares sh on sh.agency_id = (select agency from me) and sh.user_id = sp.agent
  )
  select x.sid, x.named_insured, x.entry ->> 'id', x.entry ->> 'policyNumber', x.bound, x.fee,
         case when (select admin from me) then x.src_name end,
         case when (select admin from me) then x.partner end,
         x.agent,
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = x.agent),
         x.agent_share,
         case when (select admin from me) then x.fee - x.partner - x.agent_share end
    from shared x
   where x.bound is not null and x.bound between coalesce(p_from, '1900-01-01') and coalesce(p_to, '2999-12-31')
   order by x.bound desc, x.named_insured
$$;
revoke all on function public.broker_fee_splits(date, date) from public, anon;
grant execute on function public.broker_fee_splits(date, date) to authenticated;

notify pgrst, 'reload schema';
