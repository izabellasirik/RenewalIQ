-- Rollback of 0085: back to the 0083 rule (the client's partner on its very first policy) and names without amounts.
-- The policies keep their "referralPartner" choice in the account's data; it's ignored until 0085 is run again.
begin;
drop function if exists public.referral_source_names();
create function public.referral_source_names()
returns table (id uuid, name text, active boolean)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.name, r.active from public.referral_sources r
   where auth.uid() is not null and r.agency_id = public.current_agency_id()
   order by r.active desc, lower(r.name)
$$;
revoke all on function public.referral_source_names() from public, anon;
grant execute on function public.referral_source_names() to authenticated;

drop function if exists public.broker_fee_splits(date, date);
create function public.broker_fee_splits(p_from date, p_to date)
returns table (submission_id text, client_name text, policy_id text, policy_number text, bound_date date, broker_fee_cents bigint,
               partner_name text, partner_cents bigint, agent_user_id uuid, agent_name text, agent_cents bigint, agency_cents bigint, partner_pending boolean,
               partner_shortfall_cents bigint)
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
    -- The partner is paid once per client, on the client's very first policy only (none if it had no broker fee).
    select f.*, row_number() over (partition by f.sid order by f.bound nulls last, f.entry ->> 'createdAt', f.entry ->> 'id') as nth
      from fees f
  ),
  split as (
    select r.*, coalesce(src.name, oth.name) as src_name, false as pending,
           case when r.nth = 1 and coalesce(src.active, oth.submission_id is not null) then least(coalesce(src.partner_fee_cents, oth.partner_fee_cents, 0), r.fee) else 0 end as partner,
           case when r.nth = 1 and coalesce(src.active, oth.submission_id is not null) then greatest(coalesce(src.partner_fee_cents, oth.partner_fee_cents, 0) - r.fee, 0) else 0 end as shortfall
      from ranked r
      left join public.referral_sources src on src.id::text = r.referral_source
      left join public.account_other_referrals oth on r.referral_source = 'other' and oth.submission_id = r.sid
     where coalesce(r.fee, 0) > 0
  ),
  shared as (
    select sp.*,
           case when sp.pending then null
                when sh.mode = 'amount' then least(sh.value::bigint, sp.fee - sp.partner)
                when sh.mode = 'percent' then round((sp.fee - sp.partner) * sh.value)::bigint
                else 0 end as agent_share
      from split sp
      left join public.agent_broker_fee_shares sh on sh.agency_id = (select agency from me) and sh.user_id = sp.agent
  )
  select x.sid, x.named_insured, x.entry ->> 'id', x.entry ->> 'policyNumber', x.bound, x.fee,
         case when (select admin from me) then x.src_name end,
         case when (select admin from me) and not x.pending then x.partner + x.shortfall end,
         x.agent,
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = x.agent),
         x.agent_share,
         case when (select admin from me) and not x.pending then x.fee - x.partner - x.agent_share end,
         x.pending,
         case when x.pending then null else x.shortfall end
    from shared x
   where x.bound is not null and x.bound between coalesce(p_from, '1900-01-01') and coalesce(p_to, '2999-12-31')
   order by x.bound desc, x.named_insured
$$;
revoke all on function public.broker_fee_splits(date, date) from public, anon;
grant execute on function public.broker_fee_splits(date, date) to authenticated;

notify pgrst, 'reload schema';
commit;
