-- 0087 The referral partner is paid once per client: from the broker fee on the client's very first policy only (as
-- in 0083), whatever a policy saved under 0085 chose. Keeps from 0085: only this agency's partners count, and agents
-- see the partners' amounts. Needs 0085. Replaces one function; re-runnable. Rollback: supabase/release/rollback_0087.sql.

do $$
begin
  if coalesce(pg_get_function_result(to_regprocedure('public.referral_source_names()')) not like '%partner_fee_cents%', true) then
    raise exception '0087 needs 0085.';
  end if;
end $$;

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
    select f.*, row_number() over (partition by f.sid order by f.bound nulls last, f.entry ->> 'createdAt', f.entry ->> 'id') as nth
      from fees f
  ),
  chosen as (
    -- The client's partner, on the client's very first policy only.
    select r.*, case when r.nth = 1 then r.referral_source else 'none' end as choice
      from ranked r
  ),
  split as (
    select c.*, case when paid then coalesce(src.name, oth.name) end as src_name, false as pending,
           case when paid then least(coalesce(src.partner_fee_cents, oth.partner_fee_cents, 0), c.fee) else 0 end as partner,
           case when paid then greatest(coalesce(src.partner_fee_cents, oth.partner_fee_cents, 0) - c.fee, 0) else 0 end as shortfall
      from chosen c
      left join public.referral_sources src on src.id::text = c.choice and src.agency_id = (select agency from me)
      left join public.account_other_referrals oth on c.choice = 'other' and oth.submission_id = c.sid
      cross join lateral (select (src.id is not null and src.active) or oth.submission_id is not null as paid) pd
     where coalesce(c.fee, 0) > 0
  ),
  shared as (
    select sp.*,
           case when sh.mode = 'amount' then least(sh.value::bigint, sp.fee - sp.partner)
                when sh.mode = 'percent' then round((sp.fee - sp.partner) * sh.value)::bigint
                else 0 end as agent_share
      from split sp
      left join public.agent_broker_fee_shares sh on sh.agency_id = (select agency from me) and sh.user_id = sp.agent
  )
  select x.sid, x.named_insured, x.entry ->> 'id', x.entry ->> 'policyNumber', x.bound, x.fee,
         x.src_name,
         x.partner + x.shortfall,
         x.agent,
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = x.agent),
         x.agent_share,
         case when (select admin from me) then x.fee - x.partner - x.agent_share end,
         x.pending,
         x.shortfall
    from shared x
   where x.bound is not null and x.bound between coalesce(p_from, '1900-01-01') and coalesce(p_to, '2999-12-31')
   order by x.bound desc, x.named_insured
$$;
revoke all on function public.broker_fee_splits(date, date) from public, anon;
grant execute on function public.broker_fee_splits(date, date) to authenticated;

notify pgrst, 'reload schema';
