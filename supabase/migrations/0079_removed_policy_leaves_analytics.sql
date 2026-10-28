-- 0079 A policy / endorsement deleted in Markets & Quotes stops counting in Analytics. Needs 0064, 0067, 0076.
--
-- Deleting a policy (often: entered by mistake) used to leave its commission record counting in the money
-- totals, only flagged "Removed from the account" for an admin to void by hand. Now, when an account is saved
-- with a policy / endorsement deleted (or gone), its money leaves Analytics in the same save:
--   * the record and its corrections / cancellations are voided (kept in the history, marked why), and
--   * anything that can't be voided any more (verified, or settled outside RenewalIQ) is balanced by one
--     reversing correction, so the policy adds up to $0 — nothing paid or verified is rewritten.
-- Saving never fails because of this. Already-deleted policies are cleaned up separately, after a preview
-- (supabase/release/cleanup_0079_removed_policies.sql). Re-runnable. Rollback: supabase/release/rollback_0079.sql.

do $$
begin
  if to_regprocedure('public.finance_sync(public.submissions)') is null or to_regprocedure('public.finance_same_week(timestamptz)') is null then
    raise exception '0079 needs 0064 and 0076.';
  end if;
end $$;

-- Takes one deleted policy / endorsement out of the money totals. Returns what it did.
create or replace function public.finance_remove_entry(p_t public.commission_transactions, p_reason text default 'Deleted in Markets & Quotes')
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  voided int := 0;
  net bigint; agent bigint; carrier bigint;
  fix uuid;
begin
  if p_t.id is null or p_t.kind not in ('policy', 'endorsement') then return 'skipped'; end if;
  -- 1. Void what can still be voided: the record, its corrections and cancellations (unverified, not settled).
  with upd as (
    update public.commission_transactions x
       set verification_status = 'void', void_reason = left(p_reason, 1000), voided_by = auth.uid(), voided_at = now()
     where (x.id = p_t.id or (x.original_transaction_id = p_t.id and x.kind in ('correction', 'cancellation')))
       and x.verification_status = 'unverified' and x.settlement = 'open' and x.replaced_by is null
    returning 1)
  select count(*) into voided from upd;
  -- 2. What still counts (verified / settled ones, earlier reversals): balance it to zero with one correction.
  select coalesce(sum(x.net_cents), 0), coalesce(sum(x.agent_cents), 0), coalesce(sum(x.carrier_cents), 0)
    into net, agent, carrier
    from public.commission_transactions x
   where (x.id = p_t.id or (x.original_transaction_id = p_t.id and x.kind in ('correction', 'cancellation')))
     and x.verification_status <> 'void' and x.replaced_by is null;
  if net <> 0 or agent <> 0 or carrier <> 0 then
    insert into public.commission_transactions (
      agency_id, submission_id, client_name, quote_id, kind, stream, origin, original_transaction_id, policy_number, carrier_name, carrier_key, business_type,
      event_date, payable_from, net_cents, agent_user_id, agent_name, agent_rate, agent_cents, carrier_rate, carrier_rate_id, carrier_rate_source, carrier_cents,
      recorded_snapshot, proof_status, verification_status, verified_by, verified_at, verification_reason, created_by)
    values (
      p_t.agency_id, p_t.submission_id, p_t.client_name, p_t.quote_id, 'correction', p_t.stream, 'admin', p_t.id, p_t.policy_number, p_t.carrier_name, p_t.carrier_key, p_t.business_type,
      current_date, current_date, -net, p_t.agent_user_id, p_t.agent_name, p_t.agent_rate, case when p_t.agent_rate is null and agent = 0 then null else -agent end,
      p_t.carrier_rate, p_t.carrier_rate_id, p_t.carrier_rate_source, -carrier,
      jsonb_build_object('reversed', 'removed', 'reason', left(p_reason, 200)), p_t.proof_status, 'verified', auth.uid(), now(), left(p_reason, 1000), auth.uid())
    returning id into fix;
  end if;
  if voided > 0 or fix is not null then
    perform public.finance_audit(p_t.agency_id, 'removed_from_totals', 'transaction', p_t.id::text, p_reason,
      jsonb_build_object('voided', voided, 'reversal', fix));
    return case when fix is null then 'voided' else 'reversed' end;
  end if;
  return 'nothing';
end $$;
revoke all on function public.finance_remove_entry(public.commission_transactions, text) from public, anon, authenticated;

-- After an account is saved: policies / endorsements deleted (or gone) from its markets leave the totals.
create or replace function public.finance_sync_removed() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions;
begin
  if new.organization_id is null then return null; end if;
  for t in
    select x.* from public.commission_transactions x
     where x.agency_id = new.organization_id and x.submission_id = new.id and x.policy_id is not null and x.replaced_by is null
       and x.kind in ('policy', 'endorsement')
       and not exists (select 1 from public.finance_entries(new.market_quotes) e where e.entry ->> 'id' = x.policy_id and e.entry ->> 'removedAt' is null)
       -- still counting: not void, or something linked to it still counts
       and (x.verification_status <> 'void'
            or exists (select 1 from public.commission_transactions c where c.original_transaction_id = x.id and c.kind in ('correction', 'cancellation')
                         and c.verification_status <> 'void' and c.replaced_by is null))
  loop
    perform public.finance_remove_entry(t);
  end loop;
  return null;
exception when others then
  return null; -- never blocks a save
end $$;
revoke all on function public.finance_sync_removed() from public, anon, authenticated;
-- Named to run after finance_sync_submission (triggers run in name order).
drop trigger if exists finance_sync_zremoved on public.submissions;
create trigger finance_sync_zremoved after update of market_quotes on public.submissions
  for each row execute function public.finance_sync_removed();

notify pgrst, 'reload schema';
