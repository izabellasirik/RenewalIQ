-- 0046: AI reads — kept once, counted, and priced.
--
-- * ai_read_cache    — the result of every successful AI read (structured extraction or preview
--   transcription) of one image / one scanned PDF page, so the same page is never paid for twice:
--   reopening the preview, refreshing the browser, another device, or the same file uploaded again
--   all reuse it. A 'pending' row is the in-flight lock: a second request for the same page waits
--   for the first instead of making its own call. Holds extracted document data, so it is readable
--   only by the extract-document-vision Edge Function (service role) — never by brokers or clients.
--   Scoped per brokerage (or per broker without one): one brokerage never reads another's results.
--
-- * ai_usage_events  — one row per AI read request: who/where (brokerage, user, account, document,
--   page), what (operation, model), the token counts Anthropic reported, the cost in USD, whether it
--   succeeded, and whether it was answered from the cache (no new paid call). No document content,
--   no API keys. Written only by the Edge Function; read only through founder_ai_usage() — the
--   founder (is_founder(), 0043) and no one else.
--
-- Prices live in one place: supabase/functions/extract-document-vision/pricing.ts. The cost is
-- computed when the call is made and stored on the row, so a later price change never rewrites
-- history.
--
-- Additive and re-runnable.

create table if not exists public.ai_read_cache (
  cache_key text primary key,
  scope text not null,
  operation text not null check (operation in ('structured_extraction', 'transcription')),
  status text not null check (status in ('pending', 'done')),
  result jsonb,
  model text,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.ai_read_cache enable row level security;
revoke all on public.ai_read_cache from public, anon, authenticated;

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  organization_id uuid,
  user_id uuid,
  account_id text,
  document_id text,
  file_name text,
  page_number integer,
  operation text not null check (operation in ('structured_extraction', 'transcription')),
  source_kind text check (source_kind in ('photo', 'scanned_pdf_page')),
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  total_tokens integer generated always as (input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens) stored,
  cost_usd numeric(12, 6) not null default 0,
  succeeded boolean not null,
  from_cache boolean not null default false,
  error_code text
);
create index if not exists ai_usage_events_occurred_idx on public.ai_usage_events (occurred_at);
create index if not exists ai_usage_events_org_idx on public.ai_usage_events (organization_id, occurred_at);
create index if not exists ai_usage_events_document_idx on public.ai_usage_events (document_id);
alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from public, anon, authenticated;

-- --------------------------------------------------------------------------------------------
-- The cache's claim / complete / release — service role only (the Edge Function).
-- --------------------------------------------------------------------------------------------

-- 'hit' with the stored result; 'claimed' (this caller makes the call); or 'busy' (another request
-- for the same page is in flight — wait and ask again). A claim older than p_stale_seconds was
-- abandoned (the function timed out) and is taken over.
create or replace function public.ai_read_claim(p_key text, p_scope text, p_operation text, p_stale_seconds integer default 180)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.ai_read_cache;
begin
  insert into public.ai_read_cache (cache_key, scope, operation, status)
  values (p_key, p_scope, p_operation, 'pending')
  on conflict (cache_key) do nothing;
  if found then
    return jsonb_build_object('state', 'claimed');
  end if;
  select * into r from public.ai_read_cache where cache_key = p_key for update;
  if r.status = 'done' then
    return jsonb_build_object('state', 'hit', 'result', r.result, 'model', r.model);
  end if;
  if r.claimed_at < now() - make_interval(secs => p_stale_seconds) then
    update public.ai_read_cache set claimed_at = now() where cache_key = p_key;
    return jsonb_build_object('state', 'claimed');
  end if;
  return jsonb_build_object('state', 'busy');
end;
$$;

create or replace function public.ai_read_complete(p_key text, p_result jsonb, p_model text)
returns void
language sql security definer set search_path = ''
as $$
  update public.ai_read_cache set status = 'done', result = p_result, model = p_model, completed_at = now() where cache_key = p_key;
$$;

-- A failed call frees the page so the next request tries again (failures are never cached).
create or replace function public.ai_read_release(p_key text)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.ai_read_cache where cache_key = p_key and status = 'pending';
$$;

revoke all on function public.ai_read_claim(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.ai_read_complete(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.ai_read_release(text) from public, anon, authenticated;
do $$ begin
  grant select, insert, update, delete on public.ai_read_cache to service_role;
  grant select, insert on public.ai_usage_events to service_role;
  grant execute on function public.ai_read_claim(text, text, text, integer) to service_role;
  grant execute on function public.ai_read_complete(text, jsonb, text) to service_role;
  grant execute on function public.ai_read_release(text) to service_role;
exception when undefined_object then null; -- (a plain Postgres without Supabase's roles)
end $$;

-- --------------------------------------------------------------------------------------------
-- Founder-only: AI Usage & Cost
-- --------------------------------------------------------------------------------------------
-- Days, weeks and months are the founder's own (p_tz, e.g. 'America/New_York'); weeks start Monday.
create or replace function public.founder_ai_usage(p_tz text default 'UTC')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  tz text := coalesce(nullif(p_tz, ''), 'UTC');
  local_now timestamp;
  day_start timestamptz;
  week_start timestamptz;
  month_start timestamptz;
  trend_start timestamptz;
  v jsonb;
begin
  if not public.is_founder() then
    raise exception 'Founder Analytics is not available for this account.' using errcode = '42501';
  end if;
  begin
    local_now := now() at time zone tz;
  exception when others then
    tz := 'UTC';
    local_now := now() at time zone tz;
  end;
  day_start := date_trunc('day', local_now) at time zone tz;
  week_start := date_trunc('week', local_now) at time zone tz;
  month_start := date_trunc('month', local_now) at time zone tz;
  trend_start := (date_trunc('day', local_now) - interval '29 days') at time zone tz;

  with m as (
    select * from public.ai_usage_events e where e.occurred_at >= least(month_start, week_start)
  ), mo as (
    select * from m where m.occurred_at >= month_start
  )
  select jsonb_build_object(
    'timezone', tz,
    'costToday', coalesce((select sum(cost_usd) from m where occurred_at >= day_start), 0),
    'costWeek', coalesce((select sum(cost_usd) from m where occurred_at >= week_start), 0),
    'costMonth', coalesce((select sum(cost_usd) from mo), 0),
    'documentsMonth', (select count(distinct document_id) from mo where succeeded and document_id is not null),
    'scannedPagesMonth', (select count(distinct (document_id, page_number)) from mo where succeeded and source_kind = 'scanned_pdf_page'),
    'paidCallsMonth', (select count(*) from mo where not from_cache),
    'failedCallsMonth', (select count(*) from mo where not succeeded),
    'cachedReadsMonth', (select count(*) from mo where from_cache and succeeded),
    'tokensMonth', coalesce((select sum(total_tokens) from mo), 0),
    'avgCostPerDocumentMonth', (select round(sum(cost_usd) / nullif(count(distinct document_id), 0), 6) from mo where document_id is not null),
    'topDocumentMonth', (
      select jsonb_build_object('documentId', document_id, 'fileName', max(file_name), 'accountId', max(account_id), 'cost', sum(cost_usd), 'calls', count(*) filter (where not from_cache))
        from mo where document_id is not null group by document_id order by sum(cost_usd) desc limit 1),
    'byModel', coalesce((
      select jsonb_agg(jsonb_build_object('model', x.model, 'calls', x.calls, 'inputTokens', x.it, 'outputTokens', x.ot, 'cost', x.cost) order by x.cost desc)
        from (select coalesce(model, 'unknown') as model, count(*) filter (where not from_cache) as calls, sum(input_tokens) as it, sum(output_tokens) as ot, sum(cost_usd) as cost
                from mo group by 1) x), '[]'::jsonb),
    'byOperation', coalesce((
      select jsonb_agg(jsonb_build_object('operation', x.operation, 'calls', x.calls, 'cached', x.cached, 'cost', x.cost) order by x.cost desc)
        from (select operation, count(*) filter (where not from_cache) as calls, count(*) filter (where from_cache) as cached, sum(cost_usd) as cost from mo group by 1) x), '[]'::jsonb),
    'bySource', coalesce((
      select jsonb_agg(jsonb_build_object('source', x.source, 'calls', x.calls, 'cost', x.cost) order by x.cost desc)
        from (select coalesce(source_kind, 'unknown') as source, count(*) filter (where not from_cache) as calls, sum(cost_usd) as cost from mo group by 1) x), '[]'::jsonb),
    'byBrokerage', coalesce((
      select jsonb_agg(jsonb_build_object('orgId', x.organization_id, 'name', coalesce(a.name, case when x.organization_id is null then 'No brokerage' else 'Unknown brokerage' end), 'calls', x.calls, 'documents', x.docs, 'cost', x.cost) order by x.cost desc)
        from (select organization_id, count(*) filter (where not from_cache) as calls, count(distinct document_id) as docs, sum(cost_usd) as cost from mo group by 1) x
        left join public.agencies a on a.id = x.organization_id), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'cost', coalesce(c.cost, 0), 'calls', coalesce(c.calls, 0)) order by d.day)
        from (select generate_series(date_trunc('day', local_now) - interval '29 days', date_trunc('day', local_now), interval '1 day')::date as day) d
        left join (select (e.occurred_at at time zone tz)::date as day, sum(e.cost_usd) as cost, count(*) filter (where not e.from_cache) as calls
                     from public.ai_usage_events e where e.occurred_at >= trend_start group by 1) c on c.day = d.day), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.founder_ai_usage(text) from public, anon;
grant execute on function public.founder_ai_usage(text) to authenticated;
