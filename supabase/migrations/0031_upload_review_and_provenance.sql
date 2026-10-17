-- Client uploads are checked before they touch the account, and any document's data can be undone
-- precisely.
--
-- 1. PROVENANCE. field_values and coverage_lines get a `details` jsonb (like 0024 did for drivers,
--    vehicles and losses) for what has no column of its own: every other document that stated the
--    same value (`support`), a "check this" flag left when a document was removed (`reviewFlag`),
--    whether the broker confirmed it, and which documents created a coverage line (`sources`).
--    The app uses them to remove only what came from a removed document.
--
-- 2. HOLD FOR REVIEW. complete_document_request_file() can now record a client upload as
--    "needs review" WITHOUT importing it (p_document_id null): it stays out of the account's
--    documents and Risk Profile until the broker confirms it. Confirming (or moving it to another
--    item) passes the account document it was then imported as — resolve_document_request_file()
--    gets that parameter (the old 3-argument version is replaced).
--
-- 3. WRONG DOCUMENT. mark_document_request_file_wrong(): a file that was accepted turns out to be
--    wrong — it's marked rejected (kept, with the reason, for the record), the item is asked for
--    again, and a completed request reopens. The app removes the imported document and its data.
--
-- 4. CLIENT REMOVE / REPLACE. withdraw_document_request_file(token, file key): until the broker
--    has accepted or is importing a file, the client can take it back (status 'withdrawn') and
--    upload the right one. The client page shows each file as "being checked" or "accepted".
--
-- Additive; safe to run more than once. Must run after 0030.

alter table public.field_values add column if not exists details jsonb;
alter table public.coverage_lines add column if not exists details jsonb;

alter table public.document_request_files add column if not exists resolved_item_id text;
alter table public.document_request_files drop constraint if exists document_request_files_match_check;
alter table public.document_request_files add constraint document_request_files_match_check
  check (match_status in ('pending', 'satisfied', 'needs_review', 'rejected', 'reassigned', 'withdrawn'));

-- An item is still covered while some other file for it is pending, being checked or accepted.
create or replace function public.document_request_item_reopen(p_item_id text, p_except_file_id text) returns void
language sql security definer set search_path = ''
as $$
  update public.document_request_items i
     set status = 'requested', uploaded_at = null, satisfied_at = null
   where i.id = p_item_id and i.status in ('uploaded', 'needs_review', 'satisfied')
     and not exists (
       select 1 from public.document_request_files o
        where o.id <> p_except_file_id
          and ((o.request_item_id = i.id and o.match_status in ('pending', 'needs_review', 'satisfied'))
               or (o.resolved_item_id = i.id and o.match_status in ('satisfied', 'reassigned')))
     )
$$;
revoke all on function public.document_request_item_reopen(text, text) from public, anon, authenticated;

-- What the client page shows: the insured's name and this request's own items, each file marked
-- "being checked" or "accepted", and whether the client can still remove it.
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
        'confirmed', i.status = 'satisfied',
        'files', coalesce((select jsonb_agg(jsonb_build_object(
                             'name', f.file_name,
                             'uploadedAt', f.uploaded_at,
                             'key', f.client_file_key,
                             'state', case when f.match_status = 'satisfied' then 'accepted' else 'checking' end,
                             'removable', f.match_status in ('pending', 'needs_review') and f.imported_at is null
                                          and (f.claimed_at is null or f.claimed_at < now() - interval '10 minutes')
                                          and r.status in ('waiting', 'partial') and r.expires_at > now()
                           ) order by f.uploaded_at)
                             from public.document_request_files f
                            where f.request_item_id = i.id and f.match_status in ('pending', 'needs_review', 'satisfied')), '[]'::jsonb)
      ) order by i.position, i.label)
        from public.document_request_items i
       where i.request_id = r.id and i.status <> 'waived'
    ), '[]'::jsonb)
  )
$$;
revoke all on function public.document_request_public_view(public.document_requests) from public, anon, authenticated;

-- The client takes back a file that hasn't been accepted (e.g. uploaded the wrong one).
create or replace function public.withdraw_document_request_file(p_token uuid, p_file_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.document_requests;
  f public.document_request_files;
  v_label text;
begin
  select * into r from public.document_requests where token = p_token for update;
  if not found then
    raise exception 'This link isn''t valid.' using errcode = '42501';
  end if;
  if r.status not in ('waiting', 'partial') or r.expires_at < now() then
    raise exception 'This request is no longer accepting changes.' using errcode = '42501';
  end if;
  select * into f from public.document_request_files where request_id = r.id and client_file_key = p_file_key for update;
  if not found then
    raise exception 'That file isn''t part of this request.' using errcode = '42501';
  end if;
  if f.match_status = 'withdrawn' then
    return public.document_request_public_view(r); -- already removed (a retry)
  end if;
  if f.match_status not in ('pending', 'needs_review') or f.imported_at is not null
     or (f.claimed_at is not null and f.claimed_at > now() - interval '10 minutes') then
    raise exception 'Your agent has already received this file — contact them if it''s the wrong one.' using errcode = '42501';
  end if;
  update public.document_request_files set match_status = 'withdrawn', match_note = 'Removed by the client' where id = f.id;
  perform public.document_request_item_reopen(f.request_item_id, f.id);
  select label into v_label from public.document_request_items where id = f.request_item_id;
  perform public.document_request_activity(r, 'document_uploaded',
    format('%s removed %s from %s (secure request link).', coalesce(r.contact_name, 'The client'), f.file_name, coalesce(v_label, 'the request')), coalesce(r.contact_name, 'Client'));
  update public.document_requests set updated_at = now() where id = r.id;
  perform public.document_request_refresh(r.id);
  select * into r from public.document_requests where id = r.id;
  return public.document_request_public_view(r);
end;
$$;
revoke all on function public.withdraw_document_request_file(uuid, text) from public;
grant execute on function public.withdraw_document_request_file(uuid, text) to anon, authenticated;

-- A file is claimed for import (short lock, so two tabs never import it twice). The automatic
-- check (p_held false) only takes files nobody has checked yet; confirming a held file
-- (p_held true) takes a file waiting for review. Never a withdrawn, rejected or imported one.
drop function if exists public.claim_document_request_file(text);
create or replace function public.claim_document_request_file(p_file_id text, p_held boolean default false) returns boolean
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
   where id = p_file_id and imported_at is null
     and match_status = case when p_held then 'needs_review' else 'pending' end
     and (claimed_at is null or claimed_at < now() - interval '10 minutes');
  return found;
end;
$$;
revoke all on function public.claim_document_request_file(text, boolean) from public, anon;
grant execute on function public.claim_document_request_file(text, boolean) to authenticated;

-- Give a claim back (the download failed, or the broker's confirmation didn't go through), so the
-- client can still remove the file and another tab can try again without waiting 10 minutes.
create or replace function public.release_document_request_file(p_file_id text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  f public.document_request_files;
begin
  select * into f from public.document_request_files where id = p_file_id;
  if not found then
    return;
  end if;
  perform public.document_request_for_broker(f.request_id);
  update public.document_request_files set claimed_at = null where id = p_file_id and imported_at is null;
end;
$$;
revoke all on function public.release_document_request_file(text) from public, anon;
grant execute on function public.release_document_request_file(text) to authenticated;

-- The automatic check's result. 'satisfied' comes with the account document it was imported as;
-- 'needs_review' may come without one — the file is then held outside the account until the
-- broker confirms it (resolve_document_request_file).
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
  if p_match = 'satisfied' and p_document_id is null then
    raise exception 'An accepted file needs the document it was imported as.' using errcode = '22023';
  end if;
  if f.match_status <> 'pending' or f.imported_at is not null then
    return; -- already recorded (a retry), or the client withdrew it meanwhile
  end if;
  update public.document_request_files
     set imported_document_id = p_document_id,
         imported_at = case when p_document_id is not null then now() end,
         match_status = p_match, match_note = left(p_note, 500), claimed_at = null
   where id = f.id;
  update public.document_request_items
     set status = case when p_match = 'satisfied' then 'satisfied' else 'needs_review' end,
         satisfied_at = case when p_match = 'satisfied' then now() else satisfied_at end
   where id = f.request_item_id and status in ('requested', 'uploaded', 'needs_review');
  perform public.document_request_refresh(f.request_id);
end;
$$;

-- The broker's decision on a file that needed review:
--   satisfy  — it is what was asked for (p_document_id: what it was imported as, if it was held)
--   reject   — it isn't; the item is asked for again (unless another file already covers it)
--   reassign — it's for another item of the same request (p_target_item_id), which it satisfies
drop function if exists public.resolve_document_request_file(text, text, text);
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
    perform public.document_request_item_reopen(f.request_item_id, f.id);
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  -- (A completed request with an item asked for again reopens here.)
  perform public.document_request_refresh(f.request_id);
end;
$$;

-- An accepted file turns out to be the wrong document: keep the record (rejected, with why), ask
-- for the item again and reopen the request. The app removes the imported document and its data.
create or replace function public.mark_document_request_file_wrong(p_file_id text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  f public.document_request_files;
  v_item text;
begin
  select * into f from public.document_request_files where id = p_file_id for update;
  if not found then
    raise exception 'Unknown file.' using errcode = '22023';
  end if;
  perform public.document_request_for_broker(f.request_id);
  if f.match_status = 'rejected' then
    return; -- already marked (a retry)
  end if;
  if f.match_status not in ('satisfied', 'reassigned') then
    raise exception 'Only an accepted file can be marked as the wrong document.' using errcode = '22023';
  end if;
  v_item := coalesce(f.resolved_item_id, f.request_item_id);
  update public.document_request_files
     set match_status = 'rejected', match_note = left(coalesce(nullif(btrim(p_note), ''), 'Wrong document'), 500)
   where id = f.id;
  perform public.document_request_item_reopen(v_item, f.id);
  -- Asking again: a request that had completed is open again.
  update public.document_requests set updated_at = now(), expires_at = greatest(expires_at, now() + interval '30 days') where id = f.request_id;
  perform public.document_request_refresh(f.request_id);
end;
$$;

revoke all on function public.resolve_document_request_file(text, text, text, text) from public, anon;
revoke all on function public.mark_document_request_file_wrong(text, text) from public, anon;
grant execute on function public.resolve_document_request_file(text, text, text, text) to authenticated;
grant execute on function public.mark_document_request_file_wrong(text, text) to authenticated;
