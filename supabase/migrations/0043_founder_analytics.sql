-- Founder Analytics: meaningful product-usage events, Real vs Test accounts, time-saved answers, and
-- a cross-brokerage read that only the founder can run.
--
-- * product_events — one row per meaningful action (account created/imported, document processed,
--   application downloaded, market added, quote added, follow-up completed, …). Written ONLY through
--   track_product_event() (the signed-in user, their agency and — if they may access it — the account
--   are stamped server-side; the event name must be on the list; metadata is cut down to a few
--   whitelisted, non-sensitive keys) or by the intake triggers below. Nobody can read the table
--   directly: no policies, no grants.
-- * account_analytics_flags — the founder's explicit Real / Test-Demo call for an account. Without
--   one, an account is Test/Demo when it is the built-in sample account, holds the sample documents
--   (flagged automatically), or its name says so (test, demo, sample, example, dummy, fake).
-- * time_saved_responses — the broker's occasional answer to "how long would this normally take?".
-- * is_founder() — true only for the signed-in, email-confirmed auth user anism.academy@gmail.com,
--   decided in the database. founder_analytics_snapshot() refuses everyone else, so typing the URL
--   gets no data.
--
-- Analytics never blocks work: every write path swallows its own errors. Additive; safe to run more
-- than once. Needs 0042 (and 0011/0029).

-- --------------------------------------------------------------------------------------------
-- Who is the founder
-- --------------------------------------------------------------------------------------------
create or replace function public.is_founder() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
     where u.id = auth.uid() and lower(u.email) = 'anism.academy@gmail.com' and u.email_confirmed_at is not null
  )
$$;
revoke all on function public.is_founder() from public, anon;
grant execute on function public.is_founder() to authenticated;

-- --------------------------------------------------------------------------------------------
-- Events
-- --------------------------------------------------------------------------------------------
create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name in (
    'account_created', 'account_imported', 'account_opened_on_later_day',
    'intake_link_created', 'intake_submitted', 'intake_imported',
    'document_uploaded', 'document_processed', 'ai_extraction_completed',
    'risk_profile_generated', 'risk_profile_reviewed', 'risk_profile_completed',
    'application_reviewed', 'application_downloaded',
    'market_search_completed', 'carrier_appetite_generated', 'carrier_match_opened', 'market_added_to_account',
    'market_added', 'market_status_changed', 'quote_added', 'quote_updated',
    'follow_up_created', 'follow_up_completed'
  )),
  occurred_at timestamptz not null default now(),
  user_id uuid,
  organization_id uuid,
  account_id text,
  -- Real/Test as it was when the event happened (the dashboard uses the account's CURRENT call).
  is_test boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  -- Optional: an action that should count once (e.g. one "opened on a later day" per account per day).
  dedupe_key text
);
create index if not exists product_events_occurred_idx on public.product_events (occurred_at);
create index if not exists product_events_user_idx on public.product_events (user_id, occurred_at);
create index if not exists product_events_account_idx on public.product_events (account_id, occurred_at);
create index if not exists product_events_org_idx on public.product_events (organization_id, occurred_at);
create index if not exists product_events_name_idx on public.product_events (event_name, occurred_at);
create unique index if not exists product_events_dedupe_idx on public.product_events (dedupe_key) where dedupe_key is not null;
alter table public.product_events enable row level security;
revoke all on public.product_events from public, anon, authenticated;

create table if not exists public.account_analytics_flags (
  account_id text primary key,
  mode text not null check (mode in ('real', 'test')),
  set_by uuid,
  set_at timestamptz not null default now()
);
alter table public.account_analytics_flags enable row level security;
revoke all on public.account_analytics_flags from public, anon, authenticated;

-- Real or Test/Demo, right now.
create or replace function public.analytics_account_is_test(p_account_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_account_id is null then false
    when p_account_id = 'acct_abc_transportation' and not exists (select 1 from public.account_analytics_flags f where f.account_id = p_account_id) then true
    when exists (select 1 from public.account_analytics_flags f where f.account_id = p_account_id) then
      (select f.mode = 'test' from public.account_analytics_flags f where f.account_id = p_account_id)
    else coalesce((
      select s.id = 'acct_abc_transportation'
          or s.named_insured ~* '\m(test|testing|demo|sample|example|dummy|fake)\M'
        from public.submissions s where s.id = p_account_id), false)
  end
$$;
revoke all on function public.analytics_account_is_test(text) from public, anon, authenticated;

-- Only these metadata keys, short scalar values — never names, documents, drivers, DOT numbers.
create or replace function public.analytics_clean_metadata(p jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'string' then to_jsonb(left(v #>> '{}', 40)) else v end), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) as e(k, v)
   where k in ('source', 'count', 'method', 'status', 'workflow', 'fields', 'stage')
     and jsonb_typeof(v) in ('string', 'number', 'boolean')
$$;

/** The one write path for the app. Never raises: analytics must not get in the way. */
create or replace function public.track_product_event(p_event_name text, p_account_id text default null, p_metadata jsonb default '{}'::jsonb, p_dedupe_key text default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_account text := nullif(btrim(p_account_id), '');
  v_org uuid;
begin
  if auth.uid() is null then
    return false;
  end if;
  -- An account the caller can't access isn't attached (an id for a not-yet-saved account is kept).
  if v_account is not null and exists (select 1 from public.submissions s where s.id = v_account)
     and not public.can_access_submission(v_account) then
    v_account := null;
  end if;
  v_org := coalesce((select s.organization_id from public.submissions s where s.id = v_account), public.current_agency_id());
  insert into public.product_events (event_name, user_id, organization_id, account_id, is_test, metadata, dedupe_key)
  values (p_event_name, auth.uid(), v_org, v_account, public.analytics_account_is_test(v_account), public.analytics_clean_metadata(p_metadata),
          case when p_dedupe_key is null then null else left(auth.uid()::text || ':' || p_dedupe_key, 200) end)
  on conflict do nothing;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function public.track_product_event(text, text, jsonb, text) from public, anon;
grant execute on function public.track_product_event(text, text, jsonb, text) to authenticated;

-- The client can't do it (no login): the database records intake events itself.
create or replace function public.intake_product_events() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := (select p.agency_id from public.profiles p where p.user_id = new.user_id);
begin
  if new.completed_at is not null and old.completed_at is null then
    insert into public.product_events (event_name, occurred_at, user_id, organization_id, metadata, dedupe_key)
    values ('intake_submitted', new.completed_at, new.user_id, v_org, '{"source":"intake_link"}', 'intake_submitted:' || new.id)
    on conflict do nothing;
  end if;
  if new.imported_account_id is not null and new.imported_account_id is distinct from old.imported_account_id then
    insert into public.product_events (event_name, user_id, organization_id, account_id, is_test, metadata, dedupe_key)
    values ('intake_imported', coalesce(auth.uid(), new.user_id),
            coalesce((select s.organization_id from public.submissions s where s.id = new.imported_account_id), v_org),
            new.imported_account_id, public.analytics_account_is_test(new.imported_account_id), '{"source":"intake_link"}',
            'intake_imported:' || new.id || ':' || new.imported_account_id)
    on conflict do nothing;
  end if;
  return null;
exception when others then
  return null; -- never blocks a submission or an import
end;
$$;
drop trigger if exists intake_product_events on public.intake_submissions;
create trigger intake_product_events after update of completed_at, imported_account_id on public.intake_submissions
  for each row execute function public.intake_product_events();

-- --------------------------------------------------------------------------------------------
-- Time saved ("how long would this normally have taken?")
-- --------------------------------------------------------------------------------------------
create table if not exists public.time_saved_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_id uuid,
  account_id text,
  workflow text not null check (workflow in ('application', 'market_research', 'intake_import')),
  answer text not null check (answer in ('lt5', '5to15', '15to30', '30to60', '60plus', 'skipped')),
  -- How long the Renewal IQ workflow itself took, when it could be measured reliably (else null).
  rq_minutes numeric,
  created_at timestamptz not null default now()
);
create unique index if not exists time_saved_once_idx on public.time_saved_responses (user_id, coalesce(account_id, ''), workflow);
create index if not exists time_saved_created_idx on public.time_saved_responses (created_at);
alter table public.time_saved_responses enable row level security;
revoke all on public.time_saved_responses from public, anon, authenticated;

create or replace function public.record_time_saved(p_workflow text, p_account_id text, p_answer text, p_rq_minutes numeric default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_account text := nullif(btrim(p_account_id), '');
begin
  if auth.uid() is null then return false; end if;
  if v_account is not null and exists (select 1 from public.submissions s where s.id = v_account) and not public.can_access_submission(v_account) then
    v_account := null;
  end if;
  insert into public.time_saved_responses (user_id, organization_id, account_id, workflow, answer, rq_minutes)
  values (auth.uid(), public.current_agency_id(), v_account, p_workflow, p_answer,
          case when p_rq_minutes is not null and p_rq_minutes > 0 and p_rq_minutes <= 480 then round(p_rq_minutes, 1) end)
  on conflict do nothing;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function public.record_time_saved(text, text, text, numeric) from public, anon;
grant execute on function public.record_time_saved(text, text, text, numeric) to authenticated;

-- --------------------------------------------------------------------------------------------
-- Founder-only reads and the Real/Test switch
-- --------------------------------------------------------------------------------------------
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

-- The founder marks an account Real or Test/Demo ('auto' = back to the automatic rule).
create or replace function public.set_account_analytics_mode(p_account_id text, p_mode text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_founder() then
    raise exception 'Only the founder can change this.' using errcode = '42501';
  end if;
  if p_mode = 'auto' then
    delete from public.account_analytics_flags where account_id = p_account_id;
  elsif p_mode in ('real', 'test') then
    insert into public.account_analytics_flags (account_id, mode, set_by) values (p_account_id, p_mode, auth.uid())
    on conflict (account_id) do update set mode = excluded.mode, set_by = excluded.set_by, set_at = now();
  else
    raise exception 'Unknown mode.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.set_account_analytics_mode(text, text) from public, anon;
grant execute on function public.set_account_analytics_mode(text, text) to authenticated;

-- Loading the sample documents into an account makes it a demo account — for the founder's numbers
-- only; nothing about the account itself changes. Callable by anyone who can access the account.
create or replace function public.mark_account_demo(p_account_id text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or (exists (select 1 from public.submissions s where s.id = p_account_id) and not public.can_access_submission(p_account_id)) then
    return;
  end if;
  insert into public.account_analytics_flags (account_id, mode, set_by) values (p_account_id, 'test', auth.uid())
  on conflict (account_id) do nothing;
exception when others then
  return;
end;
$$;
revoke all on function public.mark_account_demo(text) from public, anon;
grant execute on function public.mark_account_demo(text) to authenticated;
