-- 0067 Agent commission = the agent's split of the carrier commission (needs 0063 and 0064; 0065 optional).
--
--   carrier commission = net × the carrier's commission % (on the bound / endorsed date)
--   agent commission   = carrier commission × the agent's split        e.g. $10,000 × 12% = $1,200 × 25% = $300
--
-- Until now the agent's split applied to 10% of the net. From this migration on:
-- - A policy or endorsement whose carrier has no % set on its date is recorded without a commission and
--   flagged "no_carrier_rate" (it can't be verified or paid). When an admin sets that carrier's % from a
--   date on or before it, the record gets the rate and its amounts (audited) while it's still unverified.
-- - The rate is fixed when recorded: a later change of the carrier's % doesn't change it.
-- - Cancellations and corrections use the original record's carrier % and split, so a refund takes back
--   exactly what was paid.
-- - Agents see their own records' carrier % with their commission (my_commissions), never other carriers'.
-- Records already recorded keep their amounts (nothing is recalculated). base_rate is no longer used.
-- Re-creates 0064's functions that work out the agent commission (otherwise as in the final 0064).
-- Re-runnable. Refuses to run without 0063 and 0064.

do $$
begin
  if to_regclass('public.commission_transactions') is null or to_regclass('public.carrier_commission_rates') is null then
    raise exception '0067 needs 0063 and 0064.';
  end if;
end $$;

-- The agent's commission: net × carrier % × split, rounded at each step. Null without a split or carrier %.
create or replace function public.finance_agent_cents(p_net bigint, p_carrier_rate numeric, p_agent_rate numeric) returns bigint
language sql immutable set search_path = ''
as $$ select case when p_agent_rate is null or p_carrier_rate is null then null else public.finance_apply_rate(public.finance_apply_rate(p_net, p_carrier_rate), p_agent_rate) end $$;
revoke all on function public.finance_agent_cents(bigint, numeric, numeric) from public, anon, authenticated;

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

create or replace function public.finance_blocking_flags(p_flags text[]) returns text[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(f order by f), '{}') from unnest(p_flags) f
   where f in ('no_agent', 'no_agent_rate', 'unlinked_endorsement', 'changed_since_recorded', 'removed', 'account_deleted', 'invalid_amount', 'invalid_date', 'invalid_carrier', 'no_carrier_rate')
$$;

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
    if cr.id is not null then crate := cr.rate; crate_id := cr.id; csource := 'carrier_rate';
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

create or replace function public.confirm_historical_commission(p_id uuid, p_agent_user_id uuid, p_agent_rate numeric, p_carrier_rate numeric, p_evidence text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_id);
  aname text;
  evidence text := public.finance_require_text(p_evidence, 'Say what the rates are based on (the evidence).');
begin
  if t.origin <> 'historical' then raise exception 'Only historical records are confirmed this way.' using errcode = '22023'; end if;
  if t.verification_status <> 'unverified' or t.settlement <> 'open' or t.rate_confirmed_at is not null then
    raise exception 'This record is no longer waiting for review.' using errcode = '22023';
  end if;
  if p_agent_rate is null or p_agent_rate < 0 or p_agent_rate > 1 or p_carrier_rate is null or p_carrier_rate < 0 or p_carrier_rate > 1 then
    raise exception 'Rates are between 0%% and 100%%.' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(pr.display_name), ''), pr.email) into aname from public.profiles pr where pr.user_id = p_agent_user_id and pr.agency_id = t.agency_id;
  if aname is null then raise exception 'Choose an agent from your agency.' using errcode = '22023'; end if;
  perform set_config('renewaliq.finance_op', 'confirm_historical', true);
  update public.commission_transactions
     set agent_user_id = p_agent_user_id, agent_name = aname, agent_rate = p_agent_rate, agent_cents = public.finance_agent_cents(t.net_cents, p_carrier_rate, p_agent_rate),
         carrier_rate = p_carrier_rate, carrier_rate_id = null, carrier_rate_source = 'confirmed', carrier_cents = public.finance_apply_rate(t.net_cents, p_carrier_rate),
         rate_evidence = evidence, rate_confirmed_by = auth.uid(), rate_confirmed_at = now(),
         review_flags = array(select f from unnest(t.review_flags) f where f not in ('uncertain_carrier_rate', 'uncertain_agent', 'uncertain_agent_rate', 'no_agent', 'no_agent_rate', 'default_carrier_rate', 'no_carrier_rate'))
   where id = t.id;
  perform set_config('renewaliq.finance_op', '', true);
  perform public.finance_audit(t.agency_id, 'historical_confirmed', 'transaction', t.id::text, evidence,
    jsonb_build_object('before', jsonb_build_object('agent', t.agent_user_id, 'agentRate', t.agent_rate, 'carrierRate', t.carrier_rate),
                       'after', jsonb_build_object('agent', p_agent_user_id, 'agentRate', p_agent_rate, 'carrierRate', p_carrier_rate)));
end $$;

create or replace function public.resolve_commission_agent(p_id uuid, p_agent_user_id uuid, p_agent_rate numeric, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_id);
  reason text := public.finance_require_text(p_reason, 'Say how the agent and split were decided.');
  aname text;
begin
  if t.kind not in ('policy', 'endorsement') or t.verification_status <> 'unverified' or t.settlement <> 'open' then
    raise exception 'Only an unverified policy or endorsement is resolved this way.' using errcode = '22023';
  end if;
  if t.origin = 'historical' and t.rate_confirmed_at is null then
    raise exception 'Confirm this historical record instead: that sets its agent, split and carrier rate.' using errcode = '22023';
  end if;
  if t.agent_user_id is not null and t.agent_rate is not null then
    raise exception 'This commission already has its agent and split; they stay as recorded.' using errcode = '22023';
  end if;
  if t.agent_user_id is not null and p_agent_user_id is distinct from t.agent_user_id then
    raise exception 'The agent stays as recorded; only the missing split is added.' using errcode = '22023';
  end if;
  if p_agent_rate is null or p_agent_rate < 0 or p_agent_rate > 1 then raise exception 'The split is between 0%% and 100%%.' using errcode = '22023'; end if;
  select coalesce(nullif(btrim(pr.display_name), ''), pr.email) into aname from public.profiles pr where pr.user_id = p_agent_user_id and pr.agency_id = t.agency_id;
  if aname is null then raise exception 'Choose an agent from your agency.' using errcode = '22023'; end if;
  perform set_config('renewaliq.finance_op', 'resolve_agent', true);
  update public.commission_transactions
     set agent_user_id = p_agent_user_id, agent_name = coalesce(t.agent_name, aname), agent_rate = p_agent_rate,
         agent_cents = case when 'no_carrier_rate' = any (t.review_flags) then null else public.finance_agent_cents(t.net_cents, t.carrier_rate, p_agent_rate) end,
         review_flags = array(select f from unnest(t.review_flags) f where f not in ('no_agent', 'no_agent_rate'))
   where id = t.id;
  perform set_config('renewaliq.finance_op', '', true);
  perform public.finance_audit(t.agency_id, 'agent_resolved', 'transaction', t.id::text, reason,
    jsonb_build_object('before', jsonb_build_object('agent', t.agent_user_id, 'agentRate', t.agent_rate, 'agentCents', t.agent_cents),
                       'after', jsonb_build_object('agent', p_agent_user_id, 'agentRate', p_agent_rate, 'agentCents', case when 'no_carrier_rate' = any (t.review_flags) then null else public.finance_agent_cents(t.net_cents, t.carrier_rate, p_agent_rate) end)));
end $$;

create or replace function public.correct_commission(p_id uuid, p_new_net_cents bigint, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_id);
  reason text := public.finance_require_text(p_reason, 'Say why the commission is corrected.');
  cur_net bigint; cur_agent bigint; cur_carrier bigint;
  new_id uuid;
  cur jsonb;
begin
  if t.kind not in ('policy', 'endorsement') then raise exception 'Correct the original policy or endorsement.' using errcode = '22023'; end if;
  if t.verification_status <> 'verified' and t.settlement <> 'settled_outside' then
    raise exception 'Verify the commission first (or record it again while it''s unverified).' using errcode = '22023';
  end if;
  if t.verification_status = 'void' then raise exception 'This commission is void.' using errcode = '22023'; end if;
  if p_new_net_cents is null or abs(p_new_net_cents) >= 100000000000 then raise exception 'Enter the corrected net premium.' using errcode = '22023'; end if;
  if t.kind = 'policy' and p_new_net_cents < 0 then raise exception 'A policy''s net premium can''t be negative.' using errcode = '22023'; end if;
  select t.net_cents + coalesce(sum(c.net_cents), 0), coalesce(t.agent_cents, 0) + coalesce(sum(c.agent_cents), 0), t.carrier_cents + coalesce(sum(c.carrier_cents), 0)
    into cur_net, cur_agent, cur_carrier
    from public.commission_transactions c where c.original_transaction_id = t.id and c.kind = 'correction' and c.verification_status <> 'void';
  if p_new_net_cents = cur_net then raise exception 'That''s the net premium already recorded.' using errcode = '22023'; end if;
  insert into public.commission_transactions (
    agency_id, submission_id, client_name, quote_id, kind, stream, origin, original_transaction_id, policy_number, carrier_name, carrier_key, business_type,
    event_date, payable_from, net_cents, agent_user_id, agent_name, agent_rate, agent_cents, carrier_rate, carrier_rate_id, carrier_rate_source, carrier_cents,
    recorded_snapshot, proof_status, verification_status, verified_by, verified_at, verification_reason, created_by)
  values (
    t.agency_id, t.submission_id, t.client_name, t.quote_id, 'correction', t.stream, 'admin', t.id, t.policy_number, t.carrier_name, t.carrier_key, t.business_type,
    current_date, current_date, p_new_net_cents - cur_net, t.agent_user_id, t.agent_name, t.agent_rate,
    case when t.agent_rate is null then null else public.finance_agent_cents(p_new_net_cents, t.carrier_rate, t.agent_rate) - cur_agent end,
    t.carrier_rate, t.carrier_rate_id, t.carrier_rate_source, public.finance_apply_rate(p_new_net_cents, t.carrier_rate) - cur_carrier,
    jsonb_build_object('correctedNetCents', p_new_net_cents, 'previousNetCents', cur_net), t.proof_status, 'verified', auth.uid(), now(), reason, auth.uid())
  returning id into new_id;
  cur := public.finance_current_entry(t);
  update public.commission_transactions
     set acknowledged_snapshot = jsonb_set(coalesce(public.finance_entry_snapshot(cur), coalesce(t.acknowledged_snapshot, t.recorded_snapshot)), '{netPremiumCents}', to_jsonb(p_new_net_cents)),
         review_flags = array_remove(t.review_flags, 'changed_since_recorded')
   where id = t.id;
  perform public.finance_audit(t.agency_id, 'corrected', 'transaction', t.id::text, reason,
    jsonb_build_object('correction', new_id, 'fromNetCents', cur_net, 'toNetCents', p_new_net_cents));
  return new_id;
end $$;

create or replace function public.approve_commission_cancellation(p_id uuid, p_returned_net_cents bigint, p_carrier_adjustment_cents bigint,
  p_note text default null, p_without_proof_reason text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  c public.commission_cancellations := public.finance_lock_cancellation(p_id);
  t public.commission_transactions;
  remaining bigint;
  new_id uuid;
  no_proof boolean := cardinality(c.document_ids) = 0;
begin
  select * into t from public.commission_transactions where id = c.transaction_id for update;
  if t.verification_status <> 'verified' and t.settlement <> 'settled_outside' then
    raise exception 'Verify the original policy first (or void it if it was never written).' using errcode = '22023';
  end if;
  if p_returned_net_cents is null or p_returned_net_cents <= 0 then raise exception 'Enter the actual net premium returned by the carrier.' using errcode = '22023'; end if;
  if p_carrier_adjustment_cents is null or p_carrier_adjustment_cents < 0 then raise exception 'Enter the actual carrier commission returned (0 if none).' using errcode = '22023'; end if;
  remaining := public.finance_remaining_net(t.id);
  -- An endorsement's refund also has to fit in what's left on its policy (a policy cancellation may have returned it).
  if t.kind = 'endorsement' and t.original_transaction_id is not null then remaining := least(remaining, public.finance_remaining_net(t.original_transaction_id)); end if;
  if p_returned_net_cents > remaining then
    raise exception 'That''s more than the % net premium left on the policy.', to_char(remaining / 100.0, 'FM999,999,999,990.00') using errcode = '22023';
  end if;
  if no_proof then perform public.finance_require_text(p_without_proof_reason, 'Approving without the cancellation notice is an exception: give the reason.'); end if;
  insert into public.commission_transactions (
    agency_id, submission_id, client_name, quote_id, kind, stream, origin, original_transaction_id, cancellation_id, policy_number, carrier_name, carrier_key, business_type,
    event_date, payable_from, net_cents, agent_user_id, agent_name, agent_rate, agent_cents, carrier_rate, carrier_rate_id, carrier_rate_source, carrier_cents,
    recorded_snapshot, proof_status, verification_status, verified_by, verified_at, verified_without_proof, verification_reason, created_by)
  values (
    t.agency_id, t.submission_id, t.client_name, t.quote_id, 'cancellation', t.stream, 'admin', t.id, c.id, t.policy_number, t.carrier_name, t.carrier_key, t.business_type,
    c.effective_date, current_date, -p_returned_net_cents, t.agent_user_id, t.agent_name, t.agent_rate, public.finance_agent_cents(-p_returned_net_cents, t.carrier_rate, t.agent_rate),
    t.carrier_rate, t.carrier_rate_id, 'actual', -p_carrier_adjustment_cents,
    jsonb_build_object('cancelType', c.cancel_type, 'effectiveDate', c.effective_date, 'returnedNetCents', p_returned_net_cents, 'carrierAdjustmentCents', p_carrier_adjustment_cents),
    case when no_proof then 'missing_proof' else 'has_proof' end, 'verified', auth.uid(), now(), no_proof,
    coalesce(nullif(btrim(coalesce(p_without_proof_reason, '')), ''), nullif(btrim(coalesce(p_note, '')), '')), auth.uid())
  returning id into new_id;
  update public.commission_cancellations
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         returned_net_cents = p_returned_net_cents, carrier_adjustment_cents = p_carrier_adjustment_cents, result_transaction_id = new_id
   where id = c.id;
  perform public.finance_audit(t.agency_id, 'cancellation_approved', 'cancellation', c.id::text, coalesce(p_without_proof_reason, p_note),
    jsonb_build_object('transaction', new_id, 'returnedNetCents', p_returned_net_cents, 'carrierAdjustmentCents', p_carrier_adjustment_cents, 'withoutProof', no_proof));
  return new_id;
end $$;

-- The old formula (net × 10% × split) is gone, so nothing can use it by mistake.
drop function if exists public.finance_agent_cents(bigint, numeric);

comment on column public.commission_transactions.base_rate is 'Not used from 0067: the agent''s split applies to the carrier commission (carrier_rate).';

-- An admin sets a carrier's % from a date: records of that carrier from then on that were waiting for it
-- (unverified, flagged no_carrier_rate) get the rate in force on their own date, and their amounts.
create or replace function public.finance_fill_carrier_rates() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions;
  cr public.carrier_commission_rates;
  n integer := 0;
begin
  if new.retired_at is not null then return null; end if;
  perform set_config('renewaliq.finance_op', 'fill_carrier_rate', true);
  for t in select * from public.commission_transactions x
            where x.agency_id = new.agency_id and x.carrier_key = new.carrier_key and x.kind in ('policy', 'endorsement') and x.origin <> 'historical'
              and x.replaced_by is null and x.verification_status = 'unverified' and x.settlement = 'open'
              and 'no_carrier_rate' = any (x.review_flags) and x.event_date >= new.effective_from
            order by x.created_at
            for update loop
    cr := public.carrier_rate_on(t.agency_id, t.carrier_key, t.event_date);
    continue when cr.id is null;
    update public.commission_transactions
       set carrier_rate = cr.rate, carrier_rate_id = cr.id, carrier_rate_source = 'carrier_rate', carrier_cents = public.finance_apply_rate(t.net_cents, cr.rate),
           agent_cents = public.finance_agent_cents(t.net_cents, cr.rate, t.agent_rate),
           review_flags = array_remove(t.review_flags, 'no_carrier_rate')
     where id = t.id;
    n := n + 1;
  end loop;
  perform set_config('renewaliq.finance_op', '', true);
  if n > 0 then
    perform public.finance_audit(new.agency_id, 'carrier_rate_filled', 'carrier_rate', new.id::text, null,
      jsonb_build_object('carrier', new.carrier_key, 'effectiveFrom', new.effective_from, 'records', n));
  end if;
  return null;
end $$;
revoke all on function public.finance_fill_carrier_rates() from public, anon, authenticated;
drop trigger if exists finance_fill_carrier_rates on public.carrier_commission_rates;
create trigger finance_fill_carrier_rates after insert on public.carrier_commission_rates
  for each row execute function public.finance_fill_carrier_rates();

-- Agents see their own records' carrier % (not other carriers', not the carrier commission amount).
drop function if exists public.my_commissions();
create or replace function public.my_commissions()
returns table (id uuid, kind text, submission_id text, client_name text, policy_id text, policy_number text, carrier_name text, event_date date,
               payable_from date, expected_pay_date date, net_cents bigint, agent_rate numeric, agent_cents bigint, status text, original_transaction_id uuid,
               carrier_rate numeric)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.kind, t.submission_id, t.client_name, t.policy_id, t.policy_number, t.carrier_name, t.event_date, t.payable_from,
         public.finance_pay_date(t.agency_id, t.stream, t.payable_from), t.net_cents, t.agent_rate, t.agent_cents, public.finance_status(t), t.original_transaction_id,
         case when 'no_carrier_rate' = any (t.review_flags) then null else t.carrier_rate end
    from public.commission_transactions t
   where auth.uid() is not null and t.agency_id = public.current_agency_id() and t.agent_user_id = auth.uid() and t.replaced_by is null
   order by t.event_date desc, t.created_at desc
$$;
revoke all on function public.my_commissions() from public, anon;
grant execute on function public.my_commissions() to authenticated;

notify pgrst, 'reload schema';
