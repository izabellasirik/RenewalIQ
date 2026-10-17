-- Fix: files a client attached through a submission link were never recorded.
--
-- 0004's insert policy on intake_documents checks that the submission exists and is pending with a
-- sub-select on intake_submissions — but that sub-select runs with the CLIENT's permissions, and an
-- anonymous client can't read intake_submissions (by design). So the check always failed for real
-- clients: the file reached Storage, but its intake_documents row was rejected, and the broker saw
-- "No documents attached". (A broker testing their own link while signed in wasn't affected.)
--
-- This replaces that one policy with the same rule evaluated by a SECURITY DEFINER function, adds
-- a 24-hour window (files are attached right after the form is sent), and then recovers every file
-- already sitting in the intake-uploads bucket without a row — so past submissions get their
-- documents back. Nothing else changes: brokers still only see their own submissions and files.
--
-- Safe to run more than once. Must run after 0004.

create or replace function public.intake_submission_accepts_documents(p_submission_id text, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.intake_submissions s
     where s.id = p_submission_id
       and s.user_id = p_user_id
       and s.status = 'pending'
       and s.created_at > now() - interval '24 hours'
  )
$$;

revoke all on function public.intake_submission_accepts_documents(text, uuid) from public;
grant execute on function public.intake_submission_accepts_documents(text, uuid) to anon, authenticated;

drop policy if exists "anon can attach documents to their own intake submission" on public.intake_documents;
create policy "anon can attach documents to their own intake submission"
  on public.intake_documents for insert
  to anon, authenticated
  with check (public.intake_submission_accepts_documents(intake_submission_id, user_id));

-- Recover files uploaded before this fix: path is {submission_id}/{document_id}/{file name}.
insert into public.intake_documents (id, intake_submission_id, user_id, file_name, storage_path, size_bytes, created_at)
select split_part(o.name, '/', 2),
       s.id,
       s.user_id,
       substr(o.name, length(split_part(o.name, '/', 1)) + length(split_part(o.name, '/', 2)) + 3),
       o.name,
       nullif(o.metadata ->> 'size', '')::bigint,
       coalesce(o.created_at, now())
  from storage.objects o
  join public.intake_submissions s on s.id = split_part(o.name, '/', 1)
 where o.bucket_id = 'intake-uploads'
   and split_part(o.name, '/', 3) <> ''
   and not exists (select 1 from public.intake_documents d where d.storage_path = o.name)
on conflict (id) do nothing;
