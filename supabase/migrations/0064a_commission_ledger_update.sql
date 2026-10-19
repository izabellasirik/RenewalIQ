-- 0064a Commission records: brings a database that has the Phase 1 version of 0064 up to the final one.
-- Only needed when 08_VERIFY_installed_0063_0064_read_only.sql says "installed 0064 is: phase1".
--
-- It replaces five functions with their final versions (the same text as the final 0064) and changes no
-- table, index, trigger, policy or row:
--   commission_transactions_guard     — also lets an admin fill in a missing agent or split, once (below)
--   resolve_commission_agent          — new: fill in a missing agent or split on the record, with a reason (audited)
--   request_commission_cancellation   — cancellations can be requested on endorsements too
--   finance_remaining_net             — counts what cancellations of a policy's endorsements returned
--   approve_commission_cancellation   — an endorsement's cancellation follows the monthly schedule, and
--                                       never refunds more than is left on the endorsement or its policy
-- Re-runnable. Refuses to run unless 0064 is installed.

do $$
begin
  if to_regclass('public.commission_transactions') is null or to_regclass('public.finance_ledger_install') is null then
    raise exception '0064 isn''t installed: apply 0064_commission_ledger.sql (the final version) instead of this.';
  end if;
  if to_regprocedure('public.finance_agent_cents(bigint, numeric, numeric)') is not null then
    raise exception '0067 is installed: 0064a isn''t needed (and would bring back the old commission formula).';
  end if;
end $$;

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

-- A record saved without an agent or without the agent's split: an admin fills in only what's missing, with a
-- reason, on the record itself (the policy stays as it is). An agent already recorded is never changed.
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
         agent_cents = public.finance_agent_cents(t.net_cents, p_agent_rate),
         review_flags = array(select f from unnest(t.review_flags) f where f not in ('no_agent', 'no_agent_rate'))
   where id = t.id;
  perform set_config('renewaliq.finance_op', '', true);
  perform public.finance_audit(t.agency_id, 'agent_resolved', 'transaction', t.id::text, reason,
    jsonb_build_object('before', jsonb_build_object('agent', t.agent_user_id, 'agentRate', t.agent_rate, 'agentCents', t.agent_cents),
                       'after', jsonb_build_object('agent', p_agent_user_id, 'agentRate', p_agent_rate, 'agentCents', public.finance_agent_cents(t.net_cents, p_agent_rate))));
end $$;

-- An agent working on the account (or an admin) requests a cancellation of a policy or an endorsement.
create or replace function public.request_commission_cancellation(p_transaction_id uuid, p_cancel_type text, p_effective_date date, p_reason text,
  p_expected_refund_cents bigint default null, p_document_ids text[] default '{}') returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  t public.commission_transactions;
  reason text := public.finance_require_text(p_reason, 'Say why the policy is cancelled.');
  docs text[] := (select coalesce(array_agg(distinct d), '{}') from unnest(coalesce(p_document_ids, '{}')) d where d <> '');
  new_id uuid;
begin
  if auth.uid() is null or a is null then raise exception 'Sign in to your agency.' using errcode = '42501'; end if;
  select * into t from public.commission_transactions where id = p_transaction_id and agency_id = a for update;
  if not found or not (public.is_agency_admin() or public.can_access_submission(t.submission_id)) then
    raise exception 'That policy doesn''t exist or isn''t on an account you work on.' using errcode = '42501';
  end if;
  if t.kind not in ('policy', 'endorsement') or t.verification_status = 'void' or t.replaced_by is not null then raise exception 'Cancellations are requested on a recorded policy or endorsement.' using errcode = '22023'; end if;
  if p_cancel_type not in ('full', 'partial') then raise exception 'Choose a full or a partial cancellation.' using errcode = '22023'; end if;
  if p_effective_date is null then raise exception 'Enter the cancellation''s effective date.' using errcode = '22023'; end if;
  if p_expected_refund_cents is not null and (p_expected_refund_cents <= 0 or p_expected_refund_cents >= 100000000000) then raise exception 'The expected refund is a positive amount.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(docs) d where not exists (select 1 from public.documents x where x.id = d and x.submission_id = t.submission_id)) then
    raise exception 'Attach documents from this account.' using errcode = '22023';
  end if;
  if exists (select 1 from public.commission_cancellations c where c.transaction_id = t.id and c.status in ('requested', 'awaiting_amount')) then
    raise exception 'A cancellation is already waiting on this policy.' using errcode = '23505';
  end if;
  insert into public.commission_cancellations (agency_id, transaction_id, submission_id, cancel_type, effective_date, reason, expected_refund_cents, document_ids, requested_by)
  values (a, t.id, t.submission_id, p_cancel_type, p_effective_date, reason, p_expected_refund_cents, docs, auth.uid())
  returning id into new_id;
  perform public.finance_audit(a, 'cancellation_requested', 'cancellation', new_id::text, reason,
    jsonb_build_object('transaction', t.id, 'type', p_cancel_type, 'effectiveDate', p_effective_date, 'expectedRefundCents', p_expected_refund_cents));
  return new_id;
end $$;

-- How much net premium is still on a policy (or an endorsement): it, its corrections, a policy's
-- endorsements (and theirs), less what earlier cancellations of any of them returned.
create or replace function public.finance_remaining_net(p_policy uuid) returns bigint
language sql stable security definer set search_path = ''
as $$
  with related as (
    select id, net_cents from public.commission_transactions where id = p_policy
    union all
    select e.id, e.net_cents from public.commission_transactions e
     where e.original_transaction_id = p_policy and e.kind = 'endorsement' and e.verification_status <> 'void' and e.replaced_by is null
  )
  select coalesce((select sum(net_cents) from related), 0)
       + coalesce((select sum(c.net_cents) from public.commission_transactions c where c.original_transaction_id in (select id from related) and c.kind = 'correction' and c.verification_status <> 'void'), 0)
       + coalesce((select sum(c.net_cents) from public.commission_transactions c where c.original_transaction_id in (select id from related) and c.kind = 'cancellation' and c.verification_status <> 'void'), 0)
$$;

-- An admin approves with the actual amounts from the carrier: the returned net premium and the carrier
-- commission returned. The agent adjustment uses the original's agent and split (net × 10% × split),
-- recorded as a separate negative record linked to it, paid with the original's payouts (a policy's
-- weekly, an endorsement's monthly). The original is never changed.
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
    c.effective_date, current_date, -p_returned_net_cents, t.agent_user_id, t.agent_name, t.agent_rate, public.finance_agent_cents(-p_returned_net_cents, t.agent_rate),
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

revoke all on function public.resolve_commission_agent(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.resolve_commission_agent(uuid, uuid, numeric, text) to authenticated;

notify pgrst, 'reload schema';
