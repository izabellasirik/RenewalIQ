-- 0068 Related Emails (Gmail, Phase 1): which of a broker's own Gmail threads relate to an account, and the
-- broker's review of each (Reviewed / Not Related / Undo). Read-only awareness: nothing here sends, drafts or
-- changes email, and nothing updates an account.
--
-- - Each row belongs to one mailbox owner. Only that owner sees their threads and links (not admins, not
--   other brokers), and only for accounts they can still open. Agencies never see each other's.
-- - No email bodies or attachments are stored: subject, sender, date and Gmail ids only.
-- - OAuth refresh tokens live in gmail_tokens, which signed-in users and the public can't read or write at
--   all (no policies, no grants); only the server (service role) uses it. They are stored encrypted.
-- - Threads are written by the server (service role) only. Suggestions come from the deterministic matcher
--   and are always "possible": only the broker confirms (or links an email to an account themselves). A thread the broker marked Not Related is never suggested again
--   for that account unless they restore it. A new Gmail message in a thread marked Reviewed returns it to
--   To Review for that broker only; the earlier review stays in email_link_events.
-- - Reviewed emails are kept (in the account's collapsed Reviewed list) until the agency's retention policy
--   removes them; nothing here deletes them.
-- Re-runnable.

create table if not exists public.gmail_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  agency_id uuid references public.agencies (id) on delete cascade,
  email_address text not null check (length(email_address) <= 320),
  status text not null default 'connected' check (status in ('connected', 'reconnect_needed', 'disconnected')),
  -- Gmail's history position after the last sync (incremental sync starts here).
  history_id text check (length(history_id) <= 40),
  last_synced_at timestamptz,
  -- Gmail thread ids found but not fetched yet (beyond one Refresh's batch, or a failed fetch): the next
  -- Refresh continues with them, so no mail is skipped. Ids only — no content.
  sync_backlog text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.gmail_connections enable row level security;
alter table public.gmail_connections add column if not exists sync_backlog text[] not null default '{}';

-- Server only: no policies and no grants for signed-in users or the public.
create table if not exists public.gmail_tokens (
  user_id uuid primary key references public.gmail_connections (user_id) on delete cascade,
  refresh_token_ciphertext text not null,
  key_version smallint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.gmail_tokens enable row level security;

-- Server only. Google's return is parked here (token encrypted) until the SAME signed-in person who
-- started the connection completes it from the app: single use, 10 minutes, one per OAuth state.
create table if not exists public.gmail_oauth_pending (
  id uuid primary key default gen_random_uuid(),
  state_nonce text not null unique check (length(state_nonce) <= 64),
  user_id uuid not null references auth.users (id) on delete cascade,
  email_address text not null check (length(email_address) <= 320),
  refresh_token_ciphertext text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.gmail_oauth_pending enable row level security;
revoke all on public.gmail_oauth_pending from public, anon, authenticated;
grant all on public.gmail_oauth_pending to service_role;

create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.gmail_connections (user_id) on delete cascade,
  gmail_thread_id text not null check (length(gmail_thread_id) <= 64),
  subject text not null default '' check (length(subject) <= 500),
  from_name text check (length(from_name) <= 200),
  from_email text check (length(from_email) <= 320),
  -- The newest message: a new id means a new message arrived (returns a Reviewed thread to To Review).
  last_message_id text not null check (length(last_message_id) <= 64),
  last_message_at timestamptz not null,
  message_count integer not null default 1 check (message_count >= 1),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, gmail_thread_id)
);
alter table public.email_threads enable row level security;

create table if not exists public.email_account_links (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.gmail_connections (user_id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  submission_id text not null references public.submissions (id) on delete cascade,
  thread_id uuid not null references public.email_threads (id) on delete cascade,
  match_status text not null default 'possible' check (match_status in ('possible', 'confirmed')),
  -- Why it was suggested: [{kind, detail}] from the deterministic matcher.
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  -- active = To Review.
  review_status text not null default 'active' check (review_status in ('active', 'reviewed', 'not_related')),
  -- When the broker clicked Reviewed, and the thread's newest message then.
  reviewed_at timestamptz,
  reviewed_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, submission_id, thread_id),
  constraint email_account_links_reviewed check ((review_status = 'reviewed') = (reviewed_message_id is not null and reviewed_at is not null))
);
create index if not exists email_account_links_account on public.email_account_links (owner_user_id, submission_id, review_status);
alter table public.email_account_links enable row level security;

-- What happened to each link (suggested, confirmed, reviewed, review undone, not related, restored, reopened). Kept for good.
create table if not exists public.email_link_events (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.email_account_links (id) on delete cascade,
  owner_user_id uuid not null,
  action text not null check (action in ('suggested', 'linked', 'confirmed', 'reviewed', 'review_undone', 'not_related', 'restored', 'reopened')),
  at timestamptz not null default now()
);
alter table public.email_link_events enable row level security;

-- ───────────────────────────── access ─────────────────────────────

drop policy if exists gmail_connections_own on public.gmail_connections;
create policy gmail_connections_own on public.gmail_connections for select to authenticated using (user_id = auth.uid());
drop policy if exists email_threads_own on public.email_threads;
create policy email_threads_own on public.email_threads for select to authenticated using (owner_user_id = auth.uid());
drop policy if exists email_account_links_own on public.email_account_links;
create policy email_account_links_own on public.email_account_links for select to authenticated
  using (owner_user_id = auth.uid() and public.can_access_submission(submission_id));
drop policy if exists email_link_events_own on public.email_link_events;
create policy email_link_events_own on public.email_link_events for select to authenticated using (owner_user_id = auth.uid());

revoke all on public.gmail_connections, public.gmail_tokens, public.email_threads, public.email_account_links, public.email_link_events
  from public, anon, authenticated;
grant select on public.gmail_connections, public.email_threads, public.email_account_links, public.email_link_events to authenticated;
grant all on public.gmail_connections, public.gmail_tokens, public.email_threads, public.email_account_links, public.email_link_events to service_role;

-- ───────────────────────────── the broker's review ─────────────────────────────

-- confirm (a possible match), reviewed, undo_reviewed, not_related, restore (a Not Related one). Own links only.
create or replace function public.email_link_act(p_link uuid, p_action text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.email_account_links;
  msg text;
begin
  select * into l from public.email_account_links where id = p_link and owner_user_id = auth.uid() for update;
  if not found or not public.can_access_submission(l.submission_id) then raise exception 'That email isn''t linked to an account you can open.' using errcode = 'P0002'; end if;
  if p_action = 'confirm' and l.review_status <> 'not_related' and l.match_status = 'possible' then
    update public.email_account_links set match_status = 'confirmed', updated_at = now() where id = l.id;
    insert into public.email_link_events (link_id, owner_user_id, action) values (l.id, l.owner_user_id, 'confirmed');
  elsif p_action = 'reviewed' and l.review_status = 'active' then
    select t.last_message_id into msg from public.email_threads t where t.id = l.thread_id;
    update public.email_account_links set review_status = 'reviewed', reviewed_at = now(), reviewed_message_id = msg, updated_at = now() where id = l.id;
    insert into public.email_link_events (link_id, owner_user_id, action, at) values (l.id, l.owner_user_id, 'reviewed', now());
  elsif p_action = 'undo_reviewed' and l.review_status = 'reviewed' then
    update public.email_account_links set review_status = 'active', reviewed_at = null, reviewed_message_id = null, updated_at = now() where id = l.id;
    insert into public.email_link_events (link_id, owner_user_id, action) values (l.id, l.owner_user_id, 'review_undone');
  elsif p_action = 'not_related' and l.review_status in ('active', 'reviewed') then
    update public.email_account_links set review_status = 'not_related', reviewed_at = null, reviewed_message_id = null, updated_at = now() where id = l.id;
    insert into public.email_link_events (link_id, owner_user_id, action) values (l.id, l.owner_user_id, 'not_related');
  elsif p_action = 'restore' and l.review_status = 'not_related' then
    update public.email_account_links set review_status = 'active', updated_at = now() where id = l.id;
    insert into public.email_link_events (link_id, owner_user_id, action) values (l.id, l.owner_user_id, 'restored');
  else
    raise exception 'That can''t be done to this email now.' using errcode = '22023';
  end if;
end $$;

-- Disconnect Gmail: the token is deleted at once; the review history stays the broker's own.
create or replace function public.gmail_disconnect() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.gmail_tokens where user_id = auth.uid();
  update public.gmail_connections set status = 'disconnected', history_id = null, updated_at = now() where user_id = auth.uid();
end $$;

revoke all on function public.email_link_act(uuid, text), public.gmail_disconnect() from public, anon;
grant execute on function public.email_link_act(uuid, text), public.gmail_disconnect() to authenticated;

-- ───────────────────────────── the server's sync (service role only) ─────────────────────────────

-- Records (or updates) one thread of a connected mailbox. A new newest message returns this owner's links to
-- it that were marked Reviewed to To Review (the 'reviewed' event stays in the history). Returns the thread's id.
create or replace function public.email_record_thread(p_owner uuid, p_gmail_thread_id text, p_subject text, p_from_name text, p_from_email text,
  p_last_message_id text, p_last_message_at timestamptz, p_message_count integer) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t_id uuid;
begin
  if not exists (select 1 from public.gmail_connections c where c.user_id = p_owner and c.status = 'connected') then
    raise exception 'That mailbox isn''t connected.' using errcode = '42501';
  end if;
  insert into public.email_threads (owner_user_id, gmail_thread_id, subject, from_name, from_email, last_message_id, last_message_at, message_count)
  values (p_owner, p_gmail_thread_id, left(coalesce(p_subject, ''), 500), left(p_from_name, 200), left(p_from_email, 320), p_last_message_id, p_last_message_at, greatest(coalesce(p_message_count, 1), 1))
  on conflict (owner_user_id, gmail_thread_id) do update
    set subject = excluded.subject, from_name = excluded.from_name, from_email = excluded.from_email, last_message_id = excluded.last_message_id,
        last_message_at = excluded.last_message_at, message_count = excluded.message_count, updated_at = now()
  returning id into t_id;
  with reopened as (
    update public.email_account_links set review_status = 'active', reviewed_at = null, reviewed_message_id = null, updated_at = now()
     where thread_id = t_id and owner_user_id = p_owner and review_status = 'reviewed' and reviewed_message_id is distinct from p_last_message_id
    returning id, owner_user_id)
  insert into public.email_link_events (link_id, owner_user_id, action) select id, owner_user_id, 'reopened' from reopened;
  return t_id;
end $$;

grant execute on function public.email_record_thread(uuid, text, text, text, text, text, timestamptz, integer) to service_role;
revoke all on function public.email_record_thread(uuid, text, text, text, text, text, timestamptz, integer) from public, anon, authenticated;

-- ───────────────────────────── suggestions and manual links (the broker, own threads only) ─────────────────────────────

-- The app runs the deterministic matcher on the broker's own synced threads and suggests them here: always
-- "possible", only for accounts the broker can open. An existing link is left as it is (never downgraded from
-- confirmed, never brought back from Not Related). Returns the new link's id, or null.
create or replace function public.email_suggest_link(p_thread uuid, p_submission_id text, p_reasons jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid;
  new_id uuid;
begin
  if not exists (select 1 from public.email_threads t where t.id = p_thread and t.owner_user_id = auth.uid()) then
    raise exception 'That thread isn''t in your mailbox.' using errcode = '42501';
  end if;
  select s.organization_id into a from public.submissions s where s.id = p_submission_id;
  if a is null or not public.can_access_submission(p_submission_id) or a is distinct from (select c.agency_id from public.gmail_connections c where c.user_id = auth.uid()) then
    raise exception 'You can''t open that account.' using errcode = '42501';
  end if;
  insert into public.email_account_links (owner_user_id, agency_id, submission_id, thread_id, reasons)
  values (auth.uid(), a, p_submission_id, p_thread, case when jsonb_typeof(p_reasons) = 'array' then p_reasons else '[]'::jsonb end)
  on conflict (owner_user_id, submission_id, thread_id) do nothing
  returning id into new_id;
  if new_id is not null then insert into public.email_link_events (link_id, owner_user_id, action) values (new_id, auth.uid(), 'suggested'); end if;
  return new_id;
end $$;

-- The broker links one of their own threads to an account themselves: confirmed (they chose it). A link
-- marked Not Related for that account is restored and confirmed instead. Returns the link's id.
create or replace function public.email_link_manual(p_thread uuid, p_submission_id text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid;
  l public.email_account_links;
begin
  if not exists (select 1 from public.email_threads t where t.id = p_thread and t.owner_user_id = auth.uid()) then
    raise exception 'That thread isn''t in your mailbox.' using errcode = '42501';
  end if;
  select s.organization_id into a from public.submissions s where s.id = p_submission_id;
  if a is null or not public.can_access_submission(p_submission_id) or a is distinct from (select c.agency_id from public.gmail_connections c where c.user_id = auth.uid()) then
    raise exception 'You can''t open that account.' using errcode = '42501';
  end if;
  select * into l from public.email_account_links where owner_user_id = auth.uid() and submission_id = p_submission_id and thread_id = p_thread for update;
  if l.id is null then
    insert into public.email_account_links (owner_user_id, agency_id, submission_id, thread_id, match_status, reasons)
    values (auth.uid(), a, p_submission_id, p_thread, 'confirmed', '[{"kind": "manual", "detail": "Linked by you"}]'::jsonb)
    returning * into l;
  elsif l.review_status = 'not_related' or l.match_status = 'possible' then
    update public.email_account_links set match_status = 'confirmed', review_status = case when review_status = 'not_related' then 'active' else review_status end, updated_at = now()
     where id = l.id;
  end if;
  insert into public.email_link_events (link_id, owner_user_id, action) values (l.id, auth.uid(), 'linked');
  return l.id;
end $$;

revoke all on function public.email_suggest_link(uuid, text, jsonb), public.email_link_manual(uuid, text) from public, anon;
grant execute on function public.email_suggest_link(uuid, text, jsonb), public.email_link_manual(uuid, text) to authenticated;
drop function if exists public.email_suggest_link(uuid, uuid, text, jsonb);

notify pgrst, 'reload schema';

-- OAuth completion (service role only; the gmail function calls these).
-- Park Google's return for the user named in the signed state. A state can be used once: a second
-- return with the same state (replay) is refused. Expired parked returns are cleared.
create or replace function public.gmail_oauth_stash(p_nonce text, p_user uuid, p_email text, p_ciphertext text, p_expires timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  delete from public.gmail_oauth_pending where expires_at < now();
  insert into public.gmail_oauth_pending (state_nonce, user_id, email_address, refresh_token_ciphertext, expires_at)
  values (p_nonce, p_user, p_email, p_ciphertext, p_expires)
  on conflict (state_nonce) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'replay' using errcode = '42501';
  end if;
  return v_id;
end;
$$;
revoke all on function public.gmail_oauth_stash(text, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.gmail_oauth_stash(text, uuid, text, text, timestamptz) to service_role;

-- Complete it as the signed-in caller (p_user comes from their verified sign-in, never from the URL).
-- Single use: the parked return is removed first, whatever happens next — so a wrong person, an
-- expired one or a second attempt can never connect it. Only then is the mailbox saved. Refusals are
-- returned ('mismatch' / 'expired' / 'used_or_unknown' / 'no_agency'), not raised, so the removal always sticks.
create or replace function public.gmail_oauth_complete(p_pending uuid, p_user uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v public.gmail_oauth_pending%rowtype;
begin
  delete from public.gmail_oauth_pending where id = p_pending returning * into v;
  if not found then return 'used_or_unknown'; end if;
  if v.expires_at < now() then return 'expired'; end if;
  if v.user_id is distinct from p_user then return 'mismatch'; end if;
  if not exists (select 1 from public.profiles p where p.user_id = v.user_id) then return 'no_agency'; end if;
  insert into public.gmail_connections (user_id, agency_id, email_address, status, history_id, connected_at, updated_at)
  values (v.user_id, (select p.agency_id from public.profiles p where p.user_id = v.user_id), v.email_address, 'connected', null, now(), now())
  on conflict (user_id) do update set agency_id = excluded.agency_id, email_address = excluded.email_address, status = 'connected',
    history_id = null, connected_at = now(), updated_at = now();
  insert into public.gmail_tokens (user_id, refresh_token_ciphertext, key_version, updated_at)
  values (v.user_id, v.refresh_token_ciphertext, 1, now())
  on conflict (user_id) do update set refresh_token_ciphertext = excluded.refresh_token_ciphertext, key_version = 1, updated_at = now();
  return 'connected';
end;
$$;
revoke all on function public.gmail_oauth_complete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.gmail_oauth_complete(uuid, uuid) to service_role;
