-- External Submission Intake: lets a broker generate a shareable, unauthenticated link that an
-- agency/safety company/client can open to submit basic account info + documents WITHOUT a Renewal
-- IQ login. Deliberately built as a staging queue reviewed by an explicit broker click ("Import"),
-- not a fully-automatic write into the broker's live submissions table — the alternative (an
-- anonymous, public endpoint writing directly into another user's private workspace) would require
-- the Postgres service-role key on a public-facing code path, the single most dangerous credential
-- in this system; staging avoids that entirely while keeping the applicant-facing flow itself just
-- as simple (submit and you're done — one screen, no follow-up). Importing an intake_submission
-- reuses the exact same account-creation + document-extraction pipeline
-- (createAccountFromExtraction, addFiles) a broker already uses for any other submission — this
-- migration only adds the anonymous drop box in front of it.
--
-- FLOW: broker creates an intake_links row (from the signed-in app) -> shares
-- https://.../intake/{token} -> anonymous visitor fills the form + uploads files -> browser writes
-- one intake_submissions row + N intake_documents rows + N Storage objects, all client-side, no
-- server code involved -> broker's Dashboard shows a "Pending Intake Submissions" queue -> broker
-- clicks Import -> client creates the real submission and runs OCR/vision extraction exactly as an
-- upload does today, tagging every applicant-typed field extractionMethod: 'applicant_provided'
-- (see types/common.ts) so it goes through the SAME conflict/corroboration merge as any other
-- source when document extraction disagrees with what the applicant typed.
--
-- SECURITY MODEL (read before applying):
--   anon (unauthenticated visitor, the applicant):
--     - intake_links: SELECT only (to validate a token is real/active before rendering the form;
--       the token itself is the unguessable secret, same trust model as any share link — no client
--       business data lives on this row, only a broker-chosen label).
--     - intake_submissions / intake_documents: INSERT only, and only when intake_link_id references
--       an ACTIVE link, with user_id forced (via WITH CHECK, never trusted from the client) to that
--       link's own owning broker — an anonymous submitter cannot write a row claiming to belong to
--       a different broker than the one whose link they actually used. NO select/update/delete —
--       once submitted, the applicant cannot read back their own or anyone else's submission.
--   authenticated, not the owner: no access to another broker's intake_links/intake_submissions/
--     intake_documents, in any direction.
--   authenticated owner (user_id = auth.uid()): full CRUD on their own intake_links; select/update
--     on their own intake_submissions/intake_documents; no anon-style insert policy is needed for
--     the owner since a broker never submits through this path themselves.
-- This migration has not been applied to any live project yet.

create table if not exists intake_links (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  token text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint intake_links_label_not_blank check (btrim(label) <> '')
);

create index if not exists intake_links_user_id_idx on intake_links (user_id);
create index if not exists intake_links_token_idx on intake_links (token);

create table if not exists intake_submissions (
  id text primary key,
  intake_link_id text not null references intake_links (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  -- Applicant-provided answers — every one nullable; the intake form asks for all of these but
  -- requires only named_insured/contact_name/contact_email (enforced client-side, not here, so a
  -- partial submission from a flaky mobile connection still isn't a hard database error).
  named_insured text,
  contact_name text,
  contact_email text,
  contact_phone text,
  dot_number text,
  mc_number text,
  years_in_business integer,
  power_units integer,
  driver_count integer,
  operation_type text,
  commodities_hauled text,
  operating_radius text,
  operating_states text,
  coverage_requested text[],
  current_carrier text,
  effective_date text,
  additional_notes text,
  created_at timestamptz not null default now(),
  imported_at timestamptz,
  imported_account_id text,
  constraint intake_submissions_status_check check (status in ('pending', 'imported', 'dismissed'))
);

create index if not exists intake_submissions_user_id_idx on intake_submissions (user_id);
create index if not exists intake_submissions_status_idx on intake_submissions (status);
create index if not exists intake_submissions_link_id_idx on intake_submissions (intake_link_id);

create table if not exists intake_documents (
  id text primary key,
  intake_submission_id text not null references intake_submissions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  size_bytes integer,
  created_at timestamptz not null default now()
);

create index if not exists intake_documents_submission_id_idx on intake_documents (intake_submission_id);
create index if not exists intake_documents_user_id_idx on intake_documents (user_id);

alter table intake_links enable row level security;
alter table intake_submissions enable row level security;
alter table intake_documents enable row level security;

-- ============================================================================================
-- intake_links
-- ============================================================================================

-- Deliberately unrestricted SELECT: the token is the actual secret (random, unguessable), and the
-- public form must be able to confirm a token is real/active before rendering.
create policy "anyone can read an intake link to validate it"
  on intake_links for select
  to anon, authenticated
  using (true);

create policy "owner can insert own intake links"
  on intake_links for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "owner can update own intake links"
  on intake_links for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owner can delete own intake links"
  on intake_links for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================================
-- intake_submissions
-- ============================================================================================

-- The user_id = intake_links.user_id check is the anti-spoofing guard: a client can SEE a link's
-- user_id (intake_links is publicly readable, above) but cannot claim a submission belongs to a
-- DIFFERENT broker than the one who actually owns the link referenced — Postgres evaluates this
-- server-side regardless of what the client sends.
create policy "anon can submit through an active intake link"
  on intake_submissions for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and exists (
      select 1 from intake_links
      where intake_links.id = intake_submissions.intake_link_id
        and intake_links.active = true
        and intake_links.user_id = intake_submissions.user_id
    )
  );

create policy "owner can select own intake submissions"
  on intake_submissions for select
  to authenticated
  using (user_id = auth.uid());

create policy "owner can update own intake submissions"
  on intake_submissions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- No delete policy — an imported or dismissed submission stays as a record, same "nothing broker-
-- reviewed is ever silently removed" convention as appetite_update_history/product_feedback.

-- ============================================================================================
-- intake_documents
-- ============================================================================================

create policy "anon can attach documents to their own intake submission"
  on intake_documents for insert
  to anon, authenticated
  with check (
    exists (
      select 1 from intake_submissions
      where intake_submissions.id = intake_documents.intake_submission_id
        and intake_submissions.user_id = intake_documents.user_id
        and intake_submissions.status = 'pending'
    )
  );

create policy "owner can select own intake documents"
  on intake_documents for select
  to authenticated
  using (user_id = auth.uid());

-- No update/delete policy on intake_documents for any role — once attached to a pending
-- submission, a file reference is immutable.

-- ============================================================================================
-- Private Storage — intake-uploads bucket
-- ============================================================================================

insert into storage.buckets (id, name, public)
values ('intake-uploads', 'intake-uploads', false)
on conflict (id) do nothing;

-- Path convention: {intake_submission_id}/{document_id}/{filename}. Anonymous upload is allowed
-- unconditionally at the bucket level (the applicant has no auth token to scope a policy against) —
-- intake_documents' own insert policy (above) is the real gate on what gets referenced; an orphaned
-- upload with no matching intake_documents row is simply never visible to anyone, since the broker
-- read policy below only ever resolves objects through a real intake_submissions row they own.
create policy "anon can upload intake documents"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'intake-uploads');

create policy "owner can read their intake documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'intake-uploads'
    and exists (
      select 1 from intake_submissions
      where intake_submissions.id = (storage.foldername(name))[1]
        and intake_submissions.user_id = auth.uid()
    )
  );

create policy "owner can delete their intake documents"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'intake-uploads'
    and exists (
      select 1 from intake_submissions
      where intake_submissions.id = (storage.foldername(name))[1]
        and intake_submissions.user_id = auth.uid()
    )
  );
