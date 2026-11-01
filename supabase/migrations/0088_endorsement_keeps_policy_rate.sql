-- 0088 Commissions keep the agent % of their policy. A recorded policy already keeps the % it was recorded with,
-- and a cancellation refunds at that % (0076/0077). Now a new endorsement on a policy also uses that policy's
-- agent %, when it's the same agent, so a raise (30% → 40%) doesn't change commissions on policies written before.
-- The account's commission list also returns each record's agent and %, so the app's preview matches.
-- Needs 0073. Replaces two functions; records already made don't change; re-runnable.
-- Rollback: supabase/release/rollback_0088.sql.

do $$
begin
  if to_regclass('public.policy_carrier_commission') is null then raise exception '0088 needs 0073.'; end if;
end $$;

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
  lagent uuid; lrate numeric;
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
    -- 0088: a new endorsement on a policy uses the agent % that policy was recorded with (a raise or a cut later on
    -- doesn't change commissions on policies written before it), when it's the same agent.
    if link is not null and p_keep.id is null and agent is not null then
      select t.agent_user_id, t.agent_rate into lagent, lrate from public.commission_transactions t where t.id = link;
      if lagent = agent and lrate is not null then
        arate := lrate;
        flags := array_remove(flags, 'no_agent_rate');
      end if;
    end if;
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

drop function if exists public.account_commission_statuses(text);
create function public.account_commission_statuses(p_submission_id text)
returns table (transaction_id uuid, policy_id text, kind text, status text, flags text[], expected_pay_date date, agent_cents bigint, agent_user_id uuid, agent_rate numeric)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.policy_id, t.kind, public.finance_status(t),
         array(select f from unnest(t.review_flags) f where f in ('unlinked_endorsement', 'changed_since_recorded', 'removed', 'no_agent', 'no_agent_rate')),
         public.finance_pay_date(t.agency_id, t.stream, t.payable_from), t.agent_cents, t.agent_user_id, t.agent_rate
    from public.commission_transactions t
   where auth.uid() is not null and t.agency_id = public.current_agency_id() and t.submission_id = p_submission_id and t.policy_id is not null and t.replaced_by is null
     and (public.is_agency_admin() or t.agent_user_id = auth.uid())
$$;
revoke all on function public.account_commission_statuses(text) from public, anon;
grant execute on function public.account_commission_statuses(text) to authenticated;

notify pgrst, 'reload schema';
