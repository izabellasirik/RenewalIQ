-- 0061 Email Assistant: a record of each email an agent reviewed for an account, what was found,
-- and what the agent approved — plus a fingerprint on documents so the same file isn't imported
-- twice.
--
-- What is kept is deliberately small: the email's metadata (sender, subject, date, attachment names
-- and sizes), fingerprints (a hash of the Message-ID, SHA-256 of each attachment) and short evidence
-- snippets (the sentence a document request or deadline came from). Never the email's body, and
-- never the attachments themselves — an attachment reaches the account only when the agent
-- imports it, through the normal upload.
--
--   email_reviews             one row per review; only its status changes afterwards.
--   email_review_attachments  each attachment's name, size, type, SHA-256 and what it looked like.
--   email_review_actions      append-only audit: approved, applied, imported, failed, dismissed,
--                             draft copied / opened. Nothing is ever sent from here.
--   documents.content_sha256  SHA-256 of an uploaded document's bytes (set by the app on upload).
--   email_review_seen()       "was this email / this file seen before on this account?" — dates and
--                             names only, for anyone who can open the account.
--
-- Who sees a review: its creator and the agency's admins, and only while they can open the account.
-- Additive and re-runnable; apps without the Email Assistant ignore all of it.

alter table public.documents add column if not exists content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');
create index if not exists documents_content_sha256_idx on public.documents (submission_id, content_sha256) where content_sha256 is not null;

create table if not exists public.email_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id text not null references public.submissions (id) on delete cascade,
  agency_id uuid references public.agencies (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'applied', 'dismissed')),
  source_kind text not null check (source_kind in ('eml_upload', 'paste', 'gmail', 'outlook')),
  source_file_name text check (length(source_file_name) <= 200),
  provider_message_id text check (length(provider_message_id) <= 300),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16}$'),
  message_id_sha256 text check (message_id_sha256 ~ '^[0-9a-f]{64}$'),
  sender_address text check (length(sender_address) <= 320),
  sender_name text check (length(sender_name) <= 200),
  subject text check (length(subject) <= 300),
  email_date timestamptz,
  attachment_count smallint not null default 0 check (attachment_count between 0 and 100),
  category text not null check (category in ('carrier_request', 'client_response', 'document_delivery', 'unrelated')),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  intent text not null check (intent in ('document_request', 'documents_sent', 'quote', 'decline', 'status_question', 'other')),
  read_method text not null check (read_method in ('rules', 'hybrid')),
  ai_model text check (length(ai_model) <= 100),
  match_status text not null check (match_status in ('matched', 'possible', 'ambiguous', 'none')),
  -- Documents, deadlines, doubts and contradictions, each with its short evidence snippet. Capped
  -- so it can never hold an email body.
  findings jsonb not null default '{}'::jsonb check (jsonb_typeof(findings) = 'object' and pg_column_size(findings) <= 16384)
);
create index if not exists email_reviews_submission_idx on public.email_reviews (submission_id, fingerprint);
create index if not exists email_reviews_agency_idx on public.email_reviews (agency_id, created_at);
alter table public.email_reviews enable row level security;

create table if not exists public.email_review_attachments (
  review_id uuid not null references public.email_reviews (id) on delete cascade,
  position smallint not null check (position between 0 and 99),
  name text not null check (length(name) between 1 and 255),
  content_type text check (length(content_type) <= 150),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  kinds text[] not null default '{}' check (cardinality(kinds) <= 10),
  status text not null check (status in ('new', 'on_account', 'possible_duplicate', 'seen_before', 'repeated_in_email', 'blocked', 'not_supported', 'unreadable')),
  primary key (review_id, position)
);
create index if not exists email_review_attachments_sha_idx on public.email_review_attachments (sha256) where sha256 is not null;
alter table public.email_review_attachments enable row level security;

create table if not exists public.email_review_actions (
  id bigserial primary key,
  review_id uuid not null references public.email_reviews (id) on delete cascade,
  submission_id text not null,
  agency_id uuid,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('approved', 'applied', 'failed', 'imported', 'dismissed', 'draft_copied', 'draft_opened')),
  suggestion_kind text check (length(suggestion_kind) <= 40),
  detail text check (length(detail) <= 500),
  document_ids text[] not null default '{}' check (cardinality(document_ids) <= 25),
  created_at timestamptz not null default now()
);
create index if not exists email_review_actions_review_idx on public.email_review_actions (review_id, created_at);
alter table public.email_review_actions enable row level security;

-- --------------------------------------------------------------------------------------------
-- Who may see a review, and the stamps the app can't set itself.
-- --------------------------------------------------------------------------------------------

create or replace function public.can_see_email_review(p_created_by uuid, p_agency_id uuid, p_submission_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and public.can_access_submission(p_submission_id)
    and (p_created_by = auth.uid() or (p_agency_id is not null and p_agency_id = public.current_agency_id() and public.is_agency_admin())),
    false)
$$;
revoke execute on function public.can_see_email_review(uuid, uuid, text) from public, anon;
grant execute on function public.can_see_email_review(uuid, uuid, text) to authenticated;

-- A new review: the creator is the caller, the agency is the account's, and the caller must be able to open the account.
create or replace function public.email_reviews_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_access_submission(new.submission_id) then
    raise exception 'That account isn''t available to you.' using errcode = '42501';
  end if;
  new.created_by := auth.uid();
  new.agency_id := (select organization_id from public.submissions where id = new.submission_id);
  new.created_at := now();
  new.updated_at := now();
  new.status := 'open';
  return new;
end $$;
drop trigger if exists email_reviews_before_insert on public.email_reviews;
create trigger email_reviews_before_insert before insert on public.email_reviews for each row execute function public.email_reviews_before_insert();

-- Afterwards only the status changes (open → applied / dismissed); what was found stays as it was.
create or replace function public.email_reviews_before_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'A review can''t be changed, only marked applied or dismissed.' using errcode = '42501';
  end if;
  if old.status <> 'open' and new.status <> old.status then
    raise exception 'This review is already %.', old.status using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists email_reviews_before_update on public.email_reviews;
create trigger email_reviews_before_update before update on public.email_reviews for each row execute function public.email_reviews_before_update();

-- An audit entry: stamped with the caller, the review's account and agency, and the time.
create or replace function public.email_review_actions_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r public.email_reviews;
begin
  select * into r from public.email_reviews where id = new.review_id;
  if r.id is null or not public.can_see_email_review(r.created_by, r.agency_id, r.submission_id) then
    raise exception 'That review isn''t available to you.' using errcode = '42501';
  end if;
  new.actor_id := auth.uid();
  new.submission_id := r.submission_id;
  new.agency_id := r.agency_id;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists email_review_actions_before_insert on public.email_review_actions;
create trigger email_review_actions_before_insert before insert on public.email_review_actions for each row execute function public.email_review_actions_before_insert();

drop policy if exists email_reviews_read on public.email_reviews;
create policy email_reviews_read on public.email_reviews for select to authenticated
  using (public.can_see_email_review(created_by, agency_id, submission_id));
drop policy if exists email_reviews_insert on public.email_reviews;
create policy email_reviews_insert on public.email_reviews for insert to authenticated
  with check (public.can_access_submission(submission_id));
drop policy if exists email_reviews_update on public.email_reviews;
create policy email_reviews_update on public.email_reviews for update to authenticated
  using (public.can_see_email_review(created_by, agency_id, submission_id))
  with check (public.can_see_email_review(created_by, agency_id, submission_id));

drop policy if exists email_review_attachments_read on public.email_review_attachments;
create policy email_review_attachments_read on public.email_review_attachments for select to authenticated
  using (exists (select 1 from public.email_reviews r where r.id = review_id));
drop policy if exists email_review_attachments_insert on public.email_review_attachments;
create policy email_review_attachments_insert on public.email_review_attachments for insert to authenticated
  with check (exists (select 1 from public.email_reviews r where r.id = review_id and r.created_by = auth.uid() and r.status = 'open'));

drop policy if exists email_review_actions_read on public.email_review_actions;
create policy email_review_actions_read on public.email_review_actions for select to authenticated
  using (exists (select 1 from public.email_reviews r where r.id = review_id));
drop policy if exists email_review_actions_insert on public.email_review_actions;
create policy email_review_actions_insert on public.email_review_actions for insert to authenticated
  with check (exists (select 1 from public.email_reviews r where r.id = review_id));

revoke all on public.email_reviews from public, anon, authenticated;
revoke all on public.email_review_attachments from public, anon, authenticated;
revoke all on public.email_review_actions from public, anon, authenticated;
grant select, insert on public.email_reviews to authenticated;
grant update (status) on public.email_reviews to authenticated;
grant select, insert on public.email_review_attachments to authenticated;
grant select, insert on public.email_review_actions to authenticated;
grant usage on sequence public.email_review_actions_id_seq to authenticated;

-- --------------------------------------------------------------------------------------------
-- "Seen before?" for everyone who can open the account (a review is otherwise private to its
-- creator and the admins): when this email was last reviewed here, and which of these files came
-- with an earlier email. Dates and file names only.
-- --------------------------------------------------------------------------------------------
create or replace function public.email_review_seen(p_submission_id text, p_fingerprint text, p_hashes text[])
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_access_submission(p_submission_id) then
    raise exception 'That account isn''t available to you.' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_hashes, '{}')) > 100 then
    raise exception 'Too many files.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'reviewed_at', (select max(created_at) from public.email_reviews where submission_id = p_submission_id and fingerprint = p_fingerprint),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object('sha256', x.sha256, 'name', x.name, 'reviewed_at', x.reviewed_at))
      from (
        select distinct on (a.sha256) a.sha256, a.name, r.created_at as reviewed_at
        from public.email_review_attachments a join public.email_reviews r on r.id = a.review_id
        where r.submission_id = p_submission_id and a.sha256 = any (coalesce(p_hashes, '{}'))
        order by a.sha256, r.created_at
      ) x), '[]'::jsonb));
end $$;
revoke all on function public.email_review_seen(text, text, text[]) from public, anon;
grant execute on function public.email_review_seen(text, text, text[]) to authenticated;

notify pgrst, 'reload schema';
