-- 0073 Carrier % per policy / endorsement, entered by the agent (or an admin) when the market is Bound or
-- Endorsed. Needs 0063, 0064 and 0067 (0065 not needed).
--
--   carrier commission = net × the carrier % entered on that policy / endorsement
--   agent commission   = carrier commission × the agent's split            (as in 0067)
--
-- - The % is entered by hand for every new policy and endorsement (never filled in), more than 0% and at
--   most 50%. It's kept in its own table, readable only through the functions below: the assigned agent and
--   the agency's admins set it; collaborators on the account don't see it.
-- - A commission record uses that % instead of the carrier's rate set by an admin. When both exist and
--   differ, the record is flagged "carrier_rate_differs" for the admin (not blocking).
-- - Setting the % again changes the record only while it's unverified, open and not historical (the admin
--   still verifies every record before it's payable). A verified record keeps its rate.
-- - Records already recorded keep their amounts (nothing is recalculated); policies without an entered %
--   work exactly as before (the carrier's rate, or "no carrier rate").
-- Re-runnable. Rollback: supabase/release/rollback_0073.sql.

do $$
begin
  if to_regclass('public.commission_transactions') is null or to_regclass('public.carrier_commission_rates') is null
     or to_regprocedure('public.finance_agent_cents(bigint,numeric,numeric)') is null then
    raise exception '0073 needs 0063, 0064 and 0067.';
  end if;
end $$;

create table if not exists public.policy_carrier_commission (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  submission_id text not null references public.submissions (id) on delete cascade,
  policy_id text not null,
  rate numeric not null check (rate > 0 and rate <= 0.5),
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (submission_id, policy_id)
);
alter table public.policy_carrier_commission enable row level security;
revoke all on public.policy_carrier_commission from public, anon, authenticated;

-- The new rate source.
alter table public.commission_transactions drop constraint if exists commission_transactions_carrier_rate_source_check;
alter table public.commission_transactions add constraint commission_transactions_carrier_rate_source_check
  check (carrier_rate_source in ('carrier_rate', 'default', 'historical', 'confirmed', 'actual', 'policy_rate'));

-- 0067's guard, plus: the policy's carrier % may change an unverified, open, non-historical record.
create or replace function public.commission_transactions_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  op text := coalesce(current_setting('renewaliq.finance_op', true), '');
begin
  if tg_op = 'DELETE' then
    raise exception 'Commission records are kept: void or correct them instead of deleting.' using errcode = '42501';
  end if;
  if (new.id, new.agency_id, new.submission_id, new.client_name, new.quote_id, new.policy_id, new.kind, new.stream, new.origin, new.cancellation_id,
      new.policy_number, new.carrier_name, new.carrier_key, new.business_type, new.event_date, new.payable_from, new.net_cents, new.base_rate,
      new.recorded_snapshot, new.created_by, new.created_at)
     is distinct from
     (old.id, old.agency_id, old.submission_id, old.client_name, old.quote_id, old.policy_id, old.kind, old.stream, old.origin, old.cancellation_id,
      old.policy_number, old.carrier_name, old.carrier_key, old.business_type, old.event_date, old.payable_from, old.net_cents, old.base_rate,
      old.recorded_snapshot, old.created_by, old.created_at) then
    raise exception 'A commission record''s policy, date and amounts can''t be changed: add a correction instead.' using errcode = '42501';
  end if;
  if (new.agent_user_id, new.agent_name, new.agent_rate, new.agent_cents, new.carrier_rate, new.carrier_rate_id, new.carrier_rate_source, new.carrier_cents)
     is distinct from (old.agent_user_id, old.agent_name, old.agent_rate, old.agent_cents, old.carrier_rate, old.carrier_rate_id, old.carrier_rate_source, old.carrier_cents)
     and not (op = 'confirm_historical' and old.origin = 'historical' and old.verification_status = 'unverified' and old.settlement = 'open' and old.rate_confirmed_at is null)
     and not (op = 'fill_carrier_rate' and old.verification_status = 'unverified' and old.settlement = 'open' and 'no_carrier_rate' = any (old.review_flags)
              and (new.agent_user_id, new.agent_name, new.agent_rate) is not distinct from (old.agent_user_id, old.agent_name, old.agent_rate))
     and not (op = 'policy_carrier_rate' and old.verification_status = 'unverified' and old.settlement = 'open' and old.origin <> 'historical'
              and old.kind in ('policy', 'endorsement')
              and (new.agent_user_id, new.agent_name, new.agent_rate) is not distinct from (old.agent_user_id, old.agent_name, old.agent_rate))
     and not (op = 'resolve_agent' and old.verification_status = 'unverified' and old.settlement = 'open' and (old.agent_user_id is null or old.agent_rate is null)
              and (old.agent_user_id is null or new.agent_user_id = old.agent_user_id)
              and (new.carrier_rate, new.carrier_rate_id, new.carrier_rate_source, new.carrier_cents) is not distinct from (old.carrier_rate, old.carrier_rate_id, old.carrier_rate_source, old.carrier_cents)) then
    raise exception 'The agent, split, rates and amounts are frozen when a commission is recorded.' using errcode = '42501';
  end if;
  if new.original_transaction_id is distinct from old.original_transaction_id
     and not (old.kind = 'endorsement' and old.verification_status = 'unverified'
              and (old.original_transaction_id is null
                   or exists (select 1 from public.commission_transactions x where x.id = old.original_transaction_id and x.verification_status = 'void'))) then
    raise exception 'A commission record''s link can''t be changed.' using errcode = '42501';
  end if;
  if new.replaced_by is distinct from old.replaced_by and not ((old.replaced_by is null or old.replaced_by = old.id) and new.verification_status = 'void') then
    raise exception 'Only a voided record can be replaced, once.' using errcode = '42501';
  end if;
  if new.verification_status is distinct from old.verification_status and old.verification_status <> 'unverified' then
    raise exception 'A verified or voided commission keeps its status: add a correction or a cancellation.' using errcode = '42501';
  end if;
  if old.verification_status <> 'unverified'
     and (new.verified_by, new.verified_at, new.verified_without_proof, new.verification_reason, new.void_reason, new.voided_by, new.voided_at)
         is distinct from (old.verified_by, old.verified_at, old.verified_without_proof, old.verification_reason, old.void_reason, old.voided_by, old.voided_at) then
    raise exception 'A verification or void can''t be changed.' using errcode = '42501';
  end if;
  if new.settlement is distinct from old.settlement and not (old.settlement = 'open' and new.settlement = 'settled_outside') then
    raise exception 'A commission settled outside RenewalIQ stays settled.' using errcode = '42501';
  end if;
  if old.settlement <> 'open' and (new.settled_by, new.settled_at, new.settled_reason) is distinct from (old.settled_by, old.settled_at, old.settled_reason) then
    raise exception 'A settlement can''t be changed.' using errcode = '42501';
  end if;
  if old.rate_confirmed_at is not null and (new.rate_evidence, new.rate_confirmed_by, new.rate_confirmed_at) is distinct from (old.rate_evidence, old.rate_confirmed_by, old.rate_confirmed_at) then
    raise exception 'Confirmed rates can''t be changed.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 0067's recording, plus: the policy's own carrier % first.
create or replace function public.finance_record_entry(p_sub public.submissions, p_quote_id text, p jsonb, p_origin text, p_keep public.commission_transactions default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := p_sub.organization_id;
  k text := case when p ->> 'kind' = 'endorsement' then 'endorsement' else 'policy' end;
  snap jsonb := public.finance_entry_snapshot(p);
  net bigint := public.finance_cents(p -> 'netPremiumCents');
  d date := public.finance_date(p ->> 'boundDate');
  ck text := public.carrier_key(p ->> 'carrier');
  cname text := left(coalesce(nullif(btrim(p ->> 'carrier'), ''), 'Unknown carrier'), 200);
  agent uuid; aname text; arate numeric; from_hist boolean := false;
  cr public.carrier_commission_rates;
  prate numeric;
  crate numeric; crate_id bigint; csource text;
  flags text[] := '{}';
  link uuid;
  started timestamptz;
  created timestamptz;
  new_id uuid;
begin
  if a is null then return null; end if;
  perform public.finance_ensure_settings(a);
  if ck = '' then ck := 'unknown carrier'; flags := flags || 'invalid_carrier'::text; end if;
  if net is null then net := 0; flags := flags || 'invalid_amount'::text; end if;
  if d is null then d := current_date; flags := flags || 'invalid_date'::text; end if;

  if p_keep.id is not null then
    agent := p_keep.agent_user_id; aname := p_keep.agent_name; arate := p_keep.agent_rate;
    flags := flags || (select coalesce(array_agg(f), '{}') from unnest(p_keep.review_flags) f
                        where f in ('no_agent', 'no_agent_rate', 'historical', 'uncertain_carrier_rate', 'uncertain_agent', 'uncertain_agent_rate', 'created_before_ledger'));
  else
    select pr.user_id, coalesce(nullif(btrim(pr.display_name), ''), pr.email) into agent, aname
      from public.profiles pr where pr.user_id = p_sub.assigned_user_id and pr.agency_id = a;
    if agent is null then
      flags := flags || 'no_agent'::text;
    else
      if p_origin = 'historical' then
        select r.rate, r.from_history into arate, from_hist from public.finance_agent_rate_on(a, agent, d) r;
      else
        select c.rate into arate from public.agent_commission_rates c where c.agency_id = a and c.user_id = agent;
      end if;
      if arate is null then flags := flags || 'no_agent_rate'::text; end if;
    end if;
  end if;

  if p_keep.id is not null and p_keep.carrier_key = ck and p_keep.event_date = d and not ('no_carrier_rate' = any (p_keep.review_flags)) then
    crate := p_keep.carrier_rate; crate_id := p_keep.carrier_rate_id; csource := p_keep.carrier_rate_source;
    if 'default_carrier_rate' = any (p_keep.review_flags) then flags := flags || 'default_carrier_rate'::text; end if;
  else
    cr := public.carrier_rate_on(a, ck, d);
    select r.rate into prate from public.policy_carrier_commission r where r.submission_id = p_sub.id and r.policy_id = p ->> 'id';
    -- The carrier % the agent entered on this policy / endorsement (0073) is the one used; the carrier's
    -- rate set by an admin is only compared with it.
    if prate is not null then
      crate := prate; crate_id := null; csource := 'policy_rate';
      if cr.id is not null and cr.rate <> prate then flags := flags || 'carrier_rate_differs'::text; end if;
    elsif cr.id is not null then crate := cr.rate; crate_id := cr.id; csource := 'carrier_rate';
    -- No carrier % set for this carrier on this date: no commission until one is (flagged; never paid).
    else crate := 0; crate_id := null; csource := 'default'; flags := flags || 'no_carrier_rate'::text;
    end if;
    if p_origin = 'historical' then csource := 'historical'; end if;
  end if;
  if p_origin = 'historical' and p_keep.id is null then
    flags := flags || array['historical', 'uncertain_carrier_rate', 'uncertain_agent'];
    if agent is not null and not from_hist then flags := flags || 'uncertain_agent_rate'::text; end if;
  end if;

  if k = 'endorsement' then
    select t.id into link from public.commission_transactions t
     where t.agency_id = a and t.submission_id = p_sub.id and t.policy_id = p ->> 'forPolicyId' and t.kind = 'policy'
       and t.replaced_by is null and t.verification_status <> 'void';
    if link is null and p_keep.id is not null and p_keep.kind = 'endorsement' then link := p_keep.original_transaction_id; end if;
    if link is null then flags := flags || 'unlinked_endorsement'::text; end if;
  end if;
  select s.ledger_started_at into started from public.finance_settings s where s.agency_id = a;
  created := public.finance_timestamp(p ->> 'createdAt');
  if p_origin = 'recorded' and p_keep.id is null and created is not null and created < started then flags := flags || 'created_before_ledger'::text; end if;
  if p ->> 'removedAt' is not null then flags := flags || 'removed'::text; end if;

  insert into public.commission_transactions (
    agency_id, submission_id, client_name, quote_id, policy_id, kind, stream, origin, original_transaction_id,
    policy_number, carrier_name, carrier_key, business_type, event_date, payable_from, net_cents,
    agent_user_id, agent_name, agent_rate, agent_cents, carrier_rate, carrier_rate_id, carrier_rate_source, carrier_cents,
    recorded_snapshot, proof_status, review_flags, created_by)
  values (
    a, p_sub.id, left(coalesce(p_sub.named_insured, ''), 300), p_quote_id, p ->> 'id', k, case when k = 'policy' then 'weekly' else 'monthly' end, p_origin, link,
    left(p ->> 'policyNumber', 100), cname, ck, case when k = 'policy' then (case when p ->> 'businessType' = 'renewal' then 'renewal' else 'new' end) end, d, d, net,
    agent, aname, arate, case when 'no_carrier_rate' = any (flags) then null else public.finance_agent_cents(net, crate, arate) end, crate, crate_id, csource, public.finance_apply_rate(net, crate),
    snap, case when jsonb_typeof(p -> 'attachments') = 'array' and jsonb_array_length(p -> 'attachments') > 0 then 'has_proof' else 'missing_proof' end,
    (select coalesce(array_agg(distinct f order by f), '{}') from unnest(flags) f), auth.uid())
  on conflict (agency_id, submission_id, policy_id) where policy_id is not null and replaced_by is null do nothing
  returning id into new_id;
  if new_id is not null then
    perform public.finance_audit(a, 'recorded', 'transaction', new_id::text, null,
      jsonb_build_object('origin', p_origin, 'kind', k, 'policyNumber', snap ->> 'policyNumber', 'netCents', net, 'agentRate', arate, 'carrierRate', crate, 'flags', flags));
  end if;
  return new_id;
end $$;

-- The assigned agent (or an admin of the account's agency) sets the carrier % (0–1, e.g. 0.12) of one policy
-- or endorsement on the account. Returns 'saved' (no record yet: used when it's recorded), 'applied' (its
-- unverified record now uses it) or 'locked' (its record is already verified or settled: nothing changed).
create or replace function public.enter_policy_carrier_rate(p_submission_id text, p_policy_id text, p_rate numeric) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s public.submissions;
  t public.commission_transactions;
  cr public.carrier_commission_rates;
  fl text[];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into s from public.submissions x where x.id = p_submission_id;
  if s.id is null or s.organization_id is null or s.organization_id is distinct from public.current_agency_id()
     or not (public.is_agency_admin() or s.assigned_user_id = auth.uid()) then
    raise exception 'Only the assigned agent or an agency admin can set the carrier %% on this account.' using errcode = '42501';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate > 0.5 then
    raise exception 'Enter a carrier %% above 0%% and at most 50%%.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_policy_id, '')), '') is null then raise exception 'Missing policy.' using errcode = '22023'; end if;

  select * into t from public.commission_transactions x
   where x.agency_id = s.organization_id and x.submission_id = s.id and x.policy_id = p_policy_id and x.replaced_by is null
     and x.verification_status <> 'void'
   for update;
  if t.id is not null and (t.verification_status <> 'unverified' or t.settlement <> 'open' or t.origin = 'historical') then
    return 'locked';
  end if;

  insert into public.policy_carrier_commission (agency_id, submission_id, policy_id, rate, set_by)
  values (s.organization_id, s.id, p_policy_id, p_rate, auth.uid())
  on conflict (submission_id, policy_id) do update set rate = excluded.rate, set_by = excluded.set_by, set_at = now(), agency_id = excluded.agency_id;
  if t.id is null then return 'saved'; end if;

  cr := public.carrier_rate_on(t.agency_id, t.carrier_key, t.event_date);
  fl := array_remove(array_remove(t.review_flags, 'no_carrier_rate'), 'carrier_rate_differs');
  if cr.id is not null and cr.rate <> p_rate then fl := fl || 'carrier_rate_differs'::text; end if;
  perform set_config('renewaliq.finance_op', 'policy_carrier_rate', true);
  update public.commission_transactions
     set carrier_rate = p_rate, carrier_rate_id = null, carrier_rate_source = 'policy_rate', carrier_cents = public.finance_apply_rate(t.net_cents, p_rate),
         agent_cents = public.finance_agent_cents(t.net_cents, p_rate, t.agent_rate), review_flags = fl
   where id = t.id;
  perform set_config('renewaliq.finance_op', '', true);
  perform public.finance_audit(t.agency_id, 'policy_carrier_rate_set', 'transaction', t.id::text, null,
    jsonb_build_object('from', t.carrier_rate, 'to', p_rate, 'source', t.carrier_rate_source));
  return 'applied';
end $$;
revoke all on function public.enter_policy_carrier_rate(text, text, numeric) from public, anon;
grant execute on function public.enter_policy_carrier_rate(text, text, numeric) to authenticated;

notify pgrst, 'reload schema';
