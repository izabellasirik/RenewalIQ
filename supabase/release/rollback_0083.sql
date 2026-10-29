-- Rollback of 0083: agents can no longer add referral partners; the 0080 / 0081 versions of the changed functions
-- come back. Partners already added stay in the list (any still awaiting approval show as normal partners with no
-- amount), and decided review items and notifications are kept, so re-running 0083 restores everything.
begin;
drop function if exists public.request_referral_source(text, text);
drop function if exists public.resolve_referral_partner(uuid, text, bigint, uuid);
-- Open "new referral partner" items can't be decided without 0083.
update public.admin_review_items set status = 'resolved', resolution = 'approved', resolved_at = now() where kind = 'new_referral_partner' and status = 'open';
update public.referral_sources set status = 'approved' where status = 'pending';

drop function if exists public.referral_source_names();
create or replace function public.referral_source_names()
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
create or replace function public.broker_fee_splits(p_from date, p_to date)
returns table (submission_id text, client_name text, policy_id text, policy_number text, bound_date date, broker_fee_cents bigint,
               partner_name text, partner_cents bigint, agent_user_id uuid, agent_name text, agent_cents bigint, agency_cents bigint)
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
    -- The partner is paid once per client: on the client's first policy with a broker fee.
    select f.*, row_number() over (partition by f.sid order by f.bound nulls last, f.entry ->> 'createdAt', f.entry ->> 'id') as nth
      from fees f where coalesce(f.fee, 0) > 0
  ),
  split as (
    select r.*, src.name as src_name,
           case when r.nth = 1 and src.active is not null then least(coalesce(src.partner_fee_cents, 0), r.fee) else 0 end as partner
      from ranked r
      left join public.referral_sources src on src.id::text = r.referral_source
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
         case when (select admin from me) then x.src_name end,
         case when (select admin from me) then x.partner end,
         x.agent,
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = x.agent),
         x.agent_share,
         case when (select admin from me) then x.fee - x.partner - x.agent_share end
    from shared x
   where x.bound is not null and x.bound between coalesce(p_from, '1900-01-01') and coalesce(p_to, '2999-12-31')
   order by x.bound desc, x.named_insured
$$;
revoke all on function public.broker_fee_splits(date, date) from public, anon;
grant execute on function public.broker_fee_splits(date, date) to authenticated;

drop function if exists public.admin_review_items();
create or replace function public.admin_review_items()
returns table (id uuid, kind text, status text, created_at timestamptz, created_by_name text, submission_id text, account_name text, account_archived boolean,
               account_agent text, related jsonb, resolution text, resolved_by_name text, resolved_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.kind, i.status, i.created_at,
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = i.created_by),
         i.submission_id, s.named_insured, coalesce(s.archived, false),
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = coalesce(s.assigned_user_id, s.user_id)),
         coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.named_insured, 'archived', coalesce(o.archived, false), 'createdAt', o.created_at,
                     'agent', (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = coalesce(o.assigned_user_id, o.user_id)),
                     'reasons', i.detail -> 'reasons' -> o.id))
                     from public.submissions o where o.id = any (i.related_ids)), '[]'::jsonb),
         i.resolution,
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = i.resolved_by),
         i.resolved_at
    from public.admin_review_items i
    left join public.submissions s on s.id = i.submission_id
   where auth.uid() is not null and public.is_agency_admin() and i.agency_id = public.current_agency_id()
     and (i.status = 'open' or i.id in (select x.id from public.admin_review_items x where x.agency_id = i.agency_id and x.status = 'resolved' order by x.resolved_at desc limit 50))
   order by (i.status = 'open') desc, i.created_at desc
$$;
revoke all on function public.admin_review_items() from public, anon;
grant execute on function public.admin_review_items() to authenticated;
commit;
notify pgrst, 'reload schema';
