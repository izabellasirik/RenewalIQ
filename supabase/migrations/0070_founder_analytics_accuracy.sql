-- 0070: Founder Analytics counts real broker work, accurately.
--
-- Production runs 0043's analytics (0047 isn't installed there). This brings back only 0047's
-- analytics part and fixes what the audit found — nothing else from 0047 (no requests, quotas or
-- self-service agencies), and no RLS policy, invitation or access rule (0051/0069) is touched.
--
--   * Every event name the app sends is accepted. Before, names added after 0043 (client document
--     requests, requirements, agency created) were refused and silently dropped by
--     track_product_event, which never raises.
--   * New events for work that wasn't tracked: account_updated, note_added, follow_up_updated,
--     policy_bound, email_reviewed, email_draft_opened.
--   * Designated test users (set by the founder): their activity is test activity, like a test account.
--   * "Meaningful" activity (a broker doing work) excludes re-opening an account, a client submitting
--     an intake form (stored under the link's broker), test accounts and test users.
--   * founder_analytics_snapshot = 0047's version (members, roles, join dates, first/last real
--     activity, open invitations, sign-ups with no agency) + each user's test flag, and when a range
--     has more than 50,000 events it keeps the newest, not the oldest.
--
-- No existing event, flag or response is changed or deleted; history keeps its stored values.
-- Additive and re-runnable. Needs 0043. Rollback: supabase/release/rollback_0070.sql.

-- 1. Every event name the app sends (src/services/productAnalytics/trackEvent.ts — a unit test keeps the two lists equal).
alter table public.product_events drop constraint if exists product_events_event_name_check;
alter table public.product_events add constraint product_events_event_name_check check (event_name in (
  'account_created', 'account_imported', 'account_opened_on_later_day',
  'intake_link_created', 'intake_submitted', 'intake_imported',
  'document_uploaded', 'document_processed', 'ai_extraction_completed',
  'risk_profile_generated', 'risk_profile_reviewed', 'risk_profile_completed',
  'application_reviewed', 'application_downloaded',
  'market_search_completed', 'carrier_appetite_generated', 'carrier_match_opened', 'market_added_to_account',
  'market_added', 'market_status_changed', 'quote_added', 'quote_updated',
  'follow_up_created', 'follow_up_completed',
  'requirements_added', 'document_request_prepared', 'document_request_sent', 'requested_document_received',
  'requirement_verified', 'requirement_not_applicable', 'agency_created',
  'account_updated', 'note_added', 'follow_up_updated', 'policy_bound', 'email_reviewed', 'email_draft_opened'
)) not valid;
-- NOT VALID: existing rows aren't re-checked (every stored name is in the list anyway); new rows are.

-- 2. Test users: the founder designates logins whose activity isn't real broker usage.
create table if not exists public.analytics_test_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  set_by uuid,
  set_at timestamptz not null default now()
);
alter table public.analytics_test_users enable row level security;
revoke all on public.analytics_test_users from public, anon, authenticated;

create or replace function public.analytics_user_is_test(p_user_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user_id is not null and exists (select 1 from public.analytics_test_users t where t.user_id = p_user_id)
$$;
revoke all on function public.analytics_user_is_test(uuid) from public, anon, authenticated;

create or replace function public.set_user_analytics_test(p_user_id uuid, p_test boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_founder() then
    raise exception 'Only the founder can change this.' using errcode = '42501';
  end if;
  if p_test then
    insert into public.analytics_test_users (user_id, set_by) values (p_user_id, auth.uid()) on conflict (user_id) do nothing;
  else
    delete from public.analytics_test_users where user_id = p_user_id;
  end if;
end;
$$;
revoke all on function public.set_user_analytics_test(uuid, boolean) from public, anon;
grant execute on function public.set_user_analytics_test(uuid, boolean) to authenticated;

-- 3. A broker doing real work (0047's rule + client intake submissions + test users).
create or replace function public.analytics_event_is_meaningful(p_event_name text, p_account_id text, p_user_id uuid default null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_event_name not in ('account_opened_on_later_day', 'intake_submitted')
     and (p_account_id is null or not public.analytics_account_is_test(p_account_id))
     and not public.analytics_user_is_test(p_user_id)
$$;
revoke all on function public.analytics_event_is_meaningful(text, text, uuid) from public, anon, authenticated;
drop function if exists public.analytics_event_is_meaningful(text, text);

-- 4. The founder's snapshot (0047's, plus isTest per user and newest-first truncation).
create or replace function public.founder_analytics_snapshot(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  if not public.is_founder() then
    raise exception 'Founder Analytics is not available for this account.' using errcode = '42501';
  end if;
  with ev as (
    select e.* from public.product_events e
     where e.occurred_at >= p_from and e.occurred_at < p_to
     order by e.occurred_at desc
     limit 50000
  ), uids as (
    select distinct user_id from ev where user_id is not null
    union
    select p.user_id from public.profiles p
  ), aids as (
    select distinct account_id from ev where account_id is not null
  ), meaningful as (
    select x.user_id, min(x.occurred_at) as first_at, max(x.occurred_at) as last_at
      from public.product_events x
     where x.user_id is not null and public.analytics_event_is_meaningful(x.event_name, x.account_id, x.user_id)
     group by x.user_id
  )
  select jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.event_name, 'at', e.occurred_at, 'userId', e.user_id,
                                         'orgId', e.organization_id, 'accountId', e.account_id, 'metadata', e.metadata) order by e.occurred_at) from ev e), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', u.user_id,
                 'name', coalesce(nullif(btrim(p.display_name), ''), au.email, 'Unknown user'),
                 'email', au.email,
                 'orgId', p.agency_id,
                 'role', p.role,
                 'joinedAt', p.created_at,
                 'isFounder', lower(coalesce(au.email, '')) = 'anism.academy@gmail.com',
                 'isTest', public.analytics_user_is_test(u.user_id),
                 'firstSeen', (select min(x.occurred_at) from public.product_events x where x.user_id = u.user_id),
                 'lastSeen', (select max(x.occurred_at) from public.product_events x where x.user_id = u.user_id),
                 'firstMeaningful', m.first_at,
                 'lastMeaningful', m.last_at))
               from uids u left join public.profiles p on p.user_id = u.user_id left join auth.users au on au.id = u.user_id
               left join meaningful m on m.user_id = u.user_id), '[]'::jsonb),
    'orgs', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'createdAt', a.created_at)) from public.agencies a), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('orgId', i.agency_id, 'email', i.email, 'role', i.role, 'createdAt', i.created_at,
                                                'status', case when i.expires_at < now() then 'expired' else 'open' end))
                               from public.agency_invitations i where i.accepted_at is null and i.revoked_at is null), '[]'::jsonb),
    'unaffiliatedSignups', (select count(*) from auth.users au
                             where not exists (select 1 from public.profiles p where p.user_id = au.id)
                               and not exists (select 1 from meaningful m where m.user_id = au.id)
                               and not public.analytics_user_is_test(au.id)
                               and lower(coalesce(au.email, '')) <> 'anism.academy@gmail.com'),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', a.account_id,
                 'name', s.named_insured,
                 'orgId', s.organization_id,
                 'createdAt', s.created_at,
                 'isTest', public.analytics_account_is_test(a.account_id),
                 'flag', (select f.mode from public.account_analytics_flags f where f.account_id = a.account_id)))
               from aids a left join public.submissions s on s.id = a.account_id), '[]'::jsonb),
    'timeSaved', coalesce((select jsonb_agg(jsonb_build_object('userId', t.user_id, 'orgId', t.organization_id, 'accountId', t.account_id, 'workflow', t.workflow,
                                            'answer', t.answer, 'rqMinutes', t.rq_minutes, 'at', t.created_at))
                             from public.time_saved_responses t where t.created_at >= p_from and t.created_at < p_to), '[]'::jsonb),
    'truncated', (select count(*) from public.product_events e where e.occurred_at >= p_from and e.occurred_at < p_to) > 50000
  ) into v;
  return v;
end;
$$;
revoke all on function public.founder_analytics_snapshot(timestamptz, timestamptz) from public, anon;
grant execute on function public.founder_analytics_snapshot(timestamptz, timestamptz) to authenticated;
