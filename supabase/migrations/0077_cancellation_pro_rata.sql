-- 0077 A full cancellation refunds only the unused days (pro rata). Needs 0076.
--
-- The policy's term runs from its effective date to its expiration date (no expiration: one year; no effective
-- date: its bound date). The days from the term's start up to the cancellation date are used and kept; the
-- days from the cancellation date to expiration are unused and refunded:
--     refund = net premium × unused days ÷ days in the term      (365 for a normal annual policy)
-- An endorsement counts from its own effective (or endorsed) date to the policy's expiration, a correction
-- like the record it corrects, and an earlier partial cancellation from its own date — so after a partial
-- the full cancellation refunds only the unused days of what's left. A cancellation on or before the start
-- refunds everything; on or after expiration, nothing. Partial cancellations are unchanged (the agent enters
-- the carrier's refund).
-- cancellation_refund_preview(record, date): the refund and the days, for the cancel dialog.
-- A policy that is fully cancelled can't be cancelled again (undo it first). Re-runnable.
-- Rollback: supabase/release/rollback_0077.sql.

do $$
begin
  if to_regprocedure('public.finance_same_week(timestamptz)') is null then raise exception '0077 needs 0076.'; end if;
end $$;

-- A policy / endorsement as it is on the account now (or as recorded, if it's gone).
create or replace function public.finance_entry_now(t public.commission_transactions) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select e.entry from public.submissions s cross join lateral public.finance_entries(s.market_quotes) e
      where s.id = t.submission_id and e.entry ->> 'id' = t.policy_id limit 1),
    t.recorded_snapshot)
$$;
revoke all on function public.finance_entry_now(public.commission_transactions) from public, anon, authenticated;

-- When a policy / endorsement starts: its effective date, else its bound (endorsed) date.
create or replace function public.finance_entry_start(t public.commission_transactions) returns date
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.finance_date(left(e ->> 'effectiveDate', 10)), public.finance_date(left(e ->> 'boundDate', 10)), t.event_date)
    from (select public.finance_entry_now(t) e) x
$$;
revoke all on function public.finance_entry_start(public.commission_transactions) from public, anon, authenticated;

-- A policy's term: effective → expiration (one year when no expiration is entered).
create or replace function public.finance_policy_term(t public.commission_transactions, out term_start date, out term_end date)
language plpgsql stable security definer set search_path = ''
as $$
begin
  term_start := public.finance_entry_start(t);
  term_end := coalesce(public.finance_date(left(public.finance_entry_now(t) ->> 'expirationDate', 10)), (term_start + interval '1 year')::date);
end $$;
revoke all on function public.finance_policy_term(public.commission_transactions) from public, anon, authenticated;

-- The unused share of an amount that runs from p_start to p_end, cancelled on p_on (in cents, rounded).
create or replace function public.finance_unused_cents(p_cents bigint, p_start date, p_end date, p_on date) returns bigint
language sql immutable set search_path = ''
as $$
  select case
    when p_on <= p_start then p_cents
    when p_end <= p_start or p_on >= p_end then 0
    else round(p_cents::numeric * (p_end - p_on) / (p_end - p_start))::bigint
  end
$$;

-- What a full cancellation on p_on refunds: the unused days of the record (a policy with its endorsements,
-- or one endorsement), less the unused days of what earlier cancellations already refunded. Never more
-- than what's left on it, never below zero.
create or replace function public.finance_pro_rata_refund(p_tx uuid, p_on date,
  out refund_net_cents bigint, out remaining_net_cents bigint, out term_start date, out term_end date, out term_days integer, out unused_days integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  t public.commission_transactions;
  pol public.commission_transactions;
  r record;
  total bigint := 0;
  s date;
begin
  select * into t from public.commission_transactions where id = p_tx;
  if t.kind = 'endorsement' and t.original_transaction_id is not null then
    select * into pol from public.commission_transactions where id = t.original_transaction_id;
  end if;
  pol := coalesce(pol, t);
  -- The policy's term; an endorsement runs from its own date to its policy's expiration.
  select pt.term_start, pt.term_end into term_start, term_end from public.finance_policy_term(pol) pt;
  if t.kind = 'endorsement' then term_start := public.finance_entry_start(t); end if;

  for r in
    with related as (
      select x.* from public.commission_transactions x where x.id = t.id
      union all
      select e.* from public.commission_transactions e
       where t.kind = 'policy' and e.original_transaction_id = t.id and e.kind = 'endorsement' and e.verification_status <> 'void' and e.replaced_by is null
    )
    select x.id, x.kind, x.net_cents, x.event_date, null::uuid as parent from related x
    union all
    select c.id, c.kind, c.net_cents, c.event_date, c.original_transaction_id
      from public.commission_transactions c
     where c.original_transaction_id in (select id from related) and c.kind in ('correction', 'cancellation') and c.verification_status <> 'void'
  loop
    -- Where each piece starts: the term (the record itself), an endorsement's own date; a correction like what it
    -- corrects; a cancellation from its own date.
    if r.parent is null then
      s := case when r.id = t.id then term_start else public.finance_entry_start((select e from public.commission_transactions e where e.id = r.id)) end;
    else
      s := case when r.parent = t.id then term_start else public.finance_entry_start((select o from public.commission_transactions o where o.id = r.parent)) end;
      if r.kind = 'cancellation' then s := greatest(s, r.event_date); end if;
    end if;
    total := total + public.finance_unused_cents(r.net_cents, s, term_end, p_on);
  end loop;

  remaining_net_cents := public.finance_remaining_net(t.id);
  if t.kind = 'endorsement' and t.original_transaction_id is not null then remaining_net_cents := least(remaining_net_cents, public.finance_remaining_net(t.original_transaction_id)); end if;
  refund_net_cents := greatest(0, least(total, remaining_net_cents));
  term_days := greatest(term_end - term_start, 0);
  unused_days := least(greatest(term_end - greatest(p_on, term_start), 0), term_days);
end $$;
revoke all on function public.finance_pro_rata_refund(uuid, date) from public, anon, authenticated;

-- Fully cancelled (and not undone): the record itself, or — for an endorsement — its policy.
create or replace function public.finance_fully_cancelled(t public.commission_transactions) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.commission_cancellations c
      join public.commission_transactions x on x.id = c.result_transaction_id
     where c.transaction_id in (t.id, t.original_transaction_id) and c.cancel_type = 'full' and c.status = 'approved' and x.verification_status <> 'void')
$$;
revoke all on function public.finance_fully_cancelled(public.commission_transactions) from public, anon, authenticated;

-- For the cancel dialog: what a full cancellation on that date refunds, and the days it's worked out from.
create or replace function public.cancellation_refund_preview(p_transaction_id uuid, p_effective_date date)
returns table (refund_net_cents bigint, remaining_net_cents bigint, term_start date, term_end date, term_days integer, unused_days integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  t public.commission_transactions;
  s public.submissions;
begin
  if auth.uid() is null then raise exception 'Sign in to your agency.' using errcode = '42501'; end if;
  select * into t from public.commission_transactions where id = p_transaction_id and agency_id = public.current_agency_id();
  select * into s from public.submissions where id = t.submission_id;
  if t.id is null or s.id is null or not (public.is_agency_admin() or s.assigned_user_id = auth.uid()) or t.kind not in ('policy', 'endorsement') then
    raise exception 'Only the account''s agent or an agency admin can cancel this policy.' using errcode = '42501';
  end if;
  if p_effective_date is null then raise exception 'Enter the cancellation''s effective date.' using errcode = '22023'; end if;
  return query select * from public.finance_pro_rata_refund(t.id, p_effective_date);
end $$;
revoke all on function public.cancellation_refund_preview(uuid, date) from public, anon;
grant execute on function public.cancellation_refund_preview(uuid, date) to authenticated;

-- 0076's cancellation; a full one now refunds the unused days.
create or replace function public.cancel_policy_commission(p_transaction_id uuid, p_cancel_type text, p_effective_date date, p_reason text,
  p_refund_net_cents bigint, p_document_ids text[] default '{}') returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  t public.commission_transactions;
  s public.submissions;
  reason text := public.finance_require_text(p_reason, 'Say why the policy is cancelled.');
  docs text[] := (select coalesce(array_agg(distinct d), '{}') from unnest(coalesce(p_document_ids, '{}')) d where d <> '');
  remaining bigint;
  pro_rata jsonb;
  cid uuid;
  new_id uuid;
begin
  if auth.uid() is null or a is null then raise exception 'Sign in to your agency.' using errcode = '42501'; end if;
  select * into t from public.commission_transactions where id = p_transaction_id and agency_id = a for update;
  select * into s from public.submissions where id = t.submission_id;
  if t.id is null or s.id is null or not (public.is_agency_admin() or s.assigned_user_id = auth.uid()) then
    raise exception 'Only the account''s agent or an agency admin can cancel this policy.' using errcode = '42501';
  end if;
  if t.kind not in ('policy', 'endorsement') or t.verification_status = 'void' or t.replaced_by is not null then
    raise exception 'Only a recorded policy or endorsement can be cancelled.' using errcode = '22023';
  end if;
  if p_cancel_type not in ('full', 'partial') then raise exception 'Choose a full or a partial cancellation.' using errcode = '22023'; end if;
  if p_effective_date is null then raise exception 'Enter the cancellation''s effective date.' using errcode = '22023'; end if;
  if public.finance_fully_cancelled(t) then
    raise exception 'This policy is already fully cancelled. Undo that cancellation first to change it.' using errcode = '22023';
  end if;
  remaining := public.finance_remaining_net(t.id);
  if t.kind = 'endorsement' and t.original_transaction_id is not null then remaining := least(remaining, public.finance_remaining_net(t.original_transaction_id)); end if;
  if remaining <= 0 then raise exception 'Nothing is left on this policy to cancel.' using errcode = '22023'; end if;
  -- Full: the unused days (pro rata). Partial: the amount entered.
  if p_cancel_type = 'full' then
    select f.refund_net_cents, jsonb_build_object('termStart', f.term_start, 'termEnd', f.term_end, 'termDays', f.term_days, 'unusedDays', f.unused_days)
      into p_refund_net_cents, pro_rata from public.finance_pro_rata_refund(t.id, p_effective_date) f;
    if p_refund_net_cents <= 0 then
      raise exception 'Nothing to refund: the policy has no unused days left on %.', to_char(p_effective_date, 'Mon FMDD, YYYY') using errcode = '22023';
    end if;
  end if;
  if p_refund_net_cents is null or p_refund_net_cents <= 0 then raise exception 'Enter the net premium the carrier refunds.' using errcode = '22023'; end if;
  if p_refund_net_cents > remaining then
    raise exception 'That''s more than the % net premium left on the policy.', to_char(remaining / 100.0, 'FM999,999,999,990.00') using errcode = '22023';
  end if;
  if exists (select 1 from unnest(docs) d where not exists (select 1 from public.documents x where x.id = d and x.submission_id = t.submission_id)) then
    raise exception 'Attach documents from this account.' using errcode = '22023';
  end if;
  if exists (select 1 from public.commission_cancellations c where c.transaction_id = t.id and c.status in ('requested', 'awaiting_amount')) then
    raise exception 'A cancellation request is already waiting on this policy: an admin can approve it in Analytics → Commissions.' using errcode = '23505';
  end if;

  insert into public.commission_cancellations (agency_id, transaction_id, submission_id, cancel_type, effective_date, reason, expected_refund_cents, document_ids, requested_by)
  values (a, t.id, t.submission_id, p_cancel_type, p_effective_date, reason, p_refund_net_cents, docs, auth.uid())
  returning id into cid;

  insert into public.commission_transactions (
    agency_id, submission_id, client_name, quote_id, kind, stream, origin, original_transaction_id, cancellation_id, policy_number, carrier_name, carrier_key, business_type,
    event_date, payable_from, net_cents, agent_user_id, agent_name, agent_rate, agent_cents, carrier_rate, carrier_rate_id, carrier_rate_source, carrier_cents,
    recorded_snapshot, proof_status, verification_status, verified_by, verified_at, verified_without_proof, verification_reason, created_by)
  values (
    t.agency_id, t.submission_id, t.client_name, t.quote_id, 'cancellation', t.stream, 'admin', t.id, cid, t.policy_number, t.carrier_name, t.carrier_key, t.business_type,
    p_effective_date, current_date, -p_refund_net_cents, t.agent_user_id, t.agent_name, t.agent_rate, public.finance_agent_cents(-p_refund_net_cents, t.carrier_rate, t.agent_rate),
    t.carrier_rate, t.carrier_rate_id, t.carrier_rate_source, public.finance_apply_rate(-p_refund_net_cents, t.carrier_rate),
    jsonb_strip_nulls(jsonb_build_object('cancelType', p_cancel_type, 'effectiveDate', p_effective_date, 'returnedNetCents', p_refund_net_cents, 'byAgent', not public.is_agency_admin(),
      'proRata', pro_rata)),
    case when cardinality(docs) = 0 then 'missing_proof' else 'has_proof' end, 'unverified', null, null, false, reason, auth.uid())
  returning id into new_id;

  update public.commission_cancellations
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), returned_net_cents = p_refund_net_cents,
         carrier_adjustment_cents = abs(public.finance_apply_rate(-p_refund_net_cents, t.carrier_rate)), result_transaction_id = new_id
   where id = cid;
  insert into public.commission_cancellation_reviews (cancellation_id, agency_id) values (cid, a);
  perform public.finance_audit(a, 'policy_cancelled', 'cancellation', cid::text, reason,
    jsonb_build_object('transaction', new_id, 'type', p_cancel_type, 'refundNetCents', p_refund_net_cents));
  return new_id;
end $$;
revoke all on function public.cancel_policy_commission(uuid, text, date, text, bigint, text[]) from public, anon;
grant execute on function public.cancel_policy_commission(uuid, text, date, text, bigint, text[]) to authenticated;

notify pgrst, 'reload schema';
