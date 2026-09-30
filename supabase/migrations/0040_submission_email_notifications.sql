-- Email the broker the moment a client submits documents.
--
-- When a client finishes a Submission Intake form (0029: finalize_intake_submission verified every
-- file) or presses Submit on a document request (0035: submit_document_request), the client page asks
-- Renewal IQ's server (api/notify-submission.ts) to email the assigned broker. The server — never the
-- browser — calls claim_submission_email with the service role; it checks the submission really was
-- saved and verified, records the email ONCE per submission event (a retried call, a double click or a
-- second browser gets "already sent"), and returns what the email needs, including the broker's
-- address, which the client never sees. complete_submission_email records whether the email service
-- accepted it; a failed send can be claimed again, a sent one never.
--
-- Recipient: for a document request, the account's assigned broker (else its creator, else whoever
-- created the request); for an intake submission, the broker whose link it came through.
--
-- Nothing here is callable by anon or signed-in users. Additive; safe to run more than once.
-- Must run after 0035 (and 0029).

do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create table if not exists public.submission_email_notifications (
  id bigserial primary key,
  kind text not null check (kind in ('intake', 'request')),
  source_id text not null,
  event_key text not null unique,
  submitted_at timestamptz not null,
  recipient_user_id uuid,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 1,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists submission_email_notifications_source_idx on public.submission_email_notifications (kind, source_id, submitted_at);
alter table public.submission_email_notifications enable row level security;
revoke all on public.submission_email_notifications from anon, authenticated;

create or replace function public.claim_submission_email(p_kind text, p_id text, p_proof text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text;
  v_submitted timestamptz;
  v_prev timestamptz;
  v_recipient uuid;
  v_email text;
  v_row public.submission_email_notifications;
  v_payload jsonb;
  i public.intake_submissions;
  r public.document_requests;
  s public.submissions;
begin
  if p_kind = 'intake' then
    begin
      select * into i from public.intake_submissions x where x.id = p_id and x.client_token = p_proof::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('claimed', false, 'reason', 'not_found');
    end;
    if not found then return jsonb_build_object('claimed', false, 'reason', 'not_found'); end if;
    -- Only a submission whose files were all verified (finalize_intake_submission) is "submitted".
    if i.completed_at is null or i.status not in ('pending', 'imported', 'dismissed') then
      return jsonb_build_object('claimed', false, 'reason', 'not_submitted');
    end if;
    v_key := 'intake:' || i.id;
    v_submitted := i.completed_at;
    v_recipient := i.user_id;
  elsif p_kind = 'request' then
    begin
      select * into r from public.document_requests x where x.token = p_proof::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('claimed', false, 'reason', 'not_found');
    end;
    if not found then return jsonb_build_object('claimed', false, 'reason', 'not_found'); end if;
    if r.client_submitted_at is null then
      return jsonb_build_object('claimed', false, 'reason', 'not_submitted');
    end if;
    select * into s from public.submissions x where x.id = r.submission_id;
    v_key := 'request:' || r.id || ':' || to_char(r.client_submitted_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS');
    v_submitted := r.client_submitted_at;
    v_recipient := coalesce(s.assigned_user_id, s.user_id, r.created_by);
  else
    return jsonb_build_object('claimed', false, 'reason', 'unknown_kind');
  end if;

  select coalesce(nullif(btrim(u.email), ''), nullif(btrim(p.email), '')) into v_email
    from auth.users u left join public.profiles p on p.user_id = u.id where u.id = v_recipient;

  insert into public.submission_email_notifications as n (kind, source_id, event_key, submitted_at, recipient_user_id, status)
  values (p_kind, coalesce(i.id, r.id), v_key, v_submitted, v_recipient, case when v_email is null then 'skipped' else 'sending' end)
  on conflict (event_key) do update
     set status = 'sending', attempts = n.attempts + 1, updated_at = now(), error = null
   where n.status = 'failed' or (n.status = 'sending' and n.updated_at < now() - interval '10 minutes')
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('claimed', false, 'reason', 'already_sent', 'eventKey', v_key);
  end if;
  if v_email is null then
    update public.submission_email_notifications set error = 'The broker has no email address.' where id = v_row.id;
    return jsonb_build_object('claimed', false, 'reason', 'no_recipient', 'eventKey', v_key);
  end if;

  if p_kind = 'intake' then
    v_payload := jsonb_build_object(
      'accountName', coalesce(i.named_insured, 'A new client'),
      'accountId', i.imported_account_id,
      'intakeSubmissionId', i.id,
      'reference', i.reference,
      'clientName', i.contact_name,
      'clientEmail', nullif(btrim(i.contact_email), ''),
      'files', coalesce((select jsonb_agg(d.file_name order by d.created_at) from public.intake_documents d where d.intake_submission_id = i.id), '[]'::jsonb),
      'agencyName', coalesce((select a.name from public.profiles p join public.agencies a on a.id = p.agency_id where p.user_id = i.user_id),
                             (select l.organization_name from public.intake_links l where l.id = i.intake_link_id)));
  else
    -- The files this Submit covered: those since the previous submit that was emailed.
    select max(n.submitted_at) into v_prev from public.submission_email_notifications n
     where n.kind = 'request' and n.source_id = r.id and n.event_key <> v_key and n.submitted_at < r.client_submitted_at;
    v_payload := jsonb_build_object(
      'accountName', coalesce(s.named_insured, 'your client'),
      'accountId', r.submission_id,
      'requestId', r.id,
      'clientName', r.contact_name,
      'clientEmail', nullif(btrim(r.contact_email), ''),
      'files', coalesce((select jsonb_agg(f.file_name order by f.uploaded_at) from public.document_request_files f
                          where f.request_id = r.id and f.match_status not in ('withdrawn')
                            and f.uploaded_at <= r.client_submitted_at and (v_prev is null or f.uploaded_at > v_prev)), '[]'::jsonb),
      'agencyName', (select a.name from public.agencies a where a.id = s.organization_id));
  end if;

  return v_payload || jsonb_build_object(
    'claimed', true, 'eventKey', v_key, 'kind', p_kind, 'submittedAt', v_submitted,
    'brokerEmail', v_email,
    'brokerName', (select coalesce(nullif(btrim(p.display_name), ''), p.email) from public.profiles p where p.user_id = v_recipient));
end;
$$;

create or replace function public.complete_submission_email(p_event_key text, p_sent boolean, p_provider_message_id text default null, p_error text default null)
returns void
language sql security definer set search_path = ''
as $$
  update public.submission_email_notifications
     set status = case when p_sent then 'sent' else 'failed' end,
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         error = case when p_sent then null else left(coalesce(p_error, 'Not sent'), 500) end,
         sent_at = case when p_sent then now() else sent_at end,
         updated_at = now()
   where event_key = p_event_key and status = 'sending'
$$;

revoke all on function public.claim_submission_email(text, text, text) from public, anon, authenticated;
revoke all on function public.complete_submission_email(text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.claim_submission_email(text, text, text) to service_role;
grant execute on function public.complete_submission_email(text, boolean, text, text) to service_role;
