-- 0047: requests are "sent" only when the broker says so · AI reading quotas · self-service
-- agencies · reliable broker-adoption numbers for Founder Analytics.
--
-- 1. Client document requests get a delivery status:
--      prepared    — the secure link exists (the broker copied the email or opened it in Gmail),
--                    but nobody has said it was sent. No follow-up clock.
--      sent        — the broker marked it sent (sent_at = when, as they said).
--      unconfirmed — every request made BEFORE this migration: the old app created a request the
--                    moment the email was copied, so whether it was actually sent is unknown. These
--                    keep working exactly as before (follow-ups included); the broker can confirm.
--    New rows start 'prepared'. mark_document_request_sent() is the only way to 'sent'.
--
-- 2. AI reading quotas (service role only — the extract-document-vision function): a paid read is
--    allowed while the broker has made fewer than its daily limit and the agency fewer than its
--    limit today (UTC). ai_quota_take() counts today's paid reads plus reads in flight under a lock
--    per agency, so concurrent requests can't overshoot; ai_quota_release() frees a hold.
--
-- 3. Self-service agencies: create_my_agency(name) lets a signed-in owner with a confirmed email
--    who isn't in any agency create one and become its admin. Brokers still join an agency only
--    through an invitation (accept_agency_invitation, 0018) — there is no other way into one.
--
-- 4. Founder Analytics snapshot v2: first/last MEANINGFUL activity per broker (re-opening an
--    account and test/demo accounts don't count), every agency member and open invitation (so
--    invited-but-never-active people show), and signed-up users who never joined or created an
--    agency. Same founder-only check as before.
--
-- 5. New product event names for the missing-documents workflow.
--
-- Additive and re-runnable. Needs 0030, 0043, 0045, 0046.

-- --------------------------------------------------------------------------------------------
-- 1. Delivery status on client requests
-- --------------------------------------------------------------------------------------------
alter table public.document_requests add column if not exists sent_at timestamptz;
alter table public.document_requests add column if not exists delivery_status text;
-- Historical requests: delivery never verified → 'unconfirmed' (never 'sent').
update public.document_requests set delivery_status = 'unconfirmed' where delivery_status is null;
alter table public.document_requests alter column delivery_status set default 'prepared';
alter table public.document_requests alter column delivery_status set not null;
do $$ begin
  alter table public.document_requests add constraint document_requests_delivery_status_check check (delivery_status in ('prepared', 'sent', 'unconfirmed'));
exception when duplicate_object then null;
end $$;

-- The broker sent it (or confirms an older one was sent). p_sent_at: when, as the broker says
-- (defaults to now; never in the future). p_next_follow_up: the follow-up date they chose.
create or replace function public.mark_document_request_sent(p_request_id text, p_sent_at timestamptz default null, p_next_follow_up date default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.document_requests;
  v_at timestamptz := least(coalesce(p_sent_at, now()), now());
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into r from public.document_requests where id = p_request_id for update;
  if not found or not public.can_access_submission(r.submission_id) then
    raise exception 'Request not found.' using errcode = '42501';
  end if;
  if r.status = 'cancelled' then
    raise exception 'This request was cancelled.';
  end if;
  update public.document_requests
     set delivery_status = 'sent',
         sent_at = v_at,
         requested_at = v_at,
         next_follow_up = coalesce(p_next_follow_up, next_follow_up),
         updated_at = now()
   where id = r.id;
  return jsonb_build_object('id', r.id, 'deliveryStatus', 'sent', 'sentAt', v_at);
end;
$$;
revoke all on function public.mark_document_request_sent(text, timestamptz, date) from public, anon;
grant execute on function public.mark_document_request_sent(text, timestamptz, date) to authenticated;

-- --------------------------------------------------------------------------------------------
-- 2. AI reading quotas
-- --------------------------------------------------------------------------------------------
create table if not exists public.ai_quota_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  organization_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists ai_quota_holds_user_idx on public.ai_quota_holds (user_id, created_at);
create index if not exists ai_quota_holds_org_idx on public.ai_quota_holds (organization_id, created_at);
create index if not exists ai_usage_events_user_day_idx on public.ai_usage_events (user_id, occurred_at);
alter table public.ai_quota_holds enable row level security;
revoke all on public.ai_quota_holds from public, anon, authenticated;

-- A paid read for this broker (and agency) right now? Counts today's paid reads (UTC day; a read
-- answered from the cache is free and never counted) plus holds still in flight (< 10 minutes old).
create or replace function public.ai_quota_take(p_user uuid, p_org uuid, p_user_limit integer, p_org_limit integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_user_used integer := 0;
  v_org_used integer := 0;
  v_hold uuid;
begin
  -- One agency (or broker without one) at a time: concurrent reads can't both take the last slot.
  perform pg_advisory_xact_lock(hashtextextended('ai_quota:' || coalesce(p_org::text, p_user::text, 'none'), 0));
  delete from public.ai_quota_holds where created_at < now() - interval '10 minutes';
  if p_user is not null then
    select count(*) into v_user_used from public.ai_usage_events
     where user_id = p_user and occurred_at >= v_day and not from_cache and (succeeded or cost_usd > 0);
    v_user_used := v_user_used + (select count(*) from public.ai_quota_holds where user_id = p_user);
  end if;
  if p_org is not null then
    select count(*) into v_org_used from public.ai_usage_events
     where organization_id = p_org and occurred_at >= v_day and not from_cache and (succeeded or cost_usd > 0);
    v_org_used := v_org_used + (select count(*) from public.ai_quota_holds where organization_id = p_org);
  end if;
  if p_user is not null and v_user_used >= p_user_limit then
    return jsonb_build_object('allowed', false, 'reason', 'user_daily_limit', 'userUsed', v_user_used, 'orgUsed', v_org_used);
  end if;
  if p_org is not null and v_org_used >= p_org_limit then
    return jsonb_build_object('allowed', false, 'reason', 'agency_daily_limit', 'userUsed', v_user_used, 'orgUsed', v_org_used);
  end if;
  insert into public.ai_quota_holds (user_id, organization_id) values (p_user, p_org) returning id into v_hold;
  return jsonb_build_object('allowed', true, 'holdId', v_hold, 'userUsed', v_user_used, 'orgUsed', v_org_used);
end;
$$;

-- The read finished (its usage row is written) or failed: the hold goes.
create or replace function public.ai_quota_release(p_hold uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.ai_quota_holds where id = p_hold;
$$;

revoke all on function public.ai_quota_take(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.ai_quota_release(uuid) from public, anon, authenticated;
do $$ begin
  grant select, insert, delete on public.ai_quota_holds to service_role;
  grant execute on function public.ai_quota_take(uuid, uuid, integer, integer) to service_role;
  grant execute on function public.ai_quota_release(uuid) to service_role;
exception when undefined_object then null;
end $$;

-- --------------------------------------------------------------------------------------------
-- 3. Self-service agency creation
-- --------------------------------------------------------------------------------------------
create or replace function public.create_my_agency(p_name text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_email text;
  v_confirmed timestamptz;
  v_meta jsonb;
  v_agency uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Enter your agency''s name (2–120 characters).';
  end if;
  select lower(u.email), u.email_confirmed_at, coalesce(u.raw_user_meta_data, '{}'::jsonb)
    into v_email, v_confirmed, v_meta
    from auth.users u where u.id = auth.uid();
  if v_confirmed is null then
    raise exception 'Confirm your email address first.' using errcode = '42501';
  end if;
  -- Serialise this user's attempts (a double click can't create two agencies).
  perform pg_advisory_xact_lock(hashtextextended('create_agency:' || auth.uid()::text, 0));
  if exists (select 1 from public.profiles p where p.user_id = auth.uid()) then
    raise exception 'You already belong to an agency.' using errcode = '42501';
  end if;
  insert into public.agencies (name) values (v_name) returning id into v_agency;
  insert into public.profiles (user_id, agency_id, role, email, display_name, phone, job_title)
  values (auth.uid(), v_agency, 'admin', v_email,
          nullif(btrim(v_meta ->> 'full_name'), ''), nullif(btrim(v_meta ->> 'work_phone'), ''), nullif(btrim(v_meta ->> 'job_title'), ''));
  return v_agency;
end;
$$;
revoke all on function public.create_my_agency(text) from public, anon;
grant execute on function public.create_my_agency(text) to authenticated;

-- --------------------------------------------------------------------------------------------
-- 5. Event names for the missing-documents workflow (and agency creation)
-- --------------------------------------------------------------------------------------------
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
  'requirement_verified', 'requirement_not_applicable', 'agency_created'
));

-- --------------------------------------------------------------------------------------------
-- 4. Founder Analytics snapshot v2
-- --------------------------------------------------------------------------------------------
-- "Meaningful" = any recorded workflow action except merely re-opening an account, on a real
-- (not test/demo) account or on no account at all.
create or replace function public.analytics_event_is_meaningful(p_event_name text, p_account_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_event_name <> 'account_opened_on_later_day' and (p_account_id is null or not public.analytics_account_is_test(p_account_id))
$$;
revoke all on function public.analytics_event_is_meaningful(text, text) from public, anon, authenticated;

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
    union
    select p.user_id from public.profiles p
  ), aids as (
    select distinct account_id from ev where account_id is not null
  ), meaningful as (
    select x.user_id, min(x.occurred_at) as first_at, max(x.occurred_at) as last_at
      from public.product_events x
     where x.user_id is not null and public.analytics_event_is_meaningful(x.event_name, x.account_id)
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
    -- Signed up, never joined or created an agency, and never did anything meaningful.
    'unaffiliatedSignups', (select count(*) from auth.users au
                             where not exists (select 1 from public.profiles p where p.user_id = au.id)
                               and not exists (select 1 from meaningful m where m.user_id = au.id)
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

-- Let the API see the new functions right away.
notify pgrst, 'reload schema';
