-- 0076 Undo a cancellation, and see a policy's cancellations on the account. Needs 0075.
--
-- - A cancellation made with "Cancel policy" (0075) can be undone by the account's agent or an admin during the
--   same week it was made (Monday–Sunday, US Eastern time). After that week the agent asks, and an admin approves
--   (or turns it down). Undoing voids the negative commission record — it stops counting — and keeps it, with
--   who undid it and when, in the history. The policy can then be cancelled again.
-- - New cancellations are recorded unverified (no admin verification step), so they can be undone.
-- - policy_cancellations(account): the account's cancellations (full/partial, dates, refund, undo state), for
--   its agent and admins — what Markets & Quotes shows on each policy.
-- Nothing else changes. Re-runnable. Rollback: supabase/release/rollback_0076.sql.

do $$
begin
  if to_regclass('public.commission_cancellation_reviews') is null then raise exception '0076 needs 0075.'; end if;
end $$;

alter table public.commission_cancellation_reviews add column if not exists undo_requested_at timestamptz;
alter table public.commission_cancellation_reviews add column if not exists undo_requested_by uuid references auth.users (id) on delete set null;
alter table public.commission_cancellation_reviews add column if not exists undo_reason text check (length(undo_reason) <= 1000);
alter table public.commission_cancellation_reviews add column if not exists undone_at timestamptz;
alter table public.commission_cancellation_reviews add column if not exists undone_by uuid references auth.users (id) on delete set null;

-- 0075's cancellation, recorded unverified (so it can be undone).
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
  remaining := public.finance_remaining_net(t.id);
  if t.kind = 'endorsement' and t.original_transaction_id is not null then remaining := least(remaining, public.finance_remaining_net(t.original_transaction_id)); end if;
  if remaining <= 0 then raise exception 'Nothing is left on this policy to cancel.' using errcode = '22023'; end if;
  -- Full: everything still on the policy. Partial: the amount entered.
  if p_cancel_type = 'full' then p_refund_net_cents := remaining; end if;
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
    jsonb_build_object('cancelType', p_cancel_type, 'effectiveDate', p_effective_date, 'returnedNetCents', p_refund_net_cents, 'byAgent', not public.is_agency_admin()),
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

-- The week a cancellation was made in (Monday–Sunday, US Eastern), and whether it's still that week.
create or replace function public.finance_same_week(p_at timestamptz) returns boolean
language sql stable set search_path = ''
as $$ select date_trunc('week', p_at at time zone 'America/New_York') = date_trunc('week', now() at time zone 'America/New_York') $$;

-- Undo (same week, or an admin) — or, after that week, ask an admin. Returns 'undone' or 'requested'.
create or replace function public.undo_policy_cancellation(p_cancellation_id uuid, p_reason text default null) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  c public.commission_cancellations;
  r public.commission_cancellation_reviews;
  s public.submissions;
  admin boolean := public.is_agency_admin();
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into c from public.commission_cancellations x where x.id = p_cancellation_id;
  select * into r from public.commission_cancellation_reviews x where x.cancellation_id = p_cancellation_id for update;
  select * into s from public.submissions x where x.id = c.submission_id;
  if c.id is null or r.cancellation_id is null or c.agency_id is distinct from public.current_agency_id() or not (admin or s.assigned_user_id = auth.uid()) then
    raise exception 'Only the account''s agent or an agency admin can undo this cancellation.' using errcode = '42501';
  end if;
  if r.undone_at is not null then raise exception 'This cancellation was already undone.' using errcode = '22023'; end if;
  if admin or public.finance_same_week(c.decided_at) then
    perform set_config('renewaliq.finance_op', '', true);
    update public.commission_transactions
       set verification_status = 'void', void_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Cancellation undone'), voided_by = auth.uid(), voided_at = now()
     where id = c.result_transaction_id and verification_status = 'unverified';
    if not found then raise exception 'This cancellation can''t be undone here (it was recorded before undo existed).' using errcode = '22023'; end if;
    update public.commission_cancellation_reviews set undone_at = now(), undone_by = auth.uid() where cancellation_id = c.id;
    perform public.finance_audit(c.agency_id, 'cancellation_undone', 'cancellation', c.id::text, p_reason, jsonb_build_object('afterWeek', not public.finance_same_week(c.decided_at)));
    return 'undone';
  end if;
  update public.commission_cancellation_reviews
     set undo_requested_at = now(), undo_requested_by = auth.uid(), undo_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where cancellation_id = c.id;
  perform public.finance_audit(c.agency_id, 'cancellation_undo_requested', 'cancellation', c.id::text, p_reason, '{}'::jsonb);
  return 'requested';
end $$;
revoke all on function public.undo_policy_cancellation(uuid, text) from public, anon;
grant execute on function public.undo_policy_cancellation(uuid, text) to authenticated;

-- An admin turns down a request to undo (the cancellation stays).
create or replace function public.decline_cancellation_undo(p_cancellation_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.commission_cancellation_reviews;
begin
  if auth.uid() is null or not public.is_agency_admin() then raise exception 'Only an agency admin can decide this.' using errcode = '42501'; end if;
  select * into r from public.commission_cancellation_reviews x where x.cancellation_id = p_cancellation_id for update;
  if r.cancellation_id is null or r.agency_id is distinct from public.current_agency_id() then raise exception 'No such cancellation.' using errcode = '42501'; end if;
  update public.commission_cancellation_reviews set undo_requested_at = null, undo_requested_by = null, undo_reason = null where cancellation_id = p_cancellation_id;
  perform public.finance_audit(r.agency_id, 'cancellation_undo_declined', 'cancellation', p_cancellation_id::text, null, '{}'::jsonb);
end $$;
revoke all on function public.decline_cancellation_undo(uuid) from public, anon;
grant execute on function public.decline_cancellation_undo(uuid) to authenticated;

-- An account's cancellations, for its agent and admins (null account: all the caller may see).
create or replace function public.policy_cancellations(p_submission_id text default null)
returns table (cancellation_id uuid, submission_id text, policy_id text, cancel_type text, effective_date date, refund_net_cents bigint,
               cancelled_at timestamptz, cancelled_by_name text, direct boolean, undone_at timestamptz, undo_requested_at timestamptz, undo_reason text, can_undo_now boolean, status text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.submission_id, t.policy_id, c.cancel_type, c.effective_date, c.returned_net_cents, c.decided_at,
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = c.requested_by),
         r.cancellation_id is not null, r.undone_at, r.undo_requested_at, r.undo_reason,
         r.cancellation_id is not null and r.undone_at is null and (public.is_agency_admin() or public.finance_same_week(c.decided_at)),
         c.status
    from public.commission_cancellations c
    join public.commission_transactions t on t.id = c.transaction_id
    join public.submissions s on s.id = c.submission_id
    left join public.commission_cancellation_reviews r on r.cancellation_id = c.id
   where auth.uid() is not null and c.agency_id = public.current_agency_id()
     and (p_submission_id is null or c.submission_id = p_submission_id)
     and (public.is_agency_admin() or s.assigned_user_id = auth.uid())
   order by c.requested_at desc
$$;
revoke all on function public.policy_cancellations(text) from public, anon;
grant execute on function public.policy_cancellations(text) to authenticated;

notify pgrst, 'reload schema';
