-- 0075 The agent cancels a policy / endorsement directly — no admin approval. Needs 0064, 0067 (0073/0074 not needed).
--
-- cancel_policy_commission(record, full|partial, effective date, reason, refund, documents): the account's
-- assigned agent or an agency admin enters the net premium the carrier refunds. In one step it records the
-- cancellation (as approved) and a negative commission record linked to the policy:
--   refund × the policy's carrier %  → carrier commission taken back
--   that × the agent's split         → agent commission taken back       (the policy's own recorded rates)
-- The refund can't be more than what's left on the policy. The original record is never changed.
-- Admins then see it as "Needs Review" until they tick it "Verified" (review_agent_cancellation); nothing is
-- blocked meanwhile. Requests made the old way (waiting for an admin) still work and can still be approved.
-- Re-runnable. Rollback: supabase/release/rollback_0075.sql.

do $$
begin
  if to_regprocedure('public.finance_agent_cents(bigint,numeric,numeric)') is null or to_regclass('public.commission_cancellations') is null then
    raise exception '0075 needs 0064 and 0067.';
  end if;
end $$;

-- Which cancellations were made directly (not approved by an admin), and whether an admin has checked them.
create table if not exists public.commission_cancellation_reviews (
  cancellation_id uuid primary key references public.commission_cancellations (id),
  agency_id uuid not null references public.agencies (id),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);
alter table public.commission_cancellation_reviews enable row level security;
revoke all on public.commission_cancellation_reviews from public, anon, authenticated;

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
  if p_refund_net_cents is null or p_refund_net_cents <= 0 then raise exception 'Enter the net premium the carrier refunds.' using errcode = '22023'; end if;
  remaining := public.finance_remaining_net(t.id);
  if t.kind = 'endorsement' and t.original_transaction_id is not null then remaining := least(remaining, public.finance_remaining_net(t.original_transaction_id)); end if;
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
    jsonb_build_object('cancelType', p_cancel_type, 'effectiveDate', p_effective_date, 'returnedNetCents', p_refund_net_cents, 'byAgent', not public.is_agency_admin()),
    case when cardinality(docs) = 0 then 'missing_proof' else 'has_proof' end, 'verified', auth.uid(), now(), cardinality(docs) = 0, reason, auth.uid())
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

-- Admins: the directly-made cancellations and whether each has been checked.
create or replace function public.agent_cancellation_reviews()
returns table (cancellation_id uuid, reviewed boolean, reviewed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.cancellation_id, r.reviewed_at is not null, r.reviewed_at
    from public.commission_cancellation_reviews r
   where auth.uid() is not null and public.is_agency_admin() and r.agency_id = public.current_agency_id()
$$;
revoke all on function public.agent_cancellation_reviews() from public, anon;
grant execute on function public.agent_cancellation_reviews() to authenticated;

create or replace function public.review_agent_cancellation(p_cancellation_id uuid, p_checked boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  r public.commission_cancellation_reviews;
begin
  if auth.uid() is null or not public.is_agency_admin() then raise exception 'Only an agency admin can check a cancellation.' using errcode = '42501'; end if;
  select * into r from public.commission_cancellation_reviews x where x.cancellation_id = p_cancellation_id for update;
  if r.cancellation_id is null or r.agency_id is distinct from public.current_agency_id() then raise exception 'No such cancellation.' using errcode = '42501'; end if;
  update public.commission_cancellation_reviews
     set reviewed_at = case when p_checked then now() end, reviewed_by = case when p_checked then auth.uid() end
   where cancellation_id = p_cancellation_id;
  perform public.finance_audit(r.agency_id, case when p_checked then 'cancellation_checked' else 'cancellation_unchecked' end, 'cancellation', p_cancellation_id::text, null, '{}'::jsonb);
  return p_checked;
end $$;
revoke all on function public.review_agent_cancellation(uuid, boolean) from public, anon;
grant execute on function public.review_agent_cancellation(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
