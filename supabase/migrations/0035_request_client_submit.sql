-- Client document request page: "Submit".
--
-- Files upload as soon as they're chosen (and are verified, quarantined and matched exactly as
-- before); "Submit" is the client saying "that's everything for now". It records when
-- (document_requests.client_submitted_at, shown back to the client) and tells the broker in the
-- account's activity — nothing is accepted, imported or counted by it. The client can add more
-- files and submit again.
--
-- Token-only, like every other client call: the link's token must be valid and the request still
-- open, and at least one file must have been uploaded. Additive; safe to run more than once.
-- Must run after 0033.

alter table public.document_requests add column if not exists client_submitted_at timestamptz;

create or replace function public.submit_document_request(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.document_requests;
  v_files integer;
  v_new integer;
begin
  select * into r from public.document_requests where token = p_token for update;
  if not found then
    raise exception 'This link isn''t valid.' using errcode = '42501';
  end if;
  if r.status not in ('waiting', 'partial', 'complete') or (r.status <> 'complete' and r.expires_at < now()) then
    raise exception 'This request is no longer accepting files.' using errcode = '42501';
  end if;
  select count(*), count(*) filter (where r.client_submitted_at is null or uploaded_at > r.client_submitted_at)
    into v_files, v_new
    from public.document_request_files
   where request_id = r.id and match_status not in ('withdrawn');
  if v_files = 0 then
    raise exception 'Upload at least one file first.' using errcode = '22023';
  end if;
  if v_new > 0 then
    update public.document_requests set client_submitted_at = now(), updated_at = now() where id = r.id;
    perform public.document_request_activity(r, 'document_uploaded',
      format('%s submitted their documents (%s new file%s) — ready for your review.', coalesce(r.contact_name, 'The client'), v_new, case when v_new = 1 then '' else 's' end),
      coalesce(r.contact_name, 'Client'));
    select * into r from public.document_requests where id = r.id;
  end if;
  return public.document_request_public_view(r);
end;
$$;
revoke all on function public.submit_document_request(uuid) from public;
grant execute on function public.submit_document_request(uuid) to anon, authenticated;

-- The client page also shows when they last submitted (0033's view plus 'submittedAt').
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
    'submittedAt', r.client_submitted_at,
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
