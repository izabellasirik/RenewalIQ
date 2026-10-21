-- Rollback for 0070: back to 0043's analytics (what production runs today). Events recorded meanwhile
-- are kept (the old name rule is added NOT VALID so they stay); test-user flags are kept in their
-- table but no longer read. Re-running 0070 restores everything.
alter table public.product_events drop constraint if exists product_events_event_name_check;
alter table public.product_events add constraint product_events_event_name_check check (event_name in (
    'account_created', 'account_imported', 'account_opened_on_later_day',
    'intake_link_created', 'intake_submitted', 'intake_imported',
    'document_uploaded', 'document_processed', 'ai_extraction_completed',
    'risk_profile_generated', 'risk_profile_reviewed', 'risk_profile_completed',
    'application_reviewed', 'application_downloaded',
    'market_search_completed', 'carrier_appetite_generated', 'carrier_match_opened', 'market_added_to_account',
    'market_added', 'market_status_changed', 'quote_added', 'quote_updated',
    'follow_up_created', 'follow_up_completed'
  )) not valid;

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
     order by e.occurred_at
     limit 50000
  ), uids as (
    select distinct user_id from ev where user_id is not null
  ), aids as (
    select distinct account_id from ev where account_id is not null
  )
  select jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.event_name, 'at', e.occurred_at, 'userId', e.user_id,
                                         'orgId', e.organization_id, 'accountId', e.account_id, 'metadata', e.metadata) order by e.occurred_at) from ev e), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', u.user_id,
                 'name', coalesce(nullif(btrim(p.display_name), ''), au.email, 'Unknown user'),
                 'email', au.email,
                 'orgId', p.agency_id,
                 'isFounder', lower(coalesce(au.email, '')) = 'anism.academy@gmail.com',
                 'firstSeen', (select min(x.occurred_at) from public.product_events x where x.user_id = u.user_id),
                 'lastSeen', (select max(x.occurred_at) from public.product_events x where x.user_id = u.user_id)))
               from uids u left join public.profiles p on p.user_id = u.user_id left join auth.users au on au.id = u.user_id), '[]'::jsonb),
    'orgs', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name)) from public.agencies a
                       where a.id in (select organization_id from ev) or a.id in (select p.agency_id from public.profiles p where p.user_id in (select user_id from uids))), '[]'::jsonb),
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

drop function if exists public.analytics_event_is_meaningful(text, text, uuid);
drop function if exists public.set_user_analytics_test(uuid, boolean);
drop function if exists public.analytics_user_is_test(uuid);
