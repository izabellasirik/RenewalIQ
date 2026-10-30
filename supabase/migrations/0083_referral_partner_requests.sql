-- 0083 Agents can name a new referral partner ("Other"); admins approve it. Needs 0080 and 0081.
--
-- * Where a referral partner is picked (New Submission, intake import, the account, the policy window), "Other"
--   lets anyone in the agency type a partner's name. An agent's is saved as AWAITING APPROVAL (everyone sees the
--   name, so it isn't typed twice); an admin's is added straight away.
-- * Each one an agent adds goes to Admin Review with a bell notification to the agency's admins. An admin:
--     approve  — sets the partner's agreed amount (once per client, from the broker fee) and it's a normal partner;
--     merge    — it was an existing partner under another spelling: its accounts move to that one;
--     reject   — its accounts go back to "Referral: not set".
--   The agent who added it is notified (bell) of the decision.
-- * Until it's approved, broker fee splits for that client show no partner, agent or agency amounts (pending).
-- * The partner is paid once per client, and only on the client's VERY FIRST policy (by bound date): when that
--   policy has no broker fee, the partner gets nothing for that client. (0081 paid on the first policy that had a
--   broker fee.) The agent and the agency split every broker fee.
-- * When that first broker fee is less than the partner's agreed amount, the partner is still owed the full amount:
--   the rest comes out of the agent commission on that policy (partner_shortfall_cents, shown to the agent too).
-- Additive; replaces referral_source_names, broker_fee_splits and admin_review_items with versions that return one
-- more column each. Re-runnable. Rollback: supabase/release/rollback_0083.sql.

do $$
begin
  if to_regclass('public.admin_review_items') is null or to_regclass('public.referral_sources') is null then
    raise exception '0083 needs 0080 and 0081.';
  end if;
end $$;

-- A partner an agent added waits for an admin.
alter table public.referral_sources add column if not exists status text not null default 'approved';
alter table public.referral_sources drop constraint if exists referral_sources_status;
alter table public.referral_sources add constraint referral_sources_status check (status in ('approved', 'pending'));
alter table public.referral_sources add column if not exists requested_by uuid references auth.users (id) on delete set null;

-- Admin Review: the new kind of item (it may not be tied to an account yet, e.g. from New Submission).
alter table public.admin_review_items alter column submission_id drop not null;
alter table public.admin_review_items drop constraint if exists admin_review_items_kind_check;
alter table public.admin_review_items add constraint admin_review_items_kind_check check (kind in ('possible_duplicate', 'new_referral_partner'));
alter table public.admin_review_items drop constraint if exists admin_review_items_resolution_check;
alter table public.admin_review_items add constraint admin_review_items_resolution_check
  check (resolution in ('kept_both', 'archived_new', 'approved', 'merged', 'rejected'));

-- The agent hears back.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in ('assigned', 'collaborator_added', 'admin_review', 'referral_update'));

-- Everyone in the agency: the partner names to pick from (approved first), with whether each awaits approval.
drop function if exists public.referral_source_names();
create function public.referral_source_names()
returns table (id uuid, name text, active boolean, status text)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.name, r.active, r.status from public.referral_sources r
   where auth.uid() is not null and r.agency_id = public.current_agency_id()
   order by r.active desc, (r.status = 'approved') desc, lower(r.name)
$$;
revoke all on function public.referral_source_names() from public, anon;
grant execute on function public.referral_source_names() to authenticated;

-- "Other": anyone in the agency names a partner. Returns its id (an existing partner's, when the name matches one).
create or replace function public.request_referral_source(p_name text, p_submission_id text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  me uuid := auth.uid();
  nm text := btrim(coalesce(p_name, ''));
  rid uuid;
  item uuid;
  sub text;
  who text;
begin
  if me is null or a is null then raise exception 'Only members of an agency can add a referral partner.' using errcode = '42501'; end if;
  if nm = '' or length(nm) > 80 then raise exception 'Enter the partner''s name (up to 80 characters).' using errcode = '22023'; end if;
  if lower(nm) in ('none', 'no referral', 'other') then raise exception 'Enter the partner''s name.' using errcode = '22023'; end if;
  select r.id into rid from public.referral_sources r where r.agency_id = a and lower(btrim(r.name)) = lower(nm);
  if rid is not null then return rid; end if;
  if public.is_agency_admin() then
    insert into public.referral_sources (agency_id, name, partner_fee_cents, active, created_by, status) values (a, nm, null, true, me, 'approved') returning id into rid;
    return rid;
  end if;
  insert into public.referral_sources (agency_id, name, partner_fee_cents, active, created_by, status, requested_by) values (a, nm, null, true, me, 'pending', me) returning id into rid;
  select s.id into sub from public.submissions s where s.id = p_submission_id and s.organization_id = a;
  insert into public.admin_review_items (agency_id, kind, submission_id, detail, created_by)
  values (a, 'new_referral_partner', sub, jsonb_build_object('source_id', rid, 'name', nm), me)
  returning id into item;
  select coalesce(nullif(btrim(p.display_name), ''), 'An agent') into who from public.profiles p where p.user_id = me;
  insert into public.notifications (user_id, type, submission_id, message, actor_name, review_item_id)
  select p.user_id, 'admin_review', sub, format('%s added a new referral partner, %s. Approve it and set the agreed amount.', coalesce(who, 'An agent'), nm), who, item
    from public.profiles p where p.agency_id = a and p.role = 'admin';
  return rid;
end $$;
revoke all on function public.request_referral_source(text, text) from public, anon;
grant execute on function public.request_referral_source(text, text) to authenticated;

-- Admins decide on a partner an agent added: approve (with the agreed amount), merge into another, or reject.
create or replace function public.resolve_referral_partner(p_id uuid, p_action text, p_partner_fee_cents bigint default null, p_merge_into uuid default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  i public.admin_review_items;
  src public.referral_sources;
  target public.referral_sources;
  one_account text;
  msg text;
  result text;
begin
  if auth.uid() is null or not public.is_agency_admin() then raise exception 'Only an agency admin can do this.' using errcode = '42501'; end if;
  select * into i from public.admin_review_items x where x.id = p_id for update;
  if i.id is null or i.agency_id is distinct from public.current_agency_id() or i.kind <> 'new_referral_partner' then raise exception 'No such review item.' using errcode = '42501'; end if;
  if i.status <> 'open' then raise exception 'This was already decided.' using errcode = '22023'; end if;
  select * into src from public.referral_sources r where r.id = (i.detail ->> 'source_id')::uuid and r.agency_id = i.agency_id;
  select s.id into one_account from public.submissions s where s.organization_id = i.agency_id and s.referral_source = src.id::text order by s.created_at limit 1;
  if p_action = 'approve' then
    if src.id is null then raise exception 'That partner no longer exists.' using errcode = '22023'; end if;
    if p_partner_fee_cents is not null and (p_partner_fee_cents < 0 or p_partner_fee_cents > 10000000) then raise exception 'Enter the agreed amount in dollars.' using errcode = '22023'; end if;
    update public.referral_sources set status = 'approved', partner_fee_cents = p_partner_fee_cents, updated_at = now() where id = src.id;
    result := 'approved';
    msg := format('%s was approved as a referral partner.', src.name);
  elsif p_action = 'merge' then
    select * into target from public.referral_sources r where r.id = p_merge_into and r.agency_id = i.agency_id and r.status = 'approved';
    if target.id is null or target.id = src.id then raise exception 'Choose the existing partner to merge it into.' using errcode = '22023'; end if;
    update public.submissions set referral_source = target.id::text where organization_id = i.agency_id and referral_source = src.id::text;
    delete from public.referral_sources where id = src.id;
    result := 'merged';
    msg := format('%s is the same partner as %s; the account now shows %s.', coalesce(src.name, i.detail ->> 'name'), target.name, target.name);
  elsif p_action = 'reject' then
    update public.submissions set referral_source = null where organization_id = i.agency_id and referral_source = src.id::text;
    delete from public.referral_sources where id = src.id;
    result := 'rejected';
    msg := format('%s wasn''t approved as a referral partner. Choose the client''s referral partner again.', coalesce(src.name, i.detail ->> 'name'));
  else
    raise exception 'Choose approve, merge or reject.' using errcode = '22023';
  end if;
  update public.admin_review_items
     set status = 'resolved', resolution = result, resolved_by = auth.uid(), resolved_at = now(),
         detail = detail || jsonb_build_object('merged_into', target.name, 'partner_fee_cents', p_partner_fee_cents)
   where id = p_id;
  update public.notifications set read_at = now() where review_item_id = p_id and read_at is null;
  -- The agent who added it hears back.
  if i.created_by is not null and i.created_by <> auth.uid() then
    insert into public.notifications (user_id, type, submission_id, message, actor_name)
    values (i.created_by, 'referral_update', one_account, msg,
            (select coalesce(nullif(btrim(p.display_name), ''), 'An admin') from public.profiles p where p.user_id = auth.uid()));
  end if;
  return result;
end $$;
revoke all on function public.resolve_referral_partner(uuid, text, bigint, uuid) from public, anon;
grant execute on function public.resolve_referral_partner(uuid, text, bigint, uuid) to authenticated;

-- Admin Review list: as in 0080, plus `detail` (for a new partner: its name, and the accounts that use it).
drop function if exists public.admin_review_items();
create function public.admin_review_items()
returns table (id uuid, kind text, status text, created_at timestamptz, created_by_name text, submission_id text, account_name text, account_archived boolean,
               account_agent text, related jsonb, resolution text, resolved_by_name text, resolved_at timestamptz, detail jsonb)
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
         i.resolved_at,
         case when i.kind = 'new_referral_partner' then
           i.detail || jsonb_build_object(
             'requested_by', i.created_by,
             'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.named_insured,
                            'agentId', coalesce(o.assigned_user_id, o.user_id),
                            'agent', (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = coalesce(o.assigned_user_id, o.user_id)))
                            order by o.named_insured)
                          from public.submissions o where o.organization_id = i.agency_id and o.referral_source = i.detail ->> 'source_id'), '[]'::jsonb))
         else i.detail end
    from public.admin_review_items i
    left join public.submissions s on s.id = i.submission_id
   where auth.uid() is not null and public.is_agency_admin() and i.agency_id = public.current_agency_id()
     and (i.status = 'open' or i.id in (select x.id from public.admin_review_items x where x.agency_id = i.agency_id and x.status = 'resolved' order by x.resolved_at desc limit 50))
   order by (i.status = 'open') desc, i.created_at desc
$$;
revoke all on function public.admin_review_items() from public, anon;
grant execute on function public.admin_review_items() to authenticated;

-- Broker fee splits (as in 0081), plus `partner_pending`: the client's partner awaits approval, so no amounts yet.
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
    select r.*, src.name as src_name, coalesce(src.status = 'pending', false) as pending,
           case when r.nth = 1 and src.active is not null then least(coalesce(src.partner_fee_cents, 0), r.fee) else 0 end as partner,
           case when r.nth = 1 and src.active is not null then greatest(coalesce(src.partner_fee_cents, 0) - r.fee, 0) else 0 end as shortfall
      from ranked r
      left join public.referral_sources src on src.id::text = r.referral_source
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
