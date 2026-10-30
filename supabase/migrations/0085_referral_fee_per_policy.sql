-- 0085 The referral fee is chosen on each policy, and agents see the partners' agreed amounts. Needs 0083.
--
-- Each policy keeps its own choice in the account's data ("referralPartner": a listed partner's id, "other" for the
-- client's Other partner, or "none" — No referral fee, $0). The app starts a client's first policy on the client's
-- partner and later ones (renewals) on No referral fee; the agent can change it. Policies saved before this have no
-- choice and keep the 0083 rule: the client's partner on the very first policy only.
-- A listed partner counts only if it's this agency's. Agents now see the partners' amounts (names list, splits).
-- Replaces two functions; no table changes; re-runnable. Rollback: supabase/release/rollback_0085.sql.

do $$
begin
  if to_regclass('public.account_other_referrals') is null then raise exception '0085 needs 0083.'; end if;
end $$;

-- The agency's partners, for everyone in it: name and agreed amount.
drop function if exists public.referral_source_names();
create function public.referral_source_names()
returns table (id uuid, name text, active boolean, partner_fee_cents bigint)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.name, r.active, r.partner_fee_cents from public.referral_sources r
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
    select f.*, row_number() over (partition by f.sid order by f.bound nulls last, f.entry ->> 'createdAt', f.entry ->> 'id') as nth
      from fees f
  ),
  chosen as (
    -- The policy's own choice; a policy saved before 0085: the client's partner on its very first policy only.
    select r.*, (r.entry ? 'referralPartner') as explicit,
           case when r.entry ? 'referralPartner' then r.entry ->> 'referralPartner'
                when r.nth = 1 then r.referral_source
                else 'none' end as choice
      from ranked r
  ),
  split as (
    select c.*, case when paid then coalesce(src.name, oth.name) end as src_name, false as pending,
           case when paid then least(coalesce(src.partner_fee_cents, oth.partner_fee_cents, 0), c.fee) else 0 end as partner,
           case when paid then greatest(coalesce(src.partner_fee_cents, oth.partner_fee_cents, 0) - c.fee, 0) else 0 end as shortfall
      from chosen c
      left join public.referral_sources src on src.id::text = c.choice and src.agency_id = (select agency from me)
      left join public.account_other_referrals oth on c.choice = 'other' and oth.submission_id = c.sid
      cross join lateral (select (src.id is not null and (c.explicit or src.active)) or oth.submission_id is not null as paid) pd
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
