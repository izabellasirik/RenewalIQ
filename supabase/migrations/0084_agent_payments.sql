-- 0084 What the agency paid its agents, row by row (Analytics → Policies & endorsements). Needs 0011.
--
-- An admin filters the policies (or endorsements) for the dates being paid and the agent, ticks the rows and
-- marks them paid on a date. Each row's payment keeps what was paid: the agent commission, the broker fee share
-- and any referral partner shortfall taken from the commission (0083), as the admin saw them. If a row's amount
-- changes after it was paid, the app shows the difference as not paid yet; paying it adds another payment.
-- A payment can be undone by an admin, with a reason; nothing is deleted.
-- Admins see the agency's payments; an agent sees only their own. Additive and re-runnable.
-- Rollback: supabase/release/rollback_0084.sql.

do $$
begin
  if to_regprocedure('public.current_agency_id()') is null or to_regprocedure('public.is_agency_admin()') is null then
    raise exception '0084 needs 0011.';
  end if;
end $$;

create table if not exists public.agent_payments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  submission_id text not null,
  -- The row: a policy's or endorsement's id on the account, or "cx-<record id>" for a cancellation.
  row_key text not null check (length(row_key) between 1 and 200),
  agent_user_id uuid not null references auth.users (id) on delete cascade,
  commission_cents bigint not null default 0,
  broker_fee_cents bigint not null default 0,
  partner_shortfall_cents bigint not null default 0,
  total_cents bigint not null,
  paid_on date not null,
  paid_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users (id) on delete set null,
  undo_reason text check (undo_reason is null or length(btrim(undo_reason)) between 1 and 500),
  constraint agent_payments_total check (total_cents = commission_cents + broker_fee_cents - partner_shortfall_cents),
  constraint agent_payments_undone check ((undone_at is null) = (undo_reason is null))
);
create index if not exists agent_payments_row on public.agent_payments (agency_id, submission_id, row_key);
create index if not exists agent_payments_agent on public.agent_payments (agency_id, agent_user_id, paid_on desc);
alter table public.agent_payments enable row level security;
drop policy if exists agent_payments_read on public.agent_payments;
create policy agent_payments_read on public.agent_payments for select to authenticated
  using (agency_id = public.current_agency_id() and (public.is_agency_admin() or agent_user_id = auth.uid()));
revoke all on public.agent_payments from public, anon, authenticated;
grant select on public.agent_payments to authenticated;

-- Admins: mark rows paid on a date. p_items: [{submission_id, row_key, agent_user_id, commission_cents,
-- broker_fee_cents, partner_shortfall_cents}]. Returns how many were recorded.
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
  if auth.uid() is null or a is null or not public.is_agency_admin() then raise exception 'Only an agency admin can record payments.' using errcode = '42501'; end if;
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

-- Admins: undo a payment recorded by mistake (kept, marked undone with the reason).
create or replace function public.undo_agent_payment(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_agency_admin() then raise exception 'Only an agency admin can undo a payment.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'Say why it''s being undone.' using errcode = '22023'; end if;
  update public.agent_payments set undone_at = now(), undone_by = auth.uid(), undo_reason = left(btrim(p_reason), 500)
   where id = p_id and agency_id = public.current_agency_id() and undone_at is null;
  if not found then raise exception 'No such payment, or it was already undone.' using errcode = '22023'; end if;
end $$;
revoke all on function public.undo_agent_payment(uuid, text) from public, anon;
grant execute on function public.undo_agent_payment(uuid, text) to authenticated;

notify pgrst, 'reload schema';
