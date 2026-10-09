-- 0048: upload limits, and client uploads checked on the server before they count.
--
-- 1. Both storage buckets accept files up to 25 MB, and only these content types (the app stores
--    every file with the type its extension implies — src/services/uploads/uploadCheck.ts):
--    PDF, JPEG, PNG, WebP, HEIC/HEIF, Word (.docx/.doc), Excel (.xlsx/.xls), CSV, plain text.
--    Storage enforces both, whatever the browser sends.
--
-- 2. upload_verifications: files whose real contents the server checked (api/verify-upload reads
--    the first 4 KB with the service key and compares them with the extension; a mismatch is
--    deleted). Written only by that route (service role); nobody else reads or writes it.
--
-- 3. The switch: app_settings 'require_upload_verification'. While false (the default), nothing
--    changes. Once true, a client's upload (a document request or an intake submission) can only be
--    recorded if it was verified — enforced here by a trigger on the tables the upload functions
--    write, so no client and no RPC can skip it. Turn it on only after api/verify-upload is deployed
--    and configured (see SUPABASE_SETUP.md):
--      update public.app_settings set value = 'true' where key = 'require_upload_verification';
--
-- Additive and re-runnable. Existing files and rows are untouched.

-- 1. Bucket limits --------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 26214400,
       allowed_mime_types = array[
         'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
         'text/csv', 'text/plain'
       ]
 where id in ('submission-documents', 'intake-uploads');

-- 2. Verified uploads -------------------------------------------------------------------------
create table if not exists public.upload_verifications (
  bucket_id text not null,
  object_name text not null,
  kind text not null check (kind in ('pdf', 'jpeg', 'png', 'webp', 'heic', 'zip', 'ole', 'text')),
  size_bytes bigint,
  verified_at timestamptz not null default now(),
  primary key (bucket_id, object_name)
);
alter table public.upload_verifications enable row level security;
revoke all on public.upload_verifications from public, anon, authenticated;

-- 3. The switch and its enforcement ----------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from public, anon, authenticated;
insert into public.app_settings (key, value) values ('require_upload_verification', 'false') on conflict (key) do nothing;

do $$ begin
  grant select, insert, update on public.upload_verifications to service_role;
  grant select on public.app_settings to service_role;
exception when undefined_object then null;
end $$;

create or replace function public.require_verified_upload() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce((select (s.value)::text = 'true' from public.app_settings s where s.key = 'require_upload_verification'), false)
     and new.storage_path is not null
     and not exists (select 1 from public.upload_verifications v where v.bucket_id = 'intake-uploads' and v.object_name = new.storage_path) then
    raise exception 'This file hasn''t been checked yet — upload it again.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.require_verified_upload() from public, anon, authenticated;

drop trigger if exists document_request_files_verified_upload on public.document_request_files;
create trigger document_request_files_verified_upload
  before insert or update of storage_path on public.document_request_files
  for each row execute function public.require_verified_upload();

drop trigger if exists intake_documents_verified_upload on public.intake_documents;
create trigger intake_documents_verified_upload
  before insert or update of storage_path on public.intake_documents
  for each row execute function public.require_verified_upload();
