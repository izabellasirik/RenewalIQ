-- Client document request page: "Upload multiple documents" and the agency's name.
--
-- 1. A client may upload several files at once without saying which requested item each one is.
--    Such a file is stored and verified exactly like any other (same token folder, same storage
--    check, same idempotent file key) but has no item yet (request_item_id null). It never counts
--    toward anything by itself: the broker's automatic check reads it and, only if it clearly
--    matches exactly ONE outstanding item, assigns it to that item (complete_document_request_file's
--    new p_item_id); otherwise it's held for review and the broker picks the item ("It's for…",
--    resolve_document_request_file 'reassign') or rejects it.
-- 2. The client page shows the agency's name (the account's agency, else the name the broker shows
--    clients on their intake links) — nothing else about the agency or the account.
--
-- Additive; safe to run more than once. Must run after 0031.

alter table public.document_request_files alter column request_item_id drop not null;

-- Upload: p_item_id may be null ("Upload multiple documents").
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
  if p_item_id is not null then
    select * into it from public.document_request_items where id = p_item_id and request_id = r.id;
    if not found or it.status = 'waived' then
      raise exception 'That item isn''t part of this request.' using errcode = '42501';
    end if;
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
  -- A request link is for a handful of documents, not unlimited storage.
  if not exists (select 1 from public.document_request_files where request_id = r.id and client_file_key = p_file_key)
     and (select count(*) from public.document_request_files where request_id = r.id) >= 200 then
    raise exception 'This request has received the maximum number of files.' using errcode = '54000';
  end if;

  insert into public.document_request_files (id, request_id, request_item_id, client_file_key, file_name, storage_path, size_bytes)
  values ('drf_' || replace(gen_random_uuid()::text, '-', ''), r.id, it.id, p_file_key, coalesce(nullif(left(btrim(coalesce(p_file_name, '')), 255), ''), 'file'), p_storage_path, p_size)
  on conflict (request_id, client_file_key) do nothing;
  v_new := found;

  if v_new then
    if it.id is not null and it.status = 'requested' then
      update public.document_request_items set status = 'uploaded', uploaded_at = now() where id = it.id;
    end if;
    update public.document_requests set updated_at = now() where id = r.id;
    perform public.document_request_activity(r, 'document_uploaded',
      format('%s uploaded %s%s (secure request link).', coalesce(r.contact_name, 'The client'), coalesce(nullif(btrim(p_file_name), ''), 'a file'),
             case when it.id is null then ' without choosing an item' else ' for ' || it.label end),
      coalesce(r.contact_name, 'Client'));
    perform public.document_request_refresh(r.id);
    select * into r from public.document_requests where id = r.id;
  end if;
  return public.document_request_public_view(r);
end;
$$;
revoke all on function public.attach_document_request_file(uuid, text, text, text, text, bigint) from public;
grant execute on function public.attach_document_request_file(uuid, text, text, text, text, bigint) to anon, authenticated;

-- What the client page shows: the agency's name, the insured's name, this request's own items (a
-- file shows under its item — or, once the broker placed it, under the item it was placed on), and
-- the files uploaded without an item that are still being sorted out.
create or replace function public.document_request_public_view(r public.document_requests) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'requestId', r.id,
    'folder', r.token::text,
    'status', case when r.status in ('waiting', 'partial') and r.expires_at < now() then 'expired' else r.status end,
    'accountName', coalesce((select s.named_insured from public.submissions s where s.id = r.submission_id), 'your account'),
    'agencyName', coalesce(
      (select a.name from public.submissions s join public.agencies a on a.id = s.organization_id where s.id = r.submission_id),
      (select l.organization_name from public.intake_links l where l.user_id = r.created_by and nullif(btrim(l.organization_name), '') is not null order by l.created_at desc limit 1)
    ),
    'contactFirstName', nullif(split_part(coalesce(r.contact_name, ''), ' ', 1), ''),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'label', i.label,
        'instructions', i.instructions,
        'received', i.status <> 'requested',
        'confirmed', i.status = 'satisfied',
        'files', coalesce((select jsonb_agg(jsonb_build_object(
                             'name', f.file_name,
                             'uploadedAt', f.uploaded_at,
                             'key', f.client_file_key,
                             'state', case when f.match_status in ('satisfied', 'reassigned') then 'accepted' else 'checking' end,
                             'removable', f.match_status in ('pending', 'needs_review') and f.imported_at is null
                                          and (f.claimed_at is null or f.claimed_at < now() - interval '10 minutes')
                                          and r.status in ('waiting', 'partial') and r.expires_at > now()
                           ) order by f.uploaded_at)
                             from public.document_request_files f
                            where (f.request_item_id = i.id and f.match_status in ('pending', 'needs_review', 'satisfied'))
                               or (f.match_status = 'reassigned' and f.resolved_item_id = i.id)), '[]'::jsonb)
      ) order by i.position, i.label)
        from public.document_request_items i
       where i.request_id = r.id and i.status <> 'waived'
    ), '[]'::jsonb),
    'unassigned', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', f.file_name,
        'uploadedAt', f.uploaded_at,
        'key', f.client_file_key,
        'state', 'checking',
        'removable', f.match_status in ('pending', 'needs_review') and f.imported_at is null
                     and (f.claimed_at is null or f.claimed_at < now() - interval '10 minutes')
                     and r.status in ('waiting', 'partial') and r.expires_at > now()
      ) order by f.uploaded_at)
        from public.document_request_files f
       where f.request_id = r.id and f.request_item_id is null and f.match_status in ('pending', 'needs_review')
    ), '[]'::jsonb)
  )
$$;
revoke all on function public.document_request_public_view(public.document_requests) from public, anon, authenticated;

-- The automatic check's result (0031), plus: a file uploaded without an item is assigned to
-- p_item_id — the ONE outstanding item it clearly matched — at the same time.
drop function if exists public.complete_document_request_file(text, text, text, text);
create or replace function public.complete_document_request_file(p_file_id text, p_document_id text, p_match text, p_note text, p_item_id text default null) returns void
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
  if p_match = 'satisfied' and p_document_id is null then
    raise exception 'An accepted file needs the document it was imported as.' using errcode = '22023';
  end if;
  if f.match_status <> 'pending' or f.imported_at is not null then
    return; -- already recorded (a retry), or the client withdrew it meanwhile
  end if;
  if f.request_item_id is null and p_item_id is not null then
    if not exists (select 1 from public.document_request_items where id = p_item_id and request_id = f.request_id and status <> 'waived') then
      raise exception 'That item isn''t part of this request.' using errcode = '22023';
    end if;
    f.request_item_id := p_item_id;
  end if;
  if p_match = 'satisfied' and f.request_item_id is null then
    raise exception 'A file uploaded without an item can only be accepted for one item.' using errcode = '22023';
  end if;
  update public.document_request_files
     set request_item_id = f.request_item_id,
         imported_document_id = p_document_id,
         imported_at = case when p_document_id is not null then now() end,
         match_status = p_match, match_note = left(p_note, 500), claimed_at = null
   where id = f.id;
  update public.document_request_items
     set status = case when p_match = 'satisfied' then 'satisfied' else 'needs_review' end,
         satisfied_at = case when p_match = 'satisfied' then now() else satisfied_at end,
         uploaded_at = coalesce(uploaded_at, now())
   where id = f.request_item_id and status in ('requested', 'uploaded', 'needs_review');
  perform public.document_request_refresh(f.request_id);
end;
$$;
revoke all on function public.complete_document_request_file(text, text, text, text, text) from public, anon;
grant execute on function public.complete_document_request_file(text, text, text, text, text) to authenticated;

-- "Yes, it's the …" needs an item: a file uploaded without one is placed with 'reassign'.
create or replace function public.resolve_document_request_file(p_file_id text, p_action text, p_target_item_id text default null, p_document_id text default null) returns void
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
  if f.match_status in ('withdrawn', 'rejected') then
    raise exception 'This file was already removed.' using errcode = '22023';
  end if;
  if p_action = 'satisfy' and f.request_item_id is null then
    raise exception 'Choose which requested item this file is.' using errcode = '22023';
  end if;
  if p_action in ('satisfy', 'reassign') and p_document_id is null and f.imported_document_id is null then
    raise exception 'Import the file into the account first.' using errcode = '22023';
  end if;
  if p_action = 'satisfy' then
    update public.document_request_files
       set match_status = 'satisfied', resolved_item_id = request_item_id,
           imported_document_id = coalesce(p_document_id, imported_document_id), imported_at = coalesce(imported_at, now()), claimed_at = null
     where id = f.id;
    update public.document_request_items set status = 'satisfied', satisfied_at = now() where id = f.request_item_id and status <> 'waived';
  elsif p_action in ('reject', 'reassign') then
    if p_action = 'reassign' then
      if not exists (select 1 from public.document_request_items where id = p_target_item_id and request_id = f.request_id) then
        raise exception 'That item isn''t part of this request.' using errcode = '22023';
      end if;
      update public.document_request_items set status = 'satisfied', satisfied_at = now() where id = p_target_item_id and status <> 'waived';
    end if;
    update public.document_request_files
       set match_status = case when p_action = 'reject' then 'rejected' else 'reassigned' end,
           resolved_item_id = case when p_action = 'reassign' then p_target_item_id end,
           imported_document_id = coalesce(p_document_id, imported_document_id),
           imported_at = case when p_action = 'reassign' then coalesce(imported_at, now()) else imported_at end,
           claimed_at = null
     where id = f.id;
    if f.request_item_id is not null then
      perform public.document_request_item_reopen(f.request_item_id, f.id);
    end if;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform public.document_request_refresh(f.request_id);
end;
$$;
revoke all on function public.resolve_document_request_file(text, text, text, text) from public, anon;
grant execute on function public.resolve_document_request_file(text, text, text, text) to authenticated;
