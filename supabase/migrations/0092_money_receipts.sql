-- 0092 Receipts on income and expenses: an admin can attach files (receipts, invoices, statements) to an
-- entry so they don't get lost. The files sit in a private Storage bucket, in a folder per agency; only
-- that agency's admins can upload, open or delete them — the same people who see income and expenses
-- (0059). The entry keeps the list of its files. Re-runnable.

alter table public.agency_money_entries add column if not exists receipts jsonb not null default '[]'::jsonb;

-- A list of at most 10 files, each {path, name, size, type}, every path in the entry's own agency folder.
create or replace function public.money_receipts_ok(p_receipts jsonb, p_agency_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_receipts) = 'array'
     and jsonb_array_length(p_receipts) <= 10
     and not exists (
       select 1 from jsonb_array_elements(p_receipts) r
       where jsonb_typeof(r) <> 'object'
          or coalesce(r->>'path', '') not like p_agency_id::text || '/%'
          or (r->>'path') like '%..%'
          or length(r->>'path') > 400
          or length(btrim(coalesce(r->>'name', ''))) not between 1 and 200
     )
$$;

alter table public.agency_money_entries drop constraint if exists agency_money_entries_receipts_ok;
alter table public.agency_money_entries add constraint agency_money_entries_receipts_ok check (public.money_receipts_ok(receipts, agency_id));

-- Private bucket, 10 MB a file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('agency-receipts', 'agency-receipts', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

-- Files live at <agency id>/<folder>/<file>; the agency's admins only.
drop policy if exists agency_receipts_select on storage.objects;
create policy agency_receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'agency-receipts' and (storage.foldername(name))[1] = public.current_agency_id()::text and public.is_agency_admin());
drop policy if exists agency_receipts_insert on storage.objects;
create policy agency_receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'agency-receipts' and (storage.foldername(name))[1] = public.current_agency_id()::text and public.is_agency_admin());
drop policy if exists agency_receipts_delete on storage.objects;
create policy agency_receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'agency-receipts' and (storage.foldername(name))[1] = public.current_agency_id()::text and public.is_agency_admin());

notify pgrst, 'reload schema';
