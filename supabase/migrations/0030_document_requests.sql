-- Client document requests: the broker asks a client for specific checklist items and gets a
-- secure upload link that shows exactly what is still needed.
--
-- MODEL
--   The account's checklist item (submissions.missing_items — MissingItem) stays the ONE canonical
--   requirement. A request only REFERENCES checklist items (document_request_items.missing_item_id,
--   with a label snapshot for the client page); it never creates checklist rows. Several requests
--   and follow-ups can reference the same item.
--
--   document_requests       one request: account, contact, link token, status, follow-up dates
--   document_request_items  the checklist items it asks for, each: requested → uploaded →
--                           satisfied (or needs_review → satisfied / back to requested), or waived
--   document_request_files  every verified upload, linked to one request item, and later to the
--                           account document it was imported as
--
-- STATUS (recomputed by the database after every change — never set by the app directly)
--   waiting   nothing received yet        partial    some received, some still requested
--   complete  nothing left to ask for     cancelled  closed by the broker
--   Reminders and Today's Plate only ever list items still 'requested'; when none are left the
--   request completes, its next follow-up is cleared and Activity records it.
--
-- CLIENT ACCESS (anonymous, like 0029's intake): only through the link's random token.
--   get_document_request(token) returns the insured's name and that request's own item labels —
--   nothing else about the account, and nothing about any other request. Uploads go to
--   intake-uploads/<token>/<file key>/<name>; storage accepts them only for an open request, and
--   attach_document_request_file() links a file only after verifying it is in storage (0029's
--   pattern). A retried attach of the same file key is a no-op, never a second record.
--
-- BROKER ACCESS: read with the account's existing rule (can_access_submission, 0011/0026); every
--   change goes through the functions below, which check the same rule.
--
-- Additive; safe to run more than once. Must run after 0011, 0014, 0026 and 0029. Intake (0004–0029)
-- is untouched.

create table if not exists public.document_requests (
  id text primary key,
  submission_id text not null references public.submissions (id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  client_key uuid unique,
  contact_id text,
  contact_name text,
  contact_email text,
  channel text not null default 'email',
  status text not null default 'waiting',
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  requested_at timestamptz not null default now(),
  last_follow_up_at timestamptz,
  follow_up_count integer not null default 0,
  next_follow_up date,
  expires_at timestamptz not null default now() + interval '60 days',
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint document_requests_status_check check (status in ('waiting', 'partial', 'complete', 'cancelled')),
  constraint document_requests_channel_check check (channel in ('email', 'text', 'phone', 'other'))
);
create index if not exists document_requests_submission_idx on public.document_requests (submission_id);

create table if not exists public.document_request_items (
  id text primary key,
  request_id text not null references public.document_requests (id) on delete cascade,
  missing_item_id text not null,
  label text not null,
  instructions text,
  position integer not null default 0,
  status text not null default 'requested',
  uploaded_at timestamptz,
  satisfied_at timestamptz,
  constraint document_request_items_status_check check (status in ('requested', 'uploaded', 'needs_review', 'satisfied', 'waived')),
  unique (request_id, missing_item_id)
);
create index if not exists document_request_items_request_idx on public.document_request_items (request_id);

create table if not exists public.document_request_files (
  id text primary key,
  request_id text not null references public.document_requests (id) on delete cascade,
  request_item_id text not null references public.document_request_items (id) on delete cascade,
  client_file_key text not null,
  file_name text not null,
  storage_path text not null,
  size_bytes bigint,
  uploaded_at timestamptz not null default now(),
  claimed_at timestamptz,
  imported_document_id text,
  imported_at timestamptz,
  match_status text not null default 'pending',
  match_note text,
  constraint document_request_files_match_check check (match_status in ('pending', 'satisfied', 'needs_review', 'rejected', 'reassigned')),
  unique (request_id, client_file_key)
);
create index if not exists document_request_files_request_idx on public.document_request_files (request_id);

alter table public.document_requests enable row level security;
alter table public.document_request_items enable row level security;
alter table public.document_request_files enable row level security;

drop policy if exists "account access: read document requests" on public.document_requests;
create policy "account access: read document requests" on public.document_requests for select to authenticated
  using (public.can_access_submission(submission_id));
drop policy if exists "account access: read document request items" on public.document_request_items;
create policy "account access: read document request items" on public.document_request_items for select to authenticated
  using (exists (select 1 from public.document_requests r where r.id = request_id and public.can_access_submission(r.submission_id)));
drop policy if exists "account access: read document request files" on public.document_request_files;
create policy "account access: read document request files" on public.document_request_files for select to authenticated
  using (exists (select 1 from public.document_requests r where r.id = request_id and public.can_access_submission(r.submission_id)));

-- Reads only; every write goes through the functions below.
revoke all on public.document_requests, public.document_request_items, public.document_request_files from anon, authenticated;
grant select on public.document_requests, public.document_request_items, public.document_request_files to authenticated;

-- --------------------------------------------------------------------------------------------
-- Internal helpers (not callable by the app)
-- --------------------------------------------------------------------------------------------

-- A broker-facing Activity entry on the account (0003/0014), written as the broker who made the
-- request — the only user an anonymous client action can be attributed to — with the client named.
create or replace function public.document_request_activity(p_request public.document_requests, p_type text, p_message text, p_actor text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.activity_events (id, submission_id, user_id, type, message, occurred_at, actor_name)
  select 'evt_' || replace(gen_random_uuid()::text, '-', ''), p_request.submission_id, p_request.created_by, p_type, p_message, now(), p_actor
   where p_request.created_by is not null
$$;
revoke all on function public.document_request_activity(public.document_requests, text, text, text) from public, anon, authenticated;

-- Recomputes a request's status from its items. Completing clears the next follow-up and records it.
create or replace function public.document_request_refresh(p_request_id text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r public.document_requests;
  v_outstanding integer;
  v_received integer;
  v_status text;
begin
  select * into r from public.document_requests where id = p_request_id for update;
  if not found or r.status = 'cancelled' then
    return r.status;
  end if;
  -- Complete only once every item is actually satisfied (verified or confirmed by the broker) — an
  -- upload still waiting to be imported or reviewed keeps the request open.
  select count(*) filter (where status in ('requested', 'uploaded', 'needs_review')), count(*) filter (where status in ('uploaded', 'needs_review', 'satisfied'))
    into v_outstanding, v_received
    from public.document_request_items where request_id = p_request_id;
  v_status := case when v_outstanding = 0 then 'complete' when v_received > 0 then 'partial' else 'waiting' end;
  if v_status = r.status then
    return v_status;
  end if;
  update public.document_requests
     set status = v_status,
         updated_at = now(),
         closed_at = case when v_status = 'complete' then now() else null end,
         next_follow_up = case when v_status = 'complete' then null else next_follow_up end
   where id = p_request_id
  returning * into r;
  if v_status = 'complete' then
    perform public.document_request_activity(r, 'request_completed',
      format('Everything requested from %s has been received — request complete.', coalesce(r.contact_name, 'the client')), coalesce(r.contact_name, 'Client'));
  end if;
  return v_status;
end;
$$;
revoke all on function public.document_request_refresh(text) from public, anon, authenticated;

-- What the client page shows: the insured's name and this request's own items — nothing else.
create or replace function public.document_request_public_view(r public.document_requests) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'requestId', r.id,
    'folder', r.token::text,
    'status', case when r.status in ('waiting', 'partial') and r.expires_at < now() then 'expired' else r.status end,
    'accountName', coalesce((select s.named_insured from public.submissions s where s.id = r.submission_id), 'your account'),
    'contactFirstName', nullif(split_part(coalesce(r.contact_name, ''), ' ', 1), ''),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'label', i.label,
        'instructions', i.instructions,
        'received', i.status <> 'requested',
        'files', coalesce((select jsonb_agg(jsonb_build_object('name', f.file_name, 'uploadedAt', f.uploaded_at) order by f.uploaded_at)
                             from public.document_request_files f where f.request_item_id = i.id and f.match_status not in ('rejected', 'reassigned')), '[]'::jsonb)
      ) order by i.position, i.label)
        from public.document_request_items i
       where i.request_id = r.id and i.status <> 'waived'
    ), '[]'::jsonb)
  )
$$;
revoke all on function public.document_request_public_view(public.document_requests) from public, anon, authenticated;

-- --------------------------------------------------------------------------------------------
-- Client (anonymous) — only with the link's token
-- --------------------------------------------------------------------------------------------
create or replace function public.get_document_request(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  r public.document_requests;
begin
  select * into r from public.document_requests where token = p_token;
  if not found then
    return null;
  end if;
  return public.document_request_public_view(r);
end;
$$;

create or replace function public.attach_document_request_file(p_token uuid, p_item_id text, p_file_key text, p_file_name text, p_storage_path text, p_size bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.document_requests;
  it public.document_request_items;
  v_new boolean;
begin
  select * into r from public.document_requests where token = p_token for update;
  if not found then
    raise exception 'This link isn''t valid.' using errcode = '42501';
  end if;
  if r.status not in ('waiting', 'partial') or r.expires_at < now() then
    raise exception 'This request is no longer accepting files.' using errcode = '42501';
  end if;
  select * into it from public.document_request_items where id = p_item_id and request_id = r.id;
  if not found or it.status = 'waived' then
    raise exception 'That item isn''t part of this request.' using errcode = '42501';
  end if;
  if p_file_key is null or p_file_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'Invalid file key.' using errcode = '22023';
  end if;
  if p_storage_path is null or left(p_storage_path, 38 + length(p_file_key)) <> r.token::text || '/' || p_file_key || '/' then
    raise exception 'The file path doesn''t belong to this request.' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'intake-uploads' and o.name = p_storage_path) then
    raise exception 'The file isn''t in storage.' using errcode = 'P0002';
  end if;

  insert into public.document_request_files (id, request_id, request_item_id, client_file_key, file_name, storage_path, size_bytes)
  values ('drf_' || replace(gen_random_uuid()::text, '-', ''), r.id, it.id, p_file_key, coalesce(nullif(left(btrim(coalesce(p_file_name, '')), 255), ''), 'file'), p_storage_path, p_size)
  on conflict (request_id, client_file_key) do nothing;
  v_new := found;

  if v_new then
    if it.status = 'requested' then
      update public.document_request_items set status = 'uploaded', uploaded_at = now() where id = it.id;
    end if;
    update public.document_requests set updated_at = now() where id = r.id;
    perform public.document_request_activity(r, 'document_uploaded',
      format('%s uploaded %s for %s (secure request link).', coalesce(r.contact_name, 'The client'), coalesce(nullif(btrim(p_file_name), ''), 'a file'), it.label), coalesce(r.contact_name, 'Client'));
    perform public.document_request_refresh(r.id);
    select * into r from public.document_requests where id = r.id;
  end if;
  return public.document_request_public_view(r);
end;
$$;

revoke all on function public.get_document_request(uuid) from public;
revoke all on function public.attach_document_request_file(uuid, text, text, text, text, bigint) from public;
grant execute on function public.get_document_request(uuid) to anon, authenticated;
grant execute on function public.attach_document_request_file(uuid, text, text, text, text, bigint) to anon, authenticated;

-- Storage: a client may upload only into the folder of an open, unexpired request (its token).
create or replace function public.document_request_upload_allowed(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.document_requests r
     where r.token::text = split_part(p_name, '/', 1)
       and r.status in ('waiting', 'partial')
       and r.expires_at > now()
  )
$$;
revoke all on function public.document_request_upload_allowed(text) from public;
grant execute on function public.document_request_upload_allowed(text) to anon, authenticated;

-- A broker reads a request's files if they can access its account.
create or replace function public.document_request_file_readable(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.document_requests r
     where r.token::text = split_part(p_name, '/', 1)
       and public.can_access_submission(r.submission_id)
  )
$$;
revoke all on function public.document_request_file_readable(text) from public, anon;
grant execute on function public.document_request_file_readable(text) to authenticated;

drop policy if exists "client uploads requested documents" on storage.objects;
create policy "client uploads requested documents" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'intake-uploads' and public.document_request_upload_allowed(name));
drop policy if exists "account access: read requested documents" on storage.objects;
create policy "account access: read requested documents" on storage.objects for select to authenticated
  using (bucket_id = 'intake-uploads' and public.document_request_file_readable(name));

-- --------------------------------------------------------------------------------------------
-- Broker — every function checks the account's access rule
-- --------------------------------------------------------------------------------------------
create or replace function public.document_request_for_broker(p_request_id text) returns public.document_requests
language plpgsql stable security definer set search_path = ''
as $$
declare
  r public.document_requests;
begin
  select * into r from public.document_requests where id = p_request_id;
  if not found or auth.uid() is null or not public.can_access_submission(r.submission_id) then
    raise exception 'You don''t have access to this request.' using errcode = '42501';
  end if;
  return r;
end;
$$;
revoke all on function public.document_request_for_broker(text) from public, anon, authenticated;

-- Creates a request for existing checklist items. The same p_client_key (one click of "send")
-- always returns the same request.
create or replace function public.create_document_request(
  p_submission_id text,
  p_client_key uuid,
  p_contact jsonb,
  p_channel text,
  p_items jsonb,
  p_next_follow_up date,
  p_requested_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.document_requests;
  v_actor text;
  e jsonb;
  n integer := 0;
begin
  if auth.uid() is null or not public.can_access_submission(p_submission_id) then
    raise exception 'You don''t have access to this account.' using errcode = '42501';
  end if;
  if p_client_key is not null then
    select * into r from public.document_requests where client_key = p_client_key;
    if found then
      if r.submission_id <> p_submission_id then
        raise exception 'Request key already used.' using errcode = '42501';
      end if;
      return jsonb_build_object('id', r.id, 'token', r.token, 'status', r.status);
    end if;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'Choose between 1 and 50 items to request.' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), u.email) into v_actor
    from auth.users u left join public.profiles p on p.user_id = u.id where u.id = auth.uid();

  insert into public.document_requests (id, submission_id, client_key, contact_id, contact_name, contact_email, channel, created_by, created_by_name, requested_at, next_follow_up)
  values ('dreq_' || replace(gen_random_uuid()::text, '-', ''), p_submission_id, p_client_key,
          left(p_contact->>'id', 80), left(nullif(btrim(coalesce(p_contact->>'name', '')), ''), 200), left(nullif(btrim(coalesce(p_contact->>'email', '')), ''), 320),
          coalesce(nullif(p_channel, ''), 'email'), auth.uid(), v_actor, coalesce(p_requested_at, now()), p_next_follow_up)
  returning * into r;

  for e in select * from jsonb_array_elements(p_items) loop
    if coalesce(btrim(e->>'missingItemId'), '') = '' or coalesce(btrim(e->>'label'), '') = '' then
      raise exception 'Every requested item needs its checklist item and label.' using errcode = '22023';
    end if;
    insert into public.document_request_items (id, request_id, missing_item_id, label, instructions, position)
    values ('dri_' || replace(gen_random_uuid()::text, '-', ''), r.id, left(e->>'missingItemId', 120), left(btrim(e->>'label'), 300), left(nullif(btrim(coalesce(e->>'instructions', '')), ''), 1000), n)
    on conflict (request_id, missing_item_id) do nothing;
    n := n + 1;
  end loop;
  return jsonb_build_object('id', r.id, 'token', r.token, 'status', r.status);
end;
$$;

-- The broker sent a follow-up (only the outstanding items) and picked the next date.
create or replace function public.record_document_request_follow_up(p_request_id text, p_next_follow_up date) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.document_requests := public.document_request_for_broker(p_request_id);
begin
  if r.status not in ('waiting', 'partial') then
    raise exception 'This request is %.', r.status using errcode = '22023';
  end if;
  update public.document_requests
     set last_follow_up_at = now(), follow_up_count = follow_up_count + 1, next_follow_up = p_next_follow_up,
         expires_at = greatest(expires_at, now() + interval '30 days'), updated_at = now()
   where id = r.id;
end;
$$;

create or replace function public.set_document_request_next_follow_up(p_request_id text, p_next_follow_up date) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.document_requests := public.document_request_for_broker(p_request_id);
begin
  if r.status not in ('waiting', 'partial') then
    raise exception 'This request is %.', r.status using errcode = '22023';
  end if;
  update public.document_requests set next_follow_up = p_next_follow_up, updated_at = now() where id = r.id;
end;
$$;

create or replace function public.cancel_document_request(p_request_id text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.document_requests := public.document_request_for_broker(p_request_id);
begin
  if r.status = 'cancelled' then
    return;
  end if;
  update public.document_requests set status = 'cancelled', closed_at = now(), next_follow_up = null, updated_at = now() where id = r.id;
end;
$$;

-- Checklist items received / waived another way (emailed in, marked by hand): open requests stop
-- asking for them.
create or replace function public.settle_document_request_items(p_submission_id text, p_missing_item_ids text[], p_status text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_req text;
  n integer := 0;
begin
  if auth.uid() is null or not public.can_access_submission(p_submission_id) then
    raise exception 'You don''t have access to this account.' using errcode = '42501';
  end if;
  if p_status not in ('satisfied', 'waived') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  for v_req in
    update public.document_request_items i
       set status = p_status, satisfied_at = case when p_status = 'satisfied' then now() else satisfied_at end
      from public.document_requests r
     where r.id = i.request_id and r.submission_id = p_submission_id and r.status in ('waiting', 'partial')
       and i.missing_item_id = any (coalesce(p_missing_item_ids, '{}')) and i.status in ('requested', 'uploaded', 'needs_review')
    returning i.request_id
  loop
    n := n + 1;
    perform public.document_request_refresh(v_req);
  end loop;
  return n;
end;
$$;

-- One uploaded file is being imported into the account by this browser (short lock, so two tabs
-- never import it twice; a lock older than 10 minutes — a closed tab — can be taken over).
create or replace function public.claim_document_request_file(p_file_id text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  f public.document_request_files;
begin
  select * into f from public.document_request_files where id = p_file_id;
  if not found then
    return false;
  end if;
  perform public.document_request_for_broker(f.request_id);
  update public.document_request_files
     set claimed_at = now()
   where id = p_file_id and imported_at is null and (claimed_at is null or claimed_at < now() - interval '10 minutes');
  return found;
end;
$$;

-- The file is now an account document; what it was matched to.
create or replace function public.complete_document_request_file(p_file_id text, p_document_id text, p_match text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  f public.document_request_files;
begin
  select * into f from public.document_request_files where id = p_file_id for update;
  if not found then
    raise exception 'Unknown file.' using errcode = '22023';
  end if;
  perform public.document_request_for_broker(f.request_id);
  if p_match not in ('satisfied', 'needs_review') then
    raise exception 'Unknown match.' using errcode = '22023';
  end if;
  if f.imported_at is not null then
    return; -- already recorded (a retry)
  end if;
  update public.document_request_files
     set imported_document_id = p_document_id, imported_at = now(), match_status = p_match, match_note = left(p_note, 500)
   where id = f.id;
  update public.document_request_items
     set status = case when p_match = 'satisfied' then 'satisfied' else 'needs_review' end,
         satisfied_at = case when p_match = 'satisfied' then now() else satisfied_at end
   where id = f.request_item_id and status in ('requested', 'uploaded', 'needs_review');
  perform public.document_request_refresh(f.request_id);
end;
$$;

-- The broker's decision on a file that needed review:
--   satisfy  — it is what was asked for
--   reject   — it isn't; the item is asked for again (unless another file already covers it)
--   reassign — it's for another item of the same request (p_target_item_id), which it satisfies
create or replace function public.resolve_document_request_file(p_file_id text, p_action text, p_target_item_id text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  f public.document_request_files;
begin
  select * into f from public.document_request_files where id = p_file_id for update;
  if not found then
    raise exception 'Unknown file.' using errcode = '22023';
  end if;
  perform public.document_request_for_broker(f.request_id);
  if p_action = 'satisfy' then
    update public.document_request_files set match_status = 'satisfied' where id = f.id;
    update public.document_request_items set status = 'satisfied', satisfied_at = now() where id = f.request_item_id and status <> 'waived';
  elsif p_action in ('reject', 'reassign') then
    if p_action = 'reassign' then
      if not exists (select 1 from public.document_request_items where id = p_target_item_id and request_id = f.request_id) then
        raise exception 'That item isn''t part of this request.' using errcode = '22023';
      end if;
      update public.document_request_items set status = 'satisfied', satisfied_at = now() where id = p_target_item_id and status <> 'waived';
    end if;
    update public.document_request_files set match_status = case when p_action = 'reject' then 'rejected' else 'reassigned' end where id = f.id;
    -- The original item is asked for again unless another file still covers it.
    update public.document_request_items i
       set status = 'requested', uploaded_at = null
     where i.id = f.request_item_id and i.status in ('uploaded', 'needs_review')
       and not exists (select 1 from public.document_request_files o where o.request_item_id = i.id and o.id <> f.id and o.match_status in ('pending', 'satisfied', 'needs_review'));
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  -- (A completed request with an item asked for again reopens here.)
  perform public.document_request_refresh(f.request_id);
end;
$$;

revoke all on function public.create_document_request(text, uuid, jsonb, text, jsonb, date, timestamptz) from public, anon;
revoke all on function public.record_document_request_follow_up(text, date) from public, anon;
revoke all on function public.set_document_request_next_follow_up(text, date) from public, anon;
revoke all on function public.cancel_document_request(text) from public, anon;
revoke all on function public.settle_document_request_items(text, text[], text) from public, anon;
revoke all on function public.claim_document_request_file(text) from public, anon;
revoke all on function public.complete_document_request_file(text, text, text, text) from public, anon;
revoke all on function public.resolve_document_request_file(text, text, text) from public, anon;
grant execute on function public.create_document_request(text, uuid, jsonb, text, jsonb, date, timestamptz) to authenticated;
grant execute on function public.record_document_request_follow_up(text, date) to authenticated;
grant execute on function public.set_document_request_next_follow_up(text, date) to authenticated;
grant execute on function public.cancel_document_request(text) to authenticated;
grant execute on function public.settle_document_request_items(text, text[], text) to authenticated;
grant execute on function public.claim_document_request_file(text) to authenticated;
grant execute on function public.complete_document_request_file(text, text, text, text) to authenticated;
grant execute on function public.resolve_document_request_file(text, text, text) to authenticated;
