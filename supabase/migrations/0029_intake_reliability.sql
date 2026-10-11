-- Submission Intake reliability: a client is only told "submitted" after the server has verified
-- the submission, its answers and every one of its files.
--
-- LIFECYCLE
--   uploading  — started by start_intake_submission(); files are being uploaded and attached. The
--                broker sees it as "still being sent" and can't import it (a file arriving after an
--                import used to be refused and lost).
--   pending    — finalize_intake_submission() verified everything and gave the client a reference
--                number. Only now is it a normal submission for the broker.
--   incomplete — left in 'uploading' with no activity for 2 hours (the client closed the tab or lost
--                the connection). Shown to the broker as incomplete; the client can still finish it
--                from the same browser, which reopens it.
--   imported / dismissed — unchanged.
--
-- The client's browser holds a random key (client_token) for its submission. Every client call
-- carries it, so only that browser can add to or finish that submission, and a retried "start"
-- returns the same submission instead of creating a duplicate.
--
-- VERIFICATION (finalize_intake_submission)
--   the row exists; the required answers are saved; every file the client says it sent has a
--   linked intake_documents row AND an object in storage. Anything missing is returned by name and
--   the submission stays 'uploading' — the client never sees success in that case.
--
-- AUDIT: intake_events records started / resumed / file uploaded / failed / retried / removed /
--   verification failed / completed / abandoned / imported / dismissed. The broker (owner) can read them.
--
-- STORAGE: an anonymous upload is accepted only into the folder of a submission that is currently
--   'uploading' (before: anyone could upload anything anywhere in the bucket). A client from before
--   this migration (which uploaded right after creating a 'pending' row) keeps working for 24 hours.
--
-- Additive; safe to run more than once. Must run after 0004, 0013 and 0019.

create sequence if not exists public.intake_reference_seq start with 1001;

alter table public.intake_submissions add column if not exists client_token uuid;
alter table public.intake_submissions add column if not exists reference text;
alter table public.intake_submissions add column if not exists expected_files integer;
alter table public.intake_submissions add column if not exists completed_at timestamptz;
alter table public.intake_submissions add column if not exists last_activity_at timestamptz not null default now();
create unique index if not exists intake_submissions_client_token_idx on public.intake_submissions (client_token) where client_token is not null;
create unique index if not exists intake_submissions_reference_idx on public.intake_submissions (reference) where reference is not null;

-- Earlier submissions get a reference too, oldest first.
update public.intake_submissions s set reference = 'RIQ-' || lpad(nextval('public.intake_reference_seq')::text, 6, '0')
  from (select id from public.intake_submissions where reference is null order by created_at) o
 where s.id = o.id;

alter table public.intake_submissions drop constraint if exists intake_submissions_status_check;
alter table public.intake_submissions add constraint intake_submissions_status_check
  check (status in ('uploading', 'pending', 'imported', 'dismissed', 'incomplete'));

alter table public.intake_documents add column if not exists client_file_key text;
create unique index if not exists intake_documents_client_file_key_idx on public.intake_documents (intake_submission_id, client_file_key) where client_file_key is not null;

create table if not exists public.intake_events (
  id bigint generated always as identity primary key,
  intake_submission_id text not null references public.intake_submissions (id) on delete cascade,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint intake_events_event_check check (event in (
    'started', 'resumed', 'file_uploaded', 'file_failed', 'file_retry', 'file_removed',
    'verification_failed', 'completed', 'abandoned', 'imported', 'dismissed'
  ))
);
create index if not exists intake_events_submission_idx on public.intake_events (intake_submission_id, created_at);
alter table public.intake_events enable row level security;
drop policy if exists "owner reads intake events" on public.intake_events;
create policy "owner reads intake events" on public.intake_events for select to authenticated
  using (exists (select 1 from public.intake_submissions s where s.id = intake_submission_id and s.user_id = auth.uid()));
revoke all on public.intake_events from anon, authenticated;
grant select on public.intake_events to authenticated;

-- --------------------------------------------------------------------------------------------
-- Helpers
-- --------------------------------------------------------------------------------------------
create or replace function public.intake_log(p_submission_id text, p_event text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = ''
as $$
  insert into public.intake_events (intake_submission_id, event, detail)
  values (p_submission_id, p_event, case when length(coalesce(p_detail, '{}'::jsonb)::text) > 4000 then jsonb_build_object('truncated', true) else coalesce(p_detail, '{}'::jsonb) end)
$$;
revoke all on function public.intake_log(text, text, jsonb) from public, anon, authenticated;

create or replace function public.intake_int(p text) returns integer
language sql immutable set search_path = ''
as $$ select case when btrim(coalesce(p, '')) ~ '^\d{1,7}$' then btrim(p)::integer end $$;

create or replace function public.intake_text(p text, p_max integer default 500) returns text
language sql immutable set search_path = ''
as $$ select nullif(left(btrim(coalesce(p, '')), p_max), '') $$;

-- --------------------------------------------------------------------------------------------
-- Client calls (anonymous)
-- --------------------------------------------------------------------------------------------
create or replace function public.start_intake_submission(p_link_token text, p_client_token uuid, p_answers jsonb, p_expected_files integer)
returns table (submission_id text, reference text, status text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_link public.intake_links;
  v_sub public.intake_submissions;
  a jsonb := coalesce(p_answers, '{}'::jsonb);
  v_was text;
begin
  if p_client_token is null then
    raise exception 'Missing submission key.' using errcode = '22023';
  end if;

  select * into v_sub from public.intake_submissions s where s.client_token = p_client_token;
  if found then
    -- The same browser sending again (a retried request, a reload): the same submission, never a second one.
    select * into v_link from public.intake_links l where l.id = v_sub.intake_link_id;
    if v_link.token is distinct from p_link_token then
      raise exception 'This submission belongs to a different link.' using errcode = '42501';
    end if;
    v_was := v_sub.status;
    if v_sub.status in ('uploading', 'incomplete') then
      update public.intake_submissions s set
        status = 'uploading',
        last_activity_at = now(),
        expected_files = greatest(0, coalesce(p_expected_files, 0)),
        named_insured = public.intake_text(a->>'namedInsured'),
        contact_name = public.intake_text(a->>'contactName'),
        contact_email = public.intake_text(a->>'contactEmail'),
        contact_phone = public.intake_text(a->>'contactPhone'),
        dot_number = public.intake_text(a->>'dotNumber', 40),
        mc_number = public.intake_text(a->>'mcNumber', 40),
        years_in_business = public.intake_int(a->>'yearsInBusiness'),
        power_units = public.intake_int(a->>'powerUnits'),
        driver_count = public.intake_int(a->>'driverCount'),
        operation_type = public.intake_text(a->>'operationType'),
        commodities_hauled = public.intake_text(a->>'commoditiesHauled'),
        operating_radius = public.intake_text(a->>'operatingRadius'),
        operating_states = public.intake_text(a->>'operatingStates'),
        coverage_requested = coalesce(array(select left(x, 60) from jsonb_array_elements_text(coalesce(a->'coverageRequested', '[]'::jsonb)) x limit 10), '{}'),
        current_carrier = public.intake_text(a->>'currentCarrier'),
        effective_date = public.intake_text(a->>'effectiveDate', 20),
        additional_notes = public.intake_text(a->>'additionalNotes', 5000)
       where s.id = v_sub.id
      returning * into v_sub;
      if v_was = 'incomplete' then
        perform public.intake_log(v_sub.id, 'resumed', '{}'::jsonb);
      end if;
    end if;
    return query select v_sub.id, v_sub.reference, v_sub.status;
    return;
  end if;

  select * into v_link from public.intake_links l where l.token = p_link_token and l.active;
  if not found then
    raise exception 'This submission link isn''t valid or is no longer active.' using errcode = '42501';
  end if;

  insert into public.intake_submissions (
    id, intake_link_id, user_id, status, client_token, reference, expected_files, last_activity_at,
    named_insured, contact_name, contact_email, contact_phone, dot_number, mc_number,
    years_in_business, power_units, driver_count, operation_type, commodities_hauled,
    operating_radius, operating_states, coverage_requested, current_carrier, effective_date, additional_notes
  ) values (
    'isub_' || replace(gen_random_uuid()::text, '-', ''), v_link.id, v_link.user_id, 'uploading', p_client_token,
    'RIQ-' || lpad(nextval('public.intake_reference_seq')::text, 6, '0'), greatest(0, coalesce(p_expected_files, 0)), now(),
    public.intake_text(a->>'namedInsured'), public.intake_text(a->>'contactName'), public.intake_text(a->>'contactEmail'),
    public.intake_text(a->>'contactPhone'), public.intake_text(a->>'dotNumber', 40), public.intake_text(a->>'mcNumber', 40),
    public.intake_int(a->>'yearsInBusiness'), public.intake_int(a->>'powerUnits'), public.intake_int(a->>'driverCount'),
    public.intake_text(a->>'operationType'), public.intake_text(a->>'commoditiesHauled'), public.intake_text(a->>'operatingRadius'),
    public.intake_text(a->>'operatingStates'),
    coalesce(array(select left(x, 60) from jsonb_array_elements_text(coalesce(a->'coverageRequested', '[]'::jsonb)) x limit 10), '{}'),
    public.intake_text(a->>'currentCarrier'), public.intake_text(a->>'effectiveDate', 20), public.intake_text(a->>'additionalNotes', 5000)
  )
  returning * into v_sub;
  perform public.intake_log(v_sub.id, 'started', jsonb_build_object('expected_files', v_sub.expected_files));
  return query select v_sub.id, v_sub.reference, v_sub.status;
end;
$$;

-- The submission, if this browser's key matches it.
create or replace function public.intake_own(p_submission_id text, p_client_token uuid) returns public.intake_submissions
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.intake_submissions;
begin
  select * into v from public.intake_submissions s where s.id = p_submission_id and s.client_token = p_client_token and p_client_token is not null;
  if not found then
    raise exception 'Unknown submission.' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function public.intake_own(text, uuid) from public, anon, authenticated;

create or replace function public.attach_intake_document(p_submission_id text, p_client_token uuid, p_file_key text, p_file_name text, p_storage_path text, p_size bigint)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v public.intake_submissions := public.intake_own(p_submission_id, p_client_token);
  v_id text;
begin
  if v.status <> 'uploading' then
    raise exception 'This submission is no longer accepting files.' using errcode = '42501';
  end if;
  if p_file_key is null or p_file_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'Invalid file key.' using errcode = '22023';
  end if;
  if p_storage_path is null or left(p_storage_path, length(p_submission_id) + length(p_file_key) + 2) <> p_submission_id || '/' || p_file_key || '/' then
    raise exception 'The file path doesn''t belong to this submission.' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'intake-uploads' and o.name = p_storage_path) then
    raise exception 'The file isn''t in storage.' using errcode = 'P0002';
  end if;

  insert into public.intake_documents (id, intake_submission_id, user_id, file_name, storage_path, size_bytes, client_file_key)
  values ('idoc_' || replace(gen_random_uuid()::text, '-', ''), v.id, v.user_id, coalesce(public.intake_text(p_file_name, 255), 'file'), p_storage_path, least(p_size, 2147483647)::integer, p_file_key)
  on conflict (intake_submission_id, client_file_key) where client_file_key is not null
  do update set file_name = excluded.file_name, storage_path = excluded.storage_path, size_bytes = excluded.size_bytes
  returning id into v_id;

  update public.intake_submissions s set last_activity_at = now() where s.id = v.id;
  perform public.intake_log(v.id, 'file_uploaded', jsonb_build_object('file', p_file_name, 'size', p_size, 'key', p_file_key));
  return v_id;
end;
$$;

create or replace function public.log_intake_event(p_submission_id text, p_client_token uuid, p_event text, p_detail jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.intake_submissions := public.intake_own(p_submission_id, p_client_token);
begin
  if p_event not in ('file_failed', 'file_retry', 'file_removed') then
    raise exception 'Unknown event.' using errcode = '22023';
  end if;
  update public.intake_submissions s set last_activity_at = now() where s.id = v.id;
  perform public.intake_log(v.id, p_event, coalesce(p_detail, '{}'::jsonb));
end;
$$;

create or replace function public.finalize_intake_submission(p_submission_id text, p_client_token uuid, p_file_keys text[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v public.intake_submissions := public.intake_own(p_submission_id, p_client_token);
  v_keys text[] := coalesce(p_file_keys, '{}');
  v_missing text[];
  v_problems text[] := '{}';
  v_removed text[];
begin
  if v.completed_at is not null then
    -- Already verified (a retried request): the same answer again.
    return jsonb_build_object('ok', true, 'reference', v.reference, 'files', v.expected_files, 'alreadyComplete', true);
  end if;
  if v.status <> 'uploading' then
    raise exception 'This submission can''t be finished from here.' using errcode = '42501';
  end if;

  if v.named_insured is null then v_problems := array_append(v_problems, 'Company name'); end if;
  if v.dot_number is null then v_problems := array_append(v_problems, 'DOT number'); end if;
  if v.contact_name is null then v_problems := array_append(v_problems, 'Contact name'); end if;
  if v.contact_email is null then v_problems := array_append(v_problems, 'Email'); end if;

  -- Every file the client sent: linked to this submission AND present in storage.
  select coalesce(array_agg(k), '{}') into v_missing
    from unnest(v_keys) k
   where not exists (
     select 1 from public.intake_documents d
       join storage.objects o on o.bucket_id = 'intake-uploads' and o.name = d.storage_path
      where d.intake_submission_id = v.id and d.client_file_key = k
   );

  if cardinality(v_missing) > 0 or cardinality(v_problems) > 0 then
    update public.intake_submissions s set last_activity_at = now() where s.id = v.id;
    perform public.intake_log(v.id, 'verification_failed', jsonb_build_object('missing', to_jsonb(v_missing), 'problems', to_jsonb(v_problems)));
    return jsonb_build_object('ok', false, 'missing', to_jsonb(v_missing), 'problems', to_jsonb(v_problems));
  end if;

  -- Files the client removed before finishing aren't part of the submission.
  with gone as (
    delete from public.intake_documents d
     where d.intake_submission_id = v.id and d.client_file_key is not null and not (d.client_file_key = any (v_keys))
    returning d.file_name
  )
  select coalesce(array_agg(file_name), '{}') into v_removed from gone;
  if cardinality(v_removed) > 0 then
    perform public.intake_log(v.id, 'file_removed', jsonb_build_object('files', to_jsonb(v_removed)));
  end if;

  update public.intake_submissions s
     set status = 'pending', completed_at = now(), last_activity_at = now(), expected_files = cardinality(v_keys)
   where s.id = v.id;
  perform public.intake_log(v.id, 'completed', jsonb_build_object('files', cardinality(v_keys), 'reference', v.reference));
  return jsonb_build_object('ok', true, 'reference', v.reference, 'files', cardinality(v_keys));
end;
$$;

revoke all on function public.start_intake_submission(text, uuid, jsonb, integer) from public;
revoke all on function public.attach_intake_document(text, uuid, text, text, text, bigint) from public;
revoke all on function public.log_intake_event(text, uuid, text, jsonb) from public;
revoke all on function public.finalize_intake_submission(text, uuid, text[]) from public;
grant execute on function public.start_intake_submission(text, uuid, jsonb, integer) to anon, authenticated;
grant execute on function public.attach_intake_document(text, uuid, text, text, text, bigint) to anon, authenticated;
grant execute on function public.log_intake_event(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.finalize_intake_submission(text, uuid, text[]) to anon, authenticated;

-- --------------------------------------------------------------------------------------------
-- Storage: uploads only into an open submission's folder
-- --------------------------------------------------------------------------------------------
create or replace function public.intake_upload_allowed(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.intake_submissions s
     where s.id = split_part(p_name, '/', 1)
       and (
         (s.status = 'uploading' and s.last_activity_at > now() - interval '7 days')
         -- a client from before 0029: creates a 'pending' row, then uploads straight away
         or (s.status = 'pending' and s.client_token is null and s.created_at > now() - interval '24 hours')
       )
  )
$$;
revoke all on function public.intake_upload_allowed(text) from public;
grant execute on function public.intake_upload_allowed(text) to anon, authenticated;

drop policy if exists "anon can upload intake documents" on storage.objects;
create policy "anon can upload intake documents" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'intake-uploads' and public.intake_upload_allowed(name));

-- --------------------------------------------------------------------------------------------
-- Broker side
-- --------------------------------------------------------------------------------------------

-- A submission still being sent can't be imported (its remaining files would be refused and lost);
-- imports and dismissals are recorded in the submission's events.
create or replace function public.intake_submissions_status_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status and auth.uid() is not null then
    if old.status = 'uploading' and new.status = 'imported' then
      raise exception 'This submission is still being sent by the client — it can be imported once it''s complete.' using errcode = '42501';
    end if;
    if new.status in ('uploading', 'pending') and old.status not in ('uploading', 'pending', 'incomplete') then
      raise exception 'A submission can''t be moved back to %.', new.status using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists intake_submissions_status_guard on public.intake_submissions;
create trigger intake_submissions_status_guard before update of status on public.intake_submissions
  for each row execute function public.intake_submissions_status_guard();

create or replace function public.intake_submissions_status_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('imported', 'dismissed') then
    perform public.intake_log(new.id, new.status, jsonb_build_object('account', new.imported_account_id));
  end if;
  return null;
end;
$$;
drop trigger if exists intake_submissions_status_event on public.intake_submissions;
create trigger intake_submissions_status_event after update of status on public.intake_submissions
  for each row execute function public.intake_submissions_status_event();

-- Submissions a client started but stopped sending (no activity for 2 hours) become 'incomplete'.
-- Called when the broker opens Submission Intake; only touches the caller's own submissions.
create or replace function public.mark_stale_intake_submissions() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  with stale as (
    update public.intake_submissions s set status = 'incomplete'
     where s.user_id = auth.uid() and s.status = 'uploading' and s.last_activity_at < now() - interval '2 hours'
    returning s.id
  ), logged as (
    insert into public.intake_events (intake_submission_id, event, detail)
    select id, 'abandoned', '{}'::jsonb from stale
    returning 1
  )
  select count(*) into n from logged;
  return n;
end;
$$;
revoke all on function public.mark_stale_intake_submissions() from public, anon;
grant execute on function public.mark_stale_intake_submissions() to authenticated;
