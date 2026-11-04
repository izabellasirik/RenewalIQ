-- 0091 What the agency paid its referral partners, policy by policy (Analytics → Broker fees → Paid to partner).
-- Like agent payments (0084): an Agency Owner or admin ticks the rows and marks them paid on a date; each payment
-- keeps the partner and amount as seen. If a row's amount changes after it was paid, the difference shows as not
-- paid yet. A payment can be undone (kept, marked undone). Owners and admins see them; agents don't.
-- Needs 0086. Additive and re-runnable. Rollback: supabase/release/rollback_0091.sql.

do $$
begin
  if to_regprocedure('public.is_agency_owner()') is null then raise exception '0091 needs 0086.'; end if;
end $$;

create table if not exists public.partner_payments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  submission_id text not null,
  policy_id text not null check (length(policy_id) between 1 and 200),
  partner_name text not null check (length(btrim(partner_name)) between 1 and 200),
  amount_cents bigint not null check (amount_cents between -100000000 and 100000000),
  paid_on date not null,
  paid_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users (id) on delete set null,
  undo_reason text check (undo_reason is null or length(btrim(undo_reason)) between 1 and 500),
  constraint partner_payments_undone check ((undone_at is null) = (undo_reason is null))
);
create index if not exists partner_payments_row on public.partner_payments (agency_id, submission_id, policy_id);
alter table public.partner_payments enable row level security;
drop policy if exists partner_payments_read on public.partner_payments;
create policy partner_payments_read on public.partner_payments for select to authenticated
  using (agency_id = public.current_agency_id() and (public.is_agency_admin() or public.is_agency_owner()));
revoke all on public.partner_payments from public, anon, authenticated;
grant select on public.partner_payments to authenticated;

-- Owners and admins: mark rows paid on a date. p_items: [{submission_id, policy_id, partner_name, amount_cents}].
create or replace function public.record_partner_payments(p_paid_on date, p_items jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  it jsonb;
  n integer := 0;
  c bigint;
begin
  if auth.uid() is null or a is null or not (public.is_agency_owner() or public.is_agency_admin()) then raise exception 'Only an Agency Owner or an admin can record payments.' using errcode = '42501'; end if;
  if p_paid_on is null or p_paid_on > current_date + 31 then raise exception 'Choose the date it was paid.' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Choose what was paid.' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'Mark at most 500 rows at a time.' using errcode = '22023'; end if;
  for it in select x from jsonb_array_elements(p_items) x loop
    if not exists (select 1 from public.submissions sub where sub.id = it ->> 'submission_id' and sub.organization_id = a) then
      raise exception 'That account isn''t in your agency.' using errcode = '42501';
    end if;
    c := (it ->> 'amount_cents')::bigint;
    if c is null or abs(c) > 100000000 then raise exception 'An amount is out of range.' using errcode = '22023'; end if;
    insert into public.partner_payments (agency_id, submission_id, policy_id, partner_name, amount_cents, paid_on, paid_by)
    values (a, it ->> 'submission_id', left(it ->> 'policy_id', 200), left(btrim(coalesce(it ->> 'partner_name', 'Partner')), 200), c, p_paid_on, auth.uid());
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.record_partner_payments(date, jsonb) from public, anon;
grant execute on function public.record_partner_payments(date, jsonb) to authenticated;

create or replace function public.undo_partner_payment(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not (public.is_agency_owner() or public.is_agency_admin()) then raise exception 'Only an Agency Owner or an admin can undo a payment.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'Say why it''s being undone.' using errcode = '22023'; end if;
  update public.partner_payments set undone_at = now(), undone_by = auth.uid(), undo_reason = left(btrim(p_reason), 500)
   where id = p_id and agency_id = public.current_agency_id() and undone_at is null;
  if not found then raise exception 'No such payment, or it was already undone.' using errcode = '22023'; end if;
end $$;
revoke all on function public.undo_partner_payment(uuid, text) from public, anon;
grant execute on function public.undo_partner_payment(uuid, text) to authenticated;

notify pgrst, 'reload schema';
