-- After 0079: policies / endorsements ALREADY deleted in Markets & Quotes that still count in Analytics.
-- Step A (read-only) lists them; check the list. Step B takes them out of the totals (records are kept,
-- voided or balanced to $0, with the reason). Accounts that were deleted entirely are not touched.

-- A. PREVIEW — read-only.
with gone as (
  select x.*, s.named_insured
    from public.commission_transactions x
    join public.submissions s on s.id = x.submission_id
   where x.policy_id is not null and x.replaced_by is null and x.kind in ('policy', 'endorsement')
     and not exists (select 1 from public.finance_entries(s.market_quotes) e where e.entry ->> 'id' = x.policy_id and e.entry ->> 'removedAt' is null)
     and (x.verification_status <> 'void'
          or exists (select 1 from public.commission_transactions c where c.original_transaction_id = x.id and c.kind in ('correction', 'cancellation')
                       and c.verification_status <> 'void' and c.replaced_by is null))
)
select g.named_insured as account, g.policy_number, g.kind, g.event_date as recorded_for,
       ((select sum(y.net_cents) from public.commission_transactions y where (y.id = g.id or (y.original_transaction_id = g.id and y.kind in ('correction', 'cancellation'))) and y.verification_status <> 'void' and y.replaced_by is null) / 100.0)::numeric(14,2) as net_still_counting,
       ((select sum(y.carrier_cents) from public.commission_transactions y where (y.id = g.id or (y.original_transaction_id = g.id and y.kind in ('correction', 'cancellation'))) and y.verification_status <> 'void' and y.replaced_by is null) / 100.0)::numeric(14,2) as carrier_commission_still_counting,
       ((select sum(y.agent_cents) from public.commission_transactions y where (y.id = g.id or (y.original_transaction_id = g.id and y.kind in ('correction', 'cancellation'))) and y.verification_status <> 'void' and y.replaced_by is null) / 100.0)::numeric(14,2) as agent_commission_still_counting,
       g.agent_name, g.verification_status, g.settlement
  from gone g
 order by g.event_date desc;

-- B. APPLY — run only after checking the preview. Takes every listed policy out of the totals.
-- begin;
-- select public.finance_remove_entry(x, 'Deleted in Markets & Quotes (cleanup of earlier deletions)') as result, x.policy_number
--   from public.commission_transactions x
--   join public.submissions s on s.id = x.submission_id
--  where x.policy_id is not null and x.replaced_by is null and x.kind in ('policy', 'endorsement')
--    and not exists (select 1 from public.finance_entries(s.market_quotes) e where e.entry ->> 'id' = x.policy_id and e.entry ->> 'removedAt' is null)
--    and (x.verification_status <> 'void'
--         or exists (select 1 from public.commission_transactions c where c.original_transaction_id = x.id and c.kind in ('correction', 'cancellation')
--                      and c.verification_status <> 'void' and c.replaced_by is null));
-- commit;
