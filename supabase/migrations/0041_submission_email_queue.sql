-- Broker emails are queued and sent server-side — the client's browser no longer starts them.
--
-- 0040 had the client page ask the server to send the email after a successful submission, so a
-- client closing the tab at the wrong moment meant no email. Now:
--
--   verified submission ──(same transaction)──► queued row in submission_email_notifications
--        │                                             (status 'pending')
--        └─ after COMMIT, pg_net posts the event to Renewal IQ's server (api/notify-submission)
--             └─ it claims the event (once), sends it, and records 'sent' or 'failed'
--   every 2 minutes pg_cron asks the server to retry anything still due ('pending', 'failed' with
--   its back-off passed, or 'sending' stuck > 10 min), up to 8 attempts.
--
-- * The row is queued by triggers on the submission itself: finalize_intake_submission setting
--   completed_at (every file verified), and submit_document_request setting client_submitted_at.
--   A submission that isn't verified is never queued.
-- * Queuing is a plain insert; the call-out is pg_net's asynchronous queue, sent only after the
--   submission commits and never awaited. Anything going wrong there (pg_net missing, not configured)
--   is swallowed — a submission never fails because of email.
-- * One email per submission event: the event key is unique, a claim is one atomic UPDATE, and the
--   server sends with Resend's Idempotency-Key = event key.
-- * The server is reached with a shared secret from notification_dispatch_settings (private: no
--   policies, no grants); the service-role key stays in Vercel, never in the browser.
--
-- SETUP (once per environment, SQL editor):
--   1. Database → Extensions: enable pg_net and pg_cron (then re-run this file to schedule the retry job).
--   2. insert into public.notification_dispatch_settings (id, endpoint_url, secret, vercel_bypass_token)
--      values (1, 'https://<your deployment>/api/notify-submission', '<long random secret>', null)
--      on conflict (id) do update set endpoint_url = excluded.endpoint_url, secret = excluded.secret,
--        vercel_bypass_token = excluded.vercel_bypass_token;
--      The same secret goes into Vercel as NOTIFY_WEBHOOK_SECRET. For a protected Preview deployment,
--      vercel_bypass_token = Vercel's "Protection Bypass for Automation" secret.
-- Without steps 1–2 submissions work exactly as before and emails simply stay queued ('pending').
--
-- Additive; safe to run more than once. Must run after 0040.

alter table public.submission_email_notifications add column if not exists next_attempt_at timestamptz not null default now();
alter table public.submission_email_notifications drop constraint if exists submission_email_notifications_status_check;
alter table public.submission_email_notifications add constraint submission_email_notifications_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
alter table public.submission_email_notifications alter column status set default 'pending';
alter table public.submission_email_notifications alter column attempts set default 0;
create index if not exists submission_email_notifications_due_idx on public.submission_email_notifications (status, next_attempt_at);

create table if not exists public.notification_dispatch_settings (
  id integer primary key check (id = 1),
  endpoint_url text not null,
  secret text not null,
  vercel_bypass_token text
);
alter table public.notification_dispatch_settings enable row level security;
revoke all on public.notification_dispatch_settings from public, anon, authenticated;

-- --------------------------------------------------------------------------------------------
-- Call-out: ask the server to process one event (or everything due, p_event_key null)
-- --------------------------------------------------------------------------------------------
create or replace function public.dispatch_submission_emails(p_event_key text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.notification_dispatch_settings;
  v_headers jsonb;
begin
  select * into s from public.notification_dispatch_settings where id = 1;
  if not found or to_regnamespace('net') is null then
    return; -- not configured / pg_net not enabled: stays queued
  end if;
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'x-renewaliq-notify-secret', s.secret)
            || case when s.vercel_bypass_token is not null then jsonb_build_object('x-vercel-protection-bypass', s.vercel_bypass_token) else '{}'::jsonb end;
  -- Dynamic, so this file installs (and submissions work) where pg_net isn't enabled.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    using s.endpoint_url,
          case when p_event_key is null then jsonb_build_object('drain', true) else jsonb_build_object('eventKey', p_event_key) end,
          v_headers;
exception when others then
  raise warning 'submission email dispatch skipped: %', sqlerrm; -- never fails the caller
end;
$$;
revoke all on function public.dispatch_submission_emails(text) from public, anon, authenticated;

-- --------------------------------------------------------------------------------------------
-- Queue: one row per verified submission event
-- --------------------------------------------------------------------------------------------
create or replace function public.enqueue_submission_email(p_kind text, p_source_id text, p_submitted_at timestamptz, p_recipient uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := case when p_kind = 'intake' then 'intake:' || p_source_id
                     else 'request:' || p_source_id || ':' || to_char(p_submitted_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS') end;
  v_id bigint;
begin
  insert into public.submission_email_notifications (kind, source_id, event_key, submitted_at, recipient_user_id, status, attempts, next_attempt_at)
  values (p_kind, p_source_id, v_key, p_submitted_at, p_recipient, 'pending', 0, now())
  on conflict (event_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform public.dispatch_submission_emails(v_key);
  end if;
exception when others then
  raise warning 'submission email not queued: %', sqlerrm; -- the submission itself always succeeds
end;
$$;
revoke all on function public.enqueue_submission_email(text, text, timestamptz, uuid) from public, anon, authenticated;

create or replace function public.intake_submission_queue_email() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    perform public.enqueue_submission_email('intake', new.id, new.completed_at, new.user_id);
  end if;
  return null;
end;
$$;
drop trigger if exists intake_submission_queue_email on public.intake_submissions;
create trigger intake_submission_queue_email after update of completed_at on public.intake_submissions
  for each row execute function public.intake_submission_queue_email();

create or replace function public.document_request_queue_email() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  s public.submissions;
begin
  if new.client_submitted_at is not null and new.client_submitted_at is distinct from old.client_submitted_at then
    select * into s from public.submissions x where x.id = new.submission_id;
    perform public.enqueue_submission_email('request', new.id, new.client_submitted_at, coalesce(s.assigned_user_id, s.user_id, new.created_by));
  end if;
  return null;
end;
$$;
drop trigger if exists document_request_queue_email on public.document_requests;
create trigger document_request_queue_email after update of client_submitted_at on public.document_requests
  for each row execute function public.document_request_queue_email();

-- --------------------------------------------------------------------------------------------
-- Server side (service role only): what's due, claim one, record the outcome
-- --------------------------------------------------------------------------------------------
create or replace function public.due_submission_emails(p_limit integer default 20) returns setof text
language sql stable security definer set search_path = ''
as $$
  select event_key from public.submission_email_notifications
   where attempts < 8
     and ((status in ('pending', 'failed') and next_attempt_at <= now())
          or (status = 'sending' and updated_at < now() - interval '10 minutes'))
   order by next_attempt_at
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

create or replace function public.claim_submission_email_event(p_event_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n public.submission_email_notifications;
  v_email text;
  v_prev timestamptz;
  i public.intake_submissions;
  r public.document_requests;
  s public.submissions;
  v_payload jsonb;
begin
  -- One atomic claim: whoever gets the row sends; everyone else (a retry, the cron sweep) gets nothing.
  update public.submission_email_notifications x
     set status = 'sending', attempts = x.attempts + 1, updated_at = now(), error = null
   where x.event_key = p_event_key and x.attempts < 8
     and ((x.status in ('pending', 'failed') and x.next_attempt_at <= now())
          or (x.status = 'sending' and x.updated_at < now() - interval '10 minutes'))
  returning * into n;
  if n.id is null then
    return jsonb_build_object('claimed', false, 'reason', coalesce((select case when status = 'sent' then 'already_sent' when status = 'skipped' then 'skipped' when attempts >= 8 then 'gave_up' else 'not_due' end
                                                                       from public.submission_email_notifications where event_key = p_event_key), 'not_found'));
  end if;

  select coalesce(nullif(btrim(u.email), ''), nullif(btrim(p.email), '')) into v_email
    from auth.users u left join public.profiles p on p.user_id = u.id where u.id = n.recipient_user_id;
  if v_email is null then
    update public.submission_email_notifications set status = 'skipped', error = 'The broker has no email address.', updated_at = now() where id = n.id;
    return jsonb_build_object('claimed', false, 'reason', 'no_recipient');
  end if;

  if n.kind = 'intake' then
    select * into i from public.intake_submissions where id = n.source_id;
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
    select * into r from public.document_requests where id = n.source_id;
    select * into s from public.submissions where id = r.submission_id;
    select max(x.submitted_at) into v_prev from public.submission_email_notifications x
     where x.kind = 'request' and x.source_id = r.id and x.submitted_at < n.submitted_at;
    v_payload := jsonb_build_object(
      'accountName', coalesce(s.named_insured, 'your client'),
      'accountId', r.submission_id,
      'requestId', r.id,
      'clientName', r.contact_name,
      'clientEmail', nullif(btrim(r.contact_email), ''),
      'files', coalesce((select jsonb_agg(f.file_name order by f.uploaded_at) from public.document_request_files f
                          where f.request_id = r.id and f.match_status not in ('withdrawn')
                            and f.uploaded_at <= n.submitted_at and (v_prev is null or f.uploaded_at > v_prev)), '[]'::jsonb),
      'agencyName', (select a.name from public.agencies a where a.id = s.organization_id));
  end if;

  return v_payload || jsonb_build_object(
    'claimed', true, 'eventKey', n.event_key, 'kind', n.kind, 'submittedAt', n.submitted_at, 'attempt', n.attempts,
    'brokerEmail', v_email,
    'brokerName', (select coalesce(nullif(btrim(p.display_name), ''), p.email) from public.profiles p where p.user_id = n.recipient_user_id));
end;
$$;

create or replace function public.complete_submission_email_event(p_event_key text, p_sent boolean, p_provider_message_id text default null, p_error text default null) returns void
language sql security definer set search_path = ''
as $$
  update public.submission_email_notifications
     set status = case when p_sent then 'sent' else 'failed' end,
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         error = case when p_sent then null else left(coalesce(p_error, 'Not sent'), 500) end,
         sent_at = case when p_sent then now() else sent_at end,
         -- back-off: 2, 4, 8 … minutes, at most an hour
         next_attempt_at = case when p_sent then next_attempt_at else now() + least(interval '60 minutes', interval '1 minute' * power(2, attempts)) end,
         updated_at = now()
   where event_key = p_event_key and status = 'sending'
$$;

revoke all on function public.due_submission_emails(integer) from public, anon, authenticated;
revoke all on function public.claim_submission_email_event(text) from public, anon, authenticated;
revoke all on function public.complete_submission_email_event(text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.due_submission_emails(integer) to service_role;
grant execute on function public.claim_submission_email_event(text) to service_role;
grant execute on function public.complete_submission_email_event(text, boolean, text, text) to service_role;

-- Rows 0040 left waiting on a browser call are simply due now.
update public.submission_email_notifications set status = 'pending', next_attempt_at = now()
 where status = 'sending' and updated_at < now() - interval '10 minutes';

-- Retry sweep every 2 minutes (only where pg_cron is enabled).
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'renewaliq-submission-emails';
    perform cron.schedule('renewaliq-submission-emails', '*/2 * * * *',
      $job$ select public.dispatch_submission_emails(null) where exists (select 1 from public.due_submission_emails(1)) $job$);
  end if;
exception when others then
  raise warning 'retry job not scheduled: %', sqlerrm;
end $$;
