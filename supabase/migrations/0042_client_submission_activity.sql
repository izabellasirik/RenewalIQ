-- Account Activity records what a client actually submitted — facts only.
--
-- When a client submits through a document-request link (Submit) or an intake link (once the
-- submission is in an account: imported, or added to an existing one), the account gets ONE
-- "Client submitted documents" event carrying only what Renewal IQ knows for certain:
--   * when it was submitted (the recorded submission time, not when anyone looked at it),
--   * the account name at that moment,
--   * the original file names as uploaded, and how many,
--   * the email the client typed on the intake form / the contact the request link was sent to,
--   * the intake reference number.
-- No document types: what the reader thinks a file is (MVR, license, …) stays on the document
-- (Applied / Needs Review) and never enters this history. Later corrections don't change it — the
-- event is written once and never updated.
--
-- Duplicates are impossible: the event id is derived from the submission event (request + its
-- submit time; intake submission + account), inserted with ON CONFLICT DO NOTHING — a retried
-- submit, a refresh, a re-delivered notification or a re-run import adds nothing.
--
-- The request Submit used to add a free-text "… submitted their documents (N new files)" line;
-- that is replaced by this event (one per Submit). Additive; safe to run more than once. Needs 0041.

alter table public.activity_events add column if not exists details jsonb;

create or replace function public.record_client_submission_activity(
  p_event_id text, p_account_id text, p_actor uuid, p_occurred timestamptz, p_details jsonb
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer := jsonb_array_length(coalesce(p_details->'files', '[]'::jsonb));
begin
  if p_account_id is null or p_actor is null then
    return;
  end if;
  insert into public.activity_events (id, submission_id, user_id, type, message, occurred_at, actor_name, details)
  values (
    p_event_id, p_account_id, p_actor, 'client_submitted',
    case when coalesce((p_details->>'complete')::boolean, true)
      then format('Client submitted documents — %s file%s received', v_count, case when v_count = 1 then '' else 's' end)
      else format('Client started a submission (not finished) — %s file%s received', v_count, case when v_count = 1 then '' else 's' end) end,
    coalesce(p_occurred, now()), 'Client', p_details)
  on conflict (id) do nothing;
exception when others then
  raise warning 'client submission activity not recorded: %', sqlerrm; -- never fails the submission
end;
$$;
revoke all on function public.record_client_submission_activity(text, text, uuid, timestamptz, jsonb) from public, anon, authenticated;

-- Document request: each Submit that recorded new files.
create or replace function public.document_request_submission_activity() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  s public.submissions;
begin
  if new.client_submitted_at is null or new.client_submitted_at is not distinct from old.client_submitted_at then
    return null;
  end if;
  select * into s from public.submissions where id = new.submission_id;
  perform public.record_client_submission_activity(
    'evt_client_request_' || new.id || '_' || to_char(new.client_submitted_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS'),
    new.submission_id,
    coalesce(s.assigned_user_id, s.user_id, new.created_by),
    new.client_submitted_at,
    jsonb_build_object(
      'source', 'document_request',
      'complete', true,
      'submittedAt', new.client_submitted_at,
      'accountName', s.named_insured,
      -- Original names, as uploaded: the files this Submit covered (since the previous Submit).
      'files', coalesce((select jsonb_agg(f.file_name order by f.uploaded_at) from public.document_request_files f
                          where f.request_id = new.id and f.match_status not in ('withdrawn')
                            and f.uploaded_at <= new.client_submitted_at
                            and (old.client_submitted_at is null or f.uploaded_at > old.client_submitted_at)), '[]'::jsonb),
      'linkSentTo', nullif(btrim(concat_ws(' ', new.contact_name, case when nullif(btrim(new.contact_email), '') is not null then '(' || btrim(new.contact_email) || ')' end)), '')
    ));
  return null;
end;
$$;
drop trigger if exists document_request_submission_activity on public.document_requests;
create trigger document_request_submission_activity after update of client_submitted_at on public.document_requests
  for each row execute function public.document_request_submission_activity();

-- Intake: once the submission is in an account (imported, or added to an existing account).
create or replace function public.intake_submission_activity() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  s public.submissions;
begin
  if new.imported_account_id is null or new.imported_account_id is not distinct from old.imported_account_id then
    return null;
  end if;
  select * into s from public.submissions where id = new.imported_account_id;
  if not found then
    return null;
  end if;
  perform public.record_client_submission_activity(
    'evt_client_intake_' || new.id || '_' || new.imported_account_id,
    new.imported_account_id,
    coalesce(s.assigned_user_id, s.user_id, new.user_id),
    coalesce(new.completed_at, new.last_activity_at, new.created_at),
    jsonb_build_object(
      'source', 'intake',
      'complete', new.completed_at is not null,
      'submittedAt', coalesce(new.completed_at, new.last_activity_at, new.created_at),
      'accountName', coalesce(new.named_insured, s.named_insured),
      'files', coalesce((select jsonb_agg(d.file_name order by d.created_at) from public.intake_documents d where d.intake_submission_id = new.id), '[]'::jsonb),
      'clientEmail', nullif(btrim(new.contact_email), ''),
      'clientName', nullif(btrim(new.contact_name), ''),
      'reference', new.reference
    ));
  return null;
end;
$$;
drop trigger if exists intake_submission_activity on public.intake_submissions;
create trigger intake_submission_activity after update of imported_account_id on public.intake_submissions
  for each row execute function public.intake_submission_activity();

-- Submit no longer writes its own free-text line (the event above replaces it). Otherwise unchanged from 0035.
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
    select * into r from public.document_requests where id = r.id;
  end if;
  return public.document_request_public_view(r);
end;
$$;
revoke all on function public.submit_document_request(uuid) from public;
grant execute on function public.submit_document_request(uuid) to anon, authenticated;
