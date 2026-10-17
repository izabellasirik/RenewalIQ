-- FILE TYPES IN USE — read-only. Shows every kind of file already stored, and how many of them
-- 0048 would refuse if they were uploaded again today (wrong type or over 25 MB). Changes nothing;
-- shows names' extensions and sizes only, never contents or file names.
--
-- Run in the Supabase SQL editor before applying 0048. Rows with would_be_refused > 0 are the
-- workflow to look at (e.g. clients sending .tif scans or forwarded .msg emails).

with allowed(ext, mime) as (
  values ('pdf', 'application/pdf'), ('jpg', 'image/jpeg'), ('jpeg', 'image/jpeg'), ('png', 'image/png'),
         ('webp', 'image/webp'), ('heic', 'image/heic'), ('heif', 'image/heif'),
         ('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), ('doc', 'application/msword'),
         ('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), ('xls', 'application/vnd.ms-excel'),
         ('csv', 'text/csv'), ('txt', 'text/plain')
),
files as (
  select bucket_id,
         case when name ~ '\.[A-Za-z0-9]{1,5}$' then lower(substring(name from '\.([A-Za-z0-9]{1,5})$')) else '(none)' end as ext,
         coalesce((metadata ->> 'size')::bigint, 0) as size_bytes,
         created_at
    from storage.objects
   where bucket_id in ('submission-documents', 'intake-uploads')
)
select case f.bucket_id when 'submission-documents' then 'broker uploads + quote files' else 'client requests + intake' end as uploaded_by,
       f.ext as extension,
       count(*) as files,
       count(*) filter (where f.created_at > now() - interval '90 days') as last_90_days,
       round(max(f.size_bytes) / 1048576.0, 1) as largest_mb,
       count(*) filter (where a.ext is null or f.size_bytes > 26214400) as would_be_refused,
       case when a.ext is null then 'type not on the list' when max(f.size_bytes) > 26214400 then 'some over 25 MB' else 'ok' end as verdict
  from files f
  left join allowed a on a.ext = f.ext
 group by f.bucket_id, f.ext, a.ext
 order by would_be_refused desc, files desc;
