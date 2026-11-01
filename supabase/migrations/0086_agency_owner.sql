-- 0086 Agency Owner: the agency's owner (e.g. its founder). Set by the RenewalIQ founder (developer) only, on Team and
-- Partners. Only the Agency Owner marks agents paid and undoes a payment (Analytics → Policies & endorsements);
-- admins and agents keep seeing the payments. One owner per agency. Needs 0043 and 0084. Re-runnable.
-- Rollback: supabase/release/rollback_0086.sql.

do $$
begin
  if to_regprocedure('public.is_founder()') is null or to_regclass('public.agent_payments') is null then raise exception '0086 needs 0043 and 0084.'; end if;
end $$;

create table if not exists public.agency_owners (
  agency_id uuid primary key references public.agencies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now()
);
alter table public.agency_owners enable row level security;
drop policy if exists agency_owners_read on public.agency_owners;
create policy agency_owners_read on public.agency_owners for select to authenticated using (agency_id = public.current_agency_id());
revoke all on public.agency_owners from public, anon, authenticated;
grant select on public.agency_owners to authenticated;

-- The signed-in user owns their agency.
create or replace function public.is_agency_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.agency_owners o where o.agency_id = public.current_agency_id() and o.user_id = auth.uid())
$$;
revoke all on function public.is_agency_owner() from public, anon;
grant execute on function public.is_agency_owner() to authenticated;

-- RenewalIQ founder only: make a member of their agency its Agency Owner (p_user_id null: no owner).
create or replace function public.set_agency_owner(p_agency_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_founder() then raise exception 'Only the RenewalIQ founder can set the Agency Owner.' using errcode = '42501'; end if;
  if p_user_id is null then
    delete from public.agency_owners where agency_id = p_agency_id;
    return;
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_user_id and p.agency_id = p_agency_id) then
    raise exception 'That person isn''t a member of this agency.' using errcode = '22023';
  end if;
  insert into public.agency_owners (agency_id, user_id, set_by) values (p_agency_id, p_user_id, auth.uid())
  on conflict (agency_id) do update set user_id = excluded.user_id, set_by = excluded.set_by, set_at = now();
end $$;
revoke all on function public.set_agency_owner(uuid, uuid) from public, anon;
grant execute on function public.set_agency_owner(uuid, uuid) to authenticated;

-- 0084's payment functions, now for the Agency Owner only.
create or replace function public.record_agent_payments(p_paid_on date, p_items jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  it jsonb;
  n integer := 0;
  c bigint; b bigint; s bigint;
begin
  if auth.uid() is null or a is null or not public.is_agency_owner() then raise exception 'Only the Agency Owner can record payments.' using errcode = '42501'; end if;
  if p_paid_on is null or p_paid_on > current_date + 31 then raise exception 'Choose the date it was paid.' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Choose what was paid.' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'Mark at most 500 rows at a time.' using errcode = '22023'; end if;
  for it in select x from jsonb_array_elements(p_items) x loop
    if not exists (select 1 from public.submissions sub where sub.id = it ->> 'submission_id' and sub.organization_id = a) then
      raise exception 'That account isn''t in your agency.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles p where p.user_id = (it ->> 'agent_user_id')::uuid and p.agency_id = a) then
      raise exception 'That agent isn''t a member of your agency.' using errcode = '42501';
    end if;
    c := coalesce((it ->> 'commission_cents')::bigint, 0);
    b := coalesce((it ->> 'broker_fee_cents')::bigint, 0);
    s := coalesce((it ->> 'partner_shortfall_cents')::bigint, 0);
    if abs(c) > 100000000 or abs(b) > 100000000 or s < 0 or s > 100000000 then raise exception 'An amount is out of range.' using errcode = '22023'; end if;
    insert into public.agent_payments (agency_id, submission_id, row_key, agent_user_id, commission_cents, broker_fee_cents, partner_shortfall_cents, total_cents, paid_on, paid_by)
    values (a, it ->> 'submission_id', left(it ->> 'row_key', 200), (it ->> 'agent_user_id')::uuid, c, b, s, c + b - s, p_paid_on, auth.uid());
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.record_agent_payments(date, jsonb) from public, anon;
grant execute on function public.record_agent_payments(date, jsonb) to authenticated;

create or replace function public.undo_agent_payment(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_agency_owner() then raise exception 'Only the Agency Owner can undo a payment.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'Say why it''s being undone.' using errcode = '22023'; end if;
  update public.agent_payments set undone_at = now(), undone_by = auth.uid(), undo_reason = left(btrim(p_reason), 500)
   where id = p_id and agency_id = public.current_agency_id() and undone_at is null;
  if not found then raise exception 'No such payment, or it was already undone.' using errcode = '22023'; end if;
end $$;
revoke all on function public.undo_agent_payment(uuid, text) from public, anon;
grant execute on function public.undo_agent_payment(uuid, text) to authenticated;

notify pgrst, 'reload schema';
