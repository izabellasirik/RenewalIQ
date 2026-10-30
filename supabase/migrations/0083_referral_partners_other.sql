-- 0083 Referral partners: "Other", and how a partner is paid. Needs 0080 and 0081.
--
-- * "Other": where the client's referral partner is picked (New Submission, intake import, the account, the policy
--   window), anyone can choose Other and type the partner's name and the amount the partner gets. It's for that
--   client only (agents don't add partners to the agency's list) and it counts right away. The account's referral
--   is 'other'; the name and amount are in account_other_referrals.
-- * When an agent does this, every admin of the agency gets a bell notification and an Admin Review item. An admin:
--     ok        — accepts it as typed;
--     change    — sets a different amount (the split follows);
--     add       — adds it to the partner list (Team and Partners → Partnerships) and the client uses that partner;
--     reject    — the client's referral goes back to "not set".
--   The agent hears back (bell) when it's changed, added or rejected.
-- * A partner (listed or Other) is paid once per client, and only on the client's VERY FIRST policy (by bound date):
--   when that policy has no broker fee, the partner gets nothing for that client (0081 paid on the first policy that
--   had one). The agent and the agency split every broker fee, after the partner's amount on that first one.
-- * When that first broker fee is less than the partner's amount, the partner still gets all of it: the rest comes
--   out of the agent commission on that policy (partner_shortfall_cents, shown to the agent too).
-- Additive; replaces broker_fee_splits and admin_review_items with versions that return more columns.
-- Needs 0026 too (who can see an account).
-- Re-runnable. Rollback: supabase/release/rollback_0083.sql.

do $$
begin
  if to_regclass('public.admin_review_items') is null or to_regclass('public.referral_sources') is null then
    raise exception '0083 needs 0080 and 0081.';
  end if;
end $$;

-- An account's referral can be 'other'.
alter table public.submissions drop constraint if exists submissions_referral_source;
alter table public.submissions add constraint submissions_referral_source
  check (referral_source is null or referral_source in ('none', 'other') or referral_source ~ '^[0-9a-f-]{36}$');

-- The client's "Other" partner: its name and amount. Read by whoever can see the account; written through
-- set_other_referral (anyone on the account) and resolve_other_referral (admins).
create table if not exists public.account_other_referrals (
  submission_id text primary key,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  partner_fee_cents bigint not null check (partner_fee_cents between 0 and 10000000),
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now()
);
alter table public.account_other_referrals enable row level security;
drop policy if exists account_other_referrals_read on public.account_other_referrals;
create policy account_other_referrals_read on public.account_other_referrals for select to authenticated
  using (agency_id = public.current_agency_id() and (public.is_agency_admin() or exists (select 1 from public.submissions s where s.id = submission_id)));
revoke all on public.account_other_referrals from public, anon, authenticated;
grant select on public.account_other_referrals to authenticated;

-- Admin Review: the new kind of item.
alter table public.admin_review_items alter column submission_id drop not null;
alter table public.admin_review_items drop constraint if exists admin_review_items_kind_check;
alter table public.admin_review_items add constraint admin_review_items_kind_check check (kind in ('possible_duplicate', 'other_referral'));
alter table public.admin_review_items drop constraint if exists admin_review_items_resolution_check;
alter table public.admin_review_items add constraint admin_review_items_resolution_check
  check (resolution in ('kept_both', 'archived_new', 'ok', 'changed', 'added', 'rejected'));

-- The agent hears back.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in ('assigned', 'collaborator_added', 'admin_review', 'referral_update'));

-- "Other": the client's partner name and amount. The account may not be saved yet (New Submission saves it right
-- after), so an id the agency doesn't have yet is accepted; one it has must be an account the caller can see.
-- An agent's (not an admin's) goes to Admin Review, with a bell to every admin; a newer one replaces an open item.
create or replace function public.set_other_referral(p_submission_id text, p_name text, p_partner_fee_cents bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  me uuid := auth.uid();
  nm text := btrim(coalesce(p_name, ''));
  owner_agency uuid;
  visible boolean;
  item uuid;
  who text;
  client text;
begin
  if me is null or a is null then raise exception 'Only members of an agency can set a referral partner.' using errcode = '42501'; end if;
  if coalesce(btrim(p_submission_id), '') = '' then raise exception 'No account.' using errcode = '22023'; end if;
  if nm = '' or length(nm) > 80 then raise exception 'Enter the partner''s name (up to 80 characters).' using errcode = '22023'; end if;
  if p_partner_fee_cents is null or p_partner_fee_cents < 0 or p_partner_fee_cents > 10000000 then raise exception 'Enter the partner''s amount in dollars.' using errcode = '22023'; end if;
  select s.organization_id, public.submission_visible_with_collaborators(s.organization_id, s.assigned_user_id, s.user_id, s.collaborator_ids) into owner_agency, visible
    from public.submissions s where s.id = p_submission_id;
  if owner_agency is not null and (owner_agency <> a or not coalesce(visible, false)) then raise exception 'That account isn''t yours to change.' using errcode = '42501'; end if;
  if exists (select 1 from public.account_other_referrals r where r.submission_id = p_submission_id and r.agency_id <> a) then raise exception 'That account isn''t yours to change.' using errcode = '42501'; end if;
  insert into public.account_other_referrals (submission_id, agency_id, name, partner_fee_cents, set_by, set_at)
  values (p_submission_id, a, nm, p_partner_fee_cents, me, now())
  on conflict (submission_id) do update set name = excluded.name, partner_fee_cents = excluded.partner_fee_cents, set_by = excluded.set_by, set_at = excluded.set_at;
  if public.is_agency_admin() then return; end if;
  update public.admin_review_items set status = 'resolved', resolution = 'changed', resolved_at = now(), detail = detail || '{"replaced": true}'::jsonb
   where agency_id = a and kind = 'other_referral' and submission_id = p_submission_id and status = 'open';
  insert into public.admin_review_items (agency_id, kind, submission_id, detail, created_by)
  values (a, 'other_referral', p_submission_id, jsonb_build_object('name', nm, 'partner_fee_cents', p_partner_fee_cents), me)
  returning id into item;
  select coalesce(nullif(btrim(p.display_name), ''), 'An agent') into who from public.profiles p where p.user_id = me;
  select nullif(btrim(s.named_insured), '') into client from public.submissions s where s.id = p_submission_id;
  insert into public.notifications (user_id, type, submission_id, message, actor_name, review_item_id)
  select p.user_id, 'admin_review', case when owner_agency is null then null else p_submission_id end,
         format('%s added Other partner %s ($%s)%s.', coalesce(who, 'An agent'), nm, to_char(p_partner_fee_cents / 100.0, 'FM999,999,990.00'),
                case when client is null then '' else ' for ' || client end),
         who, item
    from public.profiles p where p.agency_id = a and p.role = 'admin';
end $$;
revoke all on function public.set_other_referral(text, text, bigint) from public, anon;
grant execute on function public.set_other_referral(text, text, bigint) to authenticated;

-- Admins decide on an "Other" partner: ok, change (the amount), add (to the partner list), or reject.
create or replace function public.resolve_other_referral(p_id uuid, p_action text, p_partner_fee_cents bigint default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  i public.admin_review_items;
  o public.account_other_referrals;
  rid uuid;
  fee bigint;
  msg text;
  result text;
begin
  if auth.uid() is null or not public.is_agency_admin() then raise exception 'Only an agency admin can do this.' using errcode = '42501'; end if;
  select * into i from public.admin_review_items x where x.id = p_id for update;
  if i.id is null or i.agency_id is distinct from public.current_agency_id() or i.kind <> 'other_referral' then raise exception 'No such review item.' using errcode = '42501'; end if;
  if i.status <> 'open' then raise exception 'This was already decided.' using errcode = '22023'; end if;
  select * into o from public.account_other_referrals r where r.submission_id = i.submission_id and r.agency_id = i.agency_id;
  if p_action <> 'reject' and o.submission_id is null then raise exception 'This client''s Other partner was removed.' using errcode = '22023'; end if;
  fee := coalesce(p_partner_fee_cents, o.partner_fee_cents);
  if fee is not null and (fee < 0 or fee > 10000000) then raise exception 'Enter the amount in dollars.' using errcode = '22023'; end if;
  if p_action = 'ok' then
    result := 'ok';
  elsif p_action = 'change' then
    if p_partner_fee_cents is null then raise exception 'Enter the new amount.' using errcode = '22023'; end if;
    update public.account_other_referrals set partner_fee_cents = p_partner_fee_cents, set_by = auth.uid(), set_at = now() where submission_id = o.submission_id;
    result := 'changed';
    msg := format('%s amount changed to $%s (%s).', o.name, to_char(p_partner_fee_cents / 100.0, 'FM999,999,990.00'), coalesce((select named_insured from public.submissions where id = i.submission_id), 'the account'));
  elsif p_action = 'add' then
    select r.id into rid from public.referral_sources r where r.agency_id = i.agency_id and lower(btrim(r.name)) = lower(btrim(o.name));
    if rid is null then
      insert into public.referral_sources (agency_id, name, partner_fee_cents, active, created_by) values (i.agency_id, btrim(o.name), fee, true, auth.uid()) returning id into rid;
    end if;
    update public.submissions set referral_source = rid::text where id = i.submission_id and organization_id = i.agency_id and referral_source = 'other';
    delete from public.account_other_referrals where submission_id = o.submission_id;
    result := 'added';
    msg := format('%s added to referral partners.', o.name);
  elsif p_action = 'reject' then
    update public.submissions set referral_source = null where id = i.submission_id and organization_id = i.agency_id and referral_source = 'other';
    delete from public.account_other_referrals where submission_id = i.submission_id;
    result := 'rejected';
    msg := format('%s rejected for %s. Choose another referral partner.', coalesce(o.name, i.detail ->> 'name'),
                  coalesce((select named_insured from public.submissions where id = i.submission_id), 'the account'));
  else
    raise exception 'Choose ok, change, add or reject.' using errcode = '22023';
  end if;
  update public.admin_review_items
     set status = 'resolved', resolution = result, resolved_by = auth.uid(), resolved_at = now(),
         detail = detail || jsonb_build_object('final_fee_cents', fee)
   where id = p_id;
  update public.notifications set read_at = now() where review_item_id = p_id and read_at is null;
  if msg is not null and i.created_by is not null and i.created_by <> auth.uid() then
    insert into public.notifications (user_id, type, submission_id, message, actor_name)
    values (i.created_by, 'referral_update', (select id from public.submissions where id = i.submission_id), msg,
            (select coalesce(nullif(btrim(p.display_name), ''), 'An admin') from public.profiles p where p.user_id = auth.uid()));
  end if;
  return result;
end $$;
revoke all on function public.resolve_other_referral(uuid, text, bigint) from public, anon;
grant execute on function public.resolve_other_referral(uuid, text, bigint) to authenticated;

-- Admin Review list: as in 0080, plus `detail` (for an "Other" referral partner: its name and amount now).
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
         case when i.kind = 'other_referral' then
           i.detail || coalesce((select jsonb_build_object('current_name', r.name, 'current_fee_cents', r.partner_fee_cents)
                                   from public.account_other_referrals r where r.submission_id = i.submission_id), '{}'::jsonb)
         else i.detail end
    from public.admin_review_items i
    left join public.submissions s on s.id = i.submission_id
   where auth.uid() is not null and public.is_agency_admin() and i.agency_id = public.current_agency_id()
     and (i.status = 'open' or i.id in (select x.id from public.admin_review_items x where x.agency_id = i.agency_id and x.status = 'resolved' order by x.resolved_at desc limit 50))
   order by (i.status = 'open') desc, i.created_at desc
$$;
revoke all on function public.admin_review_items() from public, anon;
grant execute on function public.admin_review_items() to authenticated;

-- Broker fee splits (as in 0081): the partner is a listed one or the client's "Other" partner; paid on the client's very
-- first policy only; what the first broker fee doesn't cover comes out of the agent commission (partner_shortfall_cents).
-- partner_pending stays in the result for the app (always false now).
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
