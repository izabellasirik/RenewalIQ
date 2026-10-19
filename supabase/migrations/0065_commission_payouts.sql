-- 0065 Commission payouts (needs 0064).
--
-- Agents are paid from the commission records of 0064, in two separate kinds of payout run:
--   weekly  — policies (and their cancellations / corrections), for a Monday–Sunday binding week, paid the
--             following Friday (finance_settings);
--   monthly — endorsements (and theirs), for a calendar month, paid on the first Friday of the next month
--             (finance_settings; the payday is a setting).
-- A run takes every verified record of its kind that is due by its payday and not yet paid: records of its
-- period, records verified after their own payday (late), and cancellations / corrections approved before
-- its period ended. Never a past run: runs follow one another, and a closed run takes nothing more.
-- Nothing unverified, flagged, historical-not-reviewed, settled outside RenewalIQ or already paid is ever
-- included, and carrier payment plays no part.
--
-- Each agent's payout in a run is approved by an admin (one by one, or all the ready ones at once), with the
-- amount the admin saw; approving locks the records into that payout (a record can be in one payout only)
-- and works out the agent's commission balance:
--   line   = the records' agent commission + the admin's adjustments (each with a reason)
--   line < 0  → nothing to pay; the negative amount is carried (one balance per agent, across weekly and
--               monthly payouts), linked to the payout and records it came from
--   line ≥ 0  → what the agent owes from earlier is recovered first (oldest first), the rest is paid
-- Each carried amount can be recovered or written off (an admin, with a reason) only up to what's left of
-- it. Marking a payout paid needs the payment date (a reference is optional). An approval can be undone,
-- with a reason, only before it's paid and while its run is open. Nothing is deleted; every step is in
-- finance_audit_log.
--
-- Admins read everything and act through the functions below only. Agents see only their own payouts,
-- records (agent commission only — never carrier rates or carrier commission) and balance. Re-runnable.

-- ───────────────────────────── tables ─────────────────────────────

create table if not exists public.finance_payout_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id),
  stream text not null check (stream in ('weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  pay_date date not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete set null,
  close_note text check (length(close_note) <= 1000),
  constraint finance_payout_runs_period check (period_end >= period_start and pay_date > period_end),
  unique (agency_id, stream, period_start)
);
-- One open run of each kind at a time: the next is started once this one is closed.
create unique index if not exists finance_payout_runs_one_open on public.finance_payout_runs (agency_id, stream) where closed_at is null;
alter table public.finance_payout_runs enable row level security;

-- One agent's payout in a run, written when an admin approves it.
create table if not exists public.finance_payouts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id),
  run_id uuid not null references public.finance_payout_runs (id),
  agent_user_id uuid not null,
  agent_name text not null default '',
  status text not null default 'approved' check (status in ('approved', 'paid', 'cancelled')),
  item_count integer not null check (item_count >= 0),
  records_cents bigint not null,
  adjustments_cents bigint not null,
  line_cents bigint not null,
  -- The agent's balance just before (0 or negative: what they owed from earlier payouts).
  balance_before_cents bigint not null check (balance_before_cents <= 0),
  recovered_cents bigint not null check (recovered_cents >= 0),
  carried_cents bigint not null check (carried_cents <= 0),
  pay_cents bigint not null check (pay_cents >= 0),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz not null default now(),
  approve_note text check (length(approve_note) <= 1000),
  paid_on date,
  paid_reference text check (length(paid_reference) <= 200),
  paid_by uuid references auth.users (id) on delete set null,
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancel_reason text check (length(cancel_reason) <= 1000),
  constraint finance_payouts_line check (line_cents = records_cents + adjustments_cents),
  constraint finance_payouts_math check (carried_cents = least(line_cents, 0)
                                         and recovered_cents = least(greatest(line_cents, 0), -balance_before_cents)
                                         and pay_cents = greatest(line_cents, 0) - recovered_cents),
  constraint finance_payouts_paid check ((status = 'paid') = (paid_on is not null and paid_at is not null) and (status <> 'paid' or pay_cents > 0)),
  constraint finance_payouts_cancelled check ((status = 'cancelled') = (cancelled_at is not null and length(btrim(coalesce(cancel_reason, ''))) > 0))
);
create unique index if not exists finance_payouts_one_per_agent on public.finance_payouts (run_id, agent_user_id) where status <> 'cancelled';
create index if not exists finance_payouts_agent on public.finance_payouts (agency_id, agent_user_id);
alter table public.finance_payouts enable row level security;

-- The records in a payout, with the agent commission as paid.
create table if not exists public.finance_payout_items (
  id bigint generated always as identity primary key,
  agency_id uuid not null references public.agencies (id),
  payout_id uuid not null references public.finance_payouts (id),
  transaction_id uuid not null references public.commission_transactions (id),
  agent_cents bigint not null,
  -- Due by an earlier payday (verified late, or a cancellation / correction approved after its period).
  late boolean not null default false,
  -- False only once its payout's approval was undone (the record is then free for the next payout).
  active boolean not null default true,
  unique (payout_id, transaction_id)
);
-- The same commission is never paid twice.
create unique index if not exists finance_payout_items_paid_once on public.finance_payout_items (transaction_id) where active;
alter table public.finance_payout_items enable row level security;

-- An admin's adjustment to one agent's payout in a run (+ or −), with the reason.
create table if not exists public.finance_payout_adjustments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id),
  run_id uuid not null references public.finance_payout_runs (id),
  agent_user_id uuid not null,
  amount_cents bigint not null check (amount_cents <> 0 and abs(amount_cents) < 100000000000),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text check (length(void_reason) <= 1000),
  constraint finance_payout_adjustments_void check ((voided_at is null) = (void_reason is null))
);
create index if not exists finance_payout_adjustments_run on public.finance_payout_adjustments (run_id, agent_user_id);
alter table public.finance_payout_adjustments enable row level security;

-- A record held out of one run (it stays verified and is due again in the next).
create table if not exists public.finance_payout_holds (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id),
  run_id uuid not null references public.finance_payout_runs (id),
  transaction_id uuid not null references public.commission_transactions (id),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references auth.users (id) on delete set null,
  release_reason text check (length(release_reason) <= 1000),
  constraint finance_payout_holds_release check ((released_at is null) = (release_reason is null))
);
create unique index if not exists finance_payout_holds_one on public.finance_payout_holds (run_id, transaction_id) where released_at is null;
alter table public.finance_payout_holds enable row level security;

-- The agent's commission balance (one per agent, across weekly and monthly payouts): negative amounts
-- carried from payouts that ended below zero, and what later payouts recovered or an admin wrote off.
create table if not exists public.finance_agent_balance_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id),
  agent_user_id uuid not null,
  kind text not null check (kind in ('carried', 'recovered', 'written_off')),
  amount_cents bigint not null,
  -- carried: the payout that ended negative; recovered: the payout that recovered it.
  payout_id uuid references public.finance_payouts (id),
  -- recovered / written off: the carried amount it reduces.
  applies_to uuid references public.finance_agent_balance_entries (id),
  reason text check (length(reason) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text check (length(void_reason) <= 1000),
  constraint finance_agent_balance_entries_kind check (
    (kind = 'carried' and amount_cents < 0 and payout_id is not null and applies_to is null)
    or (kind = 'recovered' and amount_cents > 0 and payout_id is not null and applies_to is not null)
    or (kind = 'written_off' and amount_cents > 0 and payout_id is null and applies_to is not null and length(btrim(coalesce(reason, ''))) > 0)),
  constraint finance_agent_balance_entries_void check ((voided_at is null) = (void_reason is null))
);
create index if not exists finance_agent_balance_entries_agent on public.finance_agent_balance_entries (agency_id, agent_user_id);
create unique index if not exists finance_agent_balance_entries_one_recovery on public.finance_agent_balance_entries (payout_id, applies_to) where kind = 'recovered';
create unique index if not exists finance_agent_balance_entries_one_carry on public.finance_agent_balance_entries (payout_id) where kind = 'carried';
alter table public.finance_agent_balance_entries enable row level security;

-- ───────────────────────────── guards ─────────────────────────────

create or replace function public.finance_payout_runs_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Payout runs are kept.' using errcode = '42501'; end if;
  if old.closed_at is not null
     or (new.id, new.agency_id, new.stream, new.period_start, new.period_end, new.pay_date, new.created_by, new.created_at)
        is distinct from (old.id, old.agency_id, old.stream, old.period_start, old.period_end, old.pay_date, old.created_by, old.created_at) then
    raise exception 'A payout run can''t be changed, only closed once.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists finance_payout_runs_guard on public.finance_payout_runs;
create trigger finance_payout_runs_guard before update or delete on public.finance_payout_runs
  for each row execute function public.finance_payout_runs_guard();

create or replace function public.finance_payouts_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Payouts are kept.' using errcode = '42501'; end if;
  if (new.id, new.agency_id, new.run_id, new.agent_user_id, new.agent_name, new.item_count, new.records_cents, new.adjustments_cents, new.line_cents,
      new.balance_before_cents, new.recovered_cents, new.carried_cents, new.pay_cents, new.approved_by, new.approved_at, new.approve_note)
     is distinct from
     (old.id, old.agency_id, old.run_id, old.agent_user_id, old.agent_name, old.item_count, old.records_cents, old.adjustments_cents, old.line_cents,
      old.balance_before_cents, old.recovered_cents, old.carried_cents, old.pay_cents, old.approved_by, old.approved_at, old.approve_note) then
    raise exception 'An approved payout''s amounts can''t be changed.' using errcode = '42501';
  end if;
  if old.status <> 'approved' then raise exception 'A paid or undone payout can''t be changed.' using errcode = '42501'; end if;
  if not ((new.status = 'paid' and new.cancelled_at is null) or (new.status = 'cancelled' and new.paid_on is null and new.paid_at is null)) then
    raise exception 'An approved payout is either paid or its approval undone.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists finance_payouts_guard on public.finance_payouts;
create trigger finance_payouts_guard before update or delete on public.finance_payouts
  for each row execute function public.finance_payouts_guard();

create or replace function public.finance_payout_items_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Payout records are kept.' using errcode = '42501'; end if;
  if (new.id, new.agency_id, new.payout_id, new.transaction_id, new.agent_cents, new.late) is distinct from (old.id, old.agency_id, old.payout_id, old.transaction_id, old.agent_cents, old.late)
     or not (old.active and not new.active)
     or not exists (select 1 from public.finance_payouts p where p.id = old.payout_id and p.status = 'cancelled') then
    raise exception 'A record in a payout stays in it (unless that payout''s approval is undone).' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists finance_payout_items_guard on public.finance_payout_items;
create trigger finance_payout_items_guard before update or delete on public.finance_payout_items
  for each row execute function public.finance_payout_items_guard();

create or replace function public.finance_payout_notes_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  closing text[] := case when tg_table_name = 'finance_payout_holds' then array['released_at', 'released_by', 'release_reason'] else array['voided_at', 'voided_by', 'void_reason'] end;
begin
  if tg_op = 'DELETE' then raise exception 'This history is kept.' using errcode = '42501'; end if;
  if (o - closing) is distinct from (n - closing) or o ->> closing[1] is not null or n ->> closing[1] is null then
    raise exception 'This can''t be changed, only voided or released once.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists finance_payout_adjustments_guard on public.finance_payout_adjustments;
create trigger finance_payout_adjustments_guard before update or delete on public.finance_payout_adjustments
  for each row execute function public.finance_payout_notes_guard();
drop trigger if exists finance_payout_holds_guard on public.finance_payout_holds;
create trigger finance_payout_holds_guard before update or delete on public.finance_payout_holds
  for each row execute function public.finance_payout_notes_guard();
drop trigger if exists finance_agent_balance_entries_guard on public.finance_agent_balance_entries;
create trigger finance_agent_balance_entries_guard before update or delete on public.finance_agent_balance_entries
  for each row execute function public.finance_payout_notes_guard();

-- A carried amount is never recovered or written off beyond what's left of it (no double recovery).
create or replace function public.finance_balance_entry_check() returns trigger
language plpgsql set search_path = ''
as $$
declare
  c public.finance_agent_balance_entries;
  used bigint;
begin
  if new.kind = 'carried' then return new; end if;
  select * into c from public.finance_agent_balance_entries where id = new.applies_to for update;
  if not found or c.kind <> 'carried' or c.voided_at is not null or c.agent_user_id <> new.agent_user_id or c.agency_id <> new.agency_id then
    raise exception 'That isn''t an open carried amount of this agent.' using errcode = '22023';
  end if;
  select coalesce(sum(amount_cents), 0) into used from public.finance_agent_balance_entries
   where applies_to = c.id and voided_at is null and kind in ('recovered', 'written_off');
  if used + new.amount_cents > -c.amount_cents then
    raise exception 'Only % is left of that carried amount.', to_char((-c.amount_cents - used) / 100.0, 'FM999,999,999,990.00') using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists finance_balance_entry_check on public.finance_agent_balance_entries;
create trigger finance_balance_entry_check before insert on public.finance_agent_balance_entries
  for each row execute function public.finance_balance_entry_check();

-- A paid commission can't be marked settled outside RenewalIQ afterwards.
create or replace function public.finance_paid_record_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.settlement is distinct from old.settlement and exists (select 1 from public.finance_payout_items i where i.transaction_id = old.id and i.active) then
    raise exception 'This commission is in a payout: it can''t be marked settled outside RenewalIQ.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists finance_paid_record_guard on public.commission_transactions;
create trigger finance_paid_record_guard before update of settlement on public.commission_transactions
  for each row execute function public.finance_paid_record_guard();

-- ───────────────────────────── access ─────────────────────────────

drop policy if exists finance_payout_runs_read on public.finance_payout_runs;
create policy finance_payout_runs_read on public.finance_payout_runs for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists finance_payouts_read on public.finance_payouts;
create policy finance_payouts_read on public.finance_payouts for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists finance_payout_items_read on public.finance_payout_items;
create policy finance_payout_items_read on public.finance_payout_items for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists finance_payout_adjustments_read on public.finance_payout_adjustments;
create policy finance_payout_adjustments_read on public.finance_payout_adjustments for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists finance_payout_holds_read on public.finance_payout_holds;
create policy finance_payout_holds_read on public.finance_payout_holds for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists finance_agent_balance_entries_read on public.finance_agent_balance_entries;
create policy finance_agent_balance_entries_read on public.finance_agent_balance_entries for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());

revoke all on public.finance_payout_runs, public.finance_payouts, public.finance_payout_items, public.finance_payout_adjustments,
  public.finance_payout_holds, public.finance_agent_balance_entries from public, anon, authenticated;
grant select on public.finance_payout_runs, public.finance_payouts, public.finance_payout_items, public.finance_payout_adjustments,
  public.finance_payout_holds, public.finance_agent_balance_entries to authenticated;

-- ───────────────────────────── how a run is worked out (internal) ─────────────────────────────

create or replace function public.finance_lock_run(p_run uuid) returns public.finance_payout_runs
language plpgsql security definer set search_path = ''
as $$
declare
  r public.finance_payout_runs;
begin
  select * into r from public.finance_payout_runs where id = p_run and agency_id = public.finance_require_admin() for update;
  if not found then raise exception 'That payout run doesn''t exist.' using errcode = 'P0002'; end if;
  return r;
end $$;

-- One agent's payouts are approved one at a time (both kinds), so their balance is used once.
create or replace function public.finance_lock_agent(p_agency uuid, p_agent uuid) returns void
language sql security definer set search_path = ''
as $$ select pg_advisory_xact_lock(hashtextextended('finance-agent:' || p_agency::text || ':' || p_agent::text, 0)) $$;

-- The agent's balance: what they owe from earlier payouts (0 or negative).
create or replace function public.finance_agent_balance(p_agency uuid, p_agent uuid) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.finance_agent_balance_entries
   where agency_id = p_agency and agent_user_id = p_agent and voided_at is null
$$;

-- What's left to recover of a carried amount (positive).
create or replace function public.finance_carried_left(p_entry uuid) returns bigint
language sql stable security definer set search_path = ''
as $$
  select (-c.amount_cents - coalesce((select sum(x.amount_cents) from public.finance_agent_balance_entries x
                                       where x.applies_to = c.id and x.voided_at is null and x.kind in ('recovered', 'written_off')), 0))::bigint
    from public.finance_agent_balance_entries c where c.id = p_entry and c.kind = 'carried' and c.voided_at is null
$$;

-- A payday for a run of this kind ending on this date (weekly: the first pay weekday after it).
create or replace function public.finance_run_pay_date(p_agency uuid, p_stream text, p_period_start date, p_period_end date) returns date
language plpgsql stable security definer set search_path = ''
as $$
declare
  wpay smallint := 5;
begin
  if p_stream = 'monthly' then return public.finance_pay_date(p_agency, 'monthly', p_period_start); end if;
  select s.weekly_pay_dow into wpay from public.finance_settings s where s.agency_id = p_agency;
  wpay := coalesce(wpay, 5);
  return p_period_end + 1 + ((wpay - extract(isodow from p_period_end + 1)::int + 7) % 7);
end $$;

-- Is this record payable in a run (ignoring holds)? Verified, open, current, with its agent and amount, no
-- blocking flag, of the run's kind, due by the run's payday, and not already in a payout.
create or replace function public.finance_payable_in(p_t public.commission_transactions, p_run public.finance_payout_runs) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_t.agency_id = p_run.agency_id and p_t.stream = p_run.stream
     and p_t.verification_status = 'verified' and p_t.settlement = 'open' and p_t.replaced_by is null
     and p_t.agent_user_id is not null and p_t.agent_cents is not null
     and cardinality(public.finance_blocking_flags(p_t.review_flags)) = 0
     and public.finance_pay_date(p_t.agency_id, p_t.stream, p_t.payable_from) <= p_run.pay_date
     and not exists (select 1 from public.finance_payout_items i where i.transaction_id = p_t.id and i.active)
$$;

-- The records a run pays (not held out of it).
create or replace function public.finance_run_records(p_run public.finance_payout_runs)
returns setof public.commission_transactions
language sql stable security definer set search_path = ''
as $$
  select t.* from public.commission_transactions t
   where t.agency_id = p_run.agency_id and t.stream = p_run.stream and t.verification_status = 'verified'
     and public.finance_payable_in(t, p_run)
     and not exists (select 1 from public.finance_payout_holds h where h.run_id = p_run.id and h.transaction_id = t.id and h.released_at is null)
$$;

-- One agent's payout in a run as it would be approved now.
create or replace function public.finance_run_line(p_run public.finance_payout_runs, p_agent uuid)
returns table (item_count integer, records_cents bigint, adjustments_cents bigint, line_cents bigint, balance_before_cents bigint,
               recovered_cents bigint, carried_cents bigint, pay_cents bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  n integer; rec bigint; adj bigint; line bigint; bal bigint; recov bigint;
begin
  select count(*), coalesce(sum(t.agent_cents), 0) into n, rec from public.finance_run_records(p_run) t where t.agent_user_id = p_agent;
  select coalesce(sum(a.amount_cents), 0) into adj from public.finance_payout_adjustments a where a.run_id = p_run.id and a.agent_user_id = p_agent and a.voided_at is null;
  line := rec + adj;
  bal := public.finance_agent_balance(p_run.agency_id, p_agent);
  recov := least(greatest(line, 0), -bal);
  return query select n, rec, adj, line, bal, recov, least(line, 0), greatest(line, 0) - recov;
end $$;

create or replace function public.finance_active_payout(p_run uuid, p_agent uuid) returns public.finance_payouts
language sql stable security definer set search_path = ''
as $$ select * from public.finance_payouts where run_id = p_run and agent_user_id = p_agent and status <> 'cancelled' $$;

create or replace function public.finance_agent_label(p_agency uuid, p_agent uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select coalesce(nullif(btrim(pr.display_name), ''), pr.email) from public.profiles pr where pr.user_id = p_agent and pr.agency_id = p_agency),
                  (select t.agent_name from public.commission_transactions t where t.agency_id = p_agency and t.agent_user_id = p_agent and t.agent_name is not null order by t.created_at desc limit 1),
                  'Agent')
$$;

-- A record as a payout screen shows it (agent commission only; no carrier figures).
create or replace function public.finance_payout_record_json(p_t public.commission_transactions, p_run public.finance_payout_runs, p_cents bigint default null)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'transactionId', p_t.id, 'kind', p_t.kind, 'origin', p_t.origin, 'clientName', p_t.client_name, 'submissionId', p_t.submission_id,
    'policyNumber', p_t.policy_number, 'carrierName', p_t.carrier_name, 'eventDate', p_t.event_date, 'payableFrom', p_t.payable_from,
    'ownPayDate', public.finance_pay_date(p_t.agency_id, p_t.stream, p_t.payable_from),
    'late', public.finance_pay_date(p_t.agency_id, p_t.stream, p_t.payable_from) < p_run.pay_date,
    'netCents', p_t.net_cents, 'agentRate', p_t.agent_rate, 'agentCents', coalesce(p_cents, p_t.agent_cents),
    'originalTransactionId', p_t.original_transaction_id,
    'originalPolicyNumber', (select o.policy_number from public.commission_transactions o where o.id = p_t.original_transaction_id))
$$;

revoke all on function public.finance_lock_run(uuid), public.finance_lock_agent(uuid, uuid), public.finance_agent_balance(uuid, uuid),
  public.finance_carried_left(uuid), public.finance_run_pay_date(uuid, text, date, date),
  public.finance_payable_in(public.commission_transactions, public.finance_payout_runs), public.finance_run_records(public.finance_payout_runs),
  public.finance_run_line(public.finance_payout_runs, uuid), public.finance_active_payout(uuid, uuid), public.finance_agent_label(uuid, uuid),
  public.finance_payout_record_json(public.commission_transactions, public.finance_payout_runs, bigint),
  public.finance_payout_runs_guard(), public.finance_payouts_guard(), public.finance_payout_items_guard(), public.finance_payout_notes_guard(),
  public.finance_balance_entry_check(), public.finance_paid_record_guard()
  from public, anon, authenticated;

-- ───────────────────────────── runs ─────────────────────────────

-- Starts the next run of a kind: right after the last one, or (the first time) the period containing
-- p_period_start, by default the last period that has ended. One open run of each kind at a time.
create or replace function public.create_payout_run(p_stream text, p_period_start date default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.finance_require_admin();
  last public.finance_payout_runs;
  wstart smallint := 1;
  d date;
  s date;
  e date;
  new_id uuid;
begin
  if p_stream not in ('weekly', 'monthly') then raise exception 'Choose weekly (policies) or monthly (endorsements).' using errcode = '22023'; end if;
  perform public.finance_ensure_settings(a);
  if exists (select 1 from public.finance_payout_runs where agency_id = a and stream = p_stream and closed_at is null) then
    raise exception 'Close the open % run first.', p_stream using errcode = '22023';
  end if;
  select * into last from public.finance_payout_runs where agency_id = a and stream = p_stream order by period_start desc limit 1;
  select st.weekly_period_start_dow into wstart from public.finance_settings st where st.agency_id = a;
  if last.id is not null then
    s := last.period_end + 1;
    if p_period_start is not null and p_period_start <> s then
      raise exception 'Runs follow one another: the next one starts %.', to_char(s, 'FMMon FMDD, YYYY') using errcode = '22023';
    end if;
  else
    if p_stream = 'weekly' then
      d := coalesce(p_period_start, current_date - 7);
      s := d - ((extract(isodow from d)::int - wstart + 7) % 7);
    else
      d := coalesce(p_period_start, (date_trunc('month', current_date) - interval '1 month')::date);
      s := date_trunc('month', d)::date;
    end if;
  end if;
  e := case when p_stream = 'weekly' then s + 6 else (date_trunc('month', s) + interval '1 month' - interval '1 day')::date end;
  if s > current_date then raise exception 'That period hasn''t started yet.' using errcode = '22023'; end if;
  insert into public.finance_payout_runs (agency_id, stream, period_start, period_end, pay_date, created_by)
  values (a, p_stream, s, e, public.finance_run_pay_date(a, p_stream, s, e), auth.uid())
  returning id into new_id;
  perform public.finance_audit(a, 'payout_run_created', 'payout_run', new_id::text, null,
    jsonb_build_object('stream', p_stream, 'periodStart', s, 'periodEnd', e));
  return new_id;
end $$;

-- Closes a run: what wasn't approved waits for the next run (say why). Adjustments must be approved or voided.
create or replace function public.close_payout_run(p_run uuid, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.finance_payout_runs := public.finance_lock_run(p_run);
  waiting integer;
begin
  if r.closed_at is not null then raise exception 'This run is already closed.' using errcode = '22023'; end if;
  if current_date <= r.period_end then raise exception 'The period isn''t over yet (it ends %).', to_char(r.period_end, 'FMMon FMDD') using errcode = '22023'; end if;
  if exists (select 1 from public.finance_payout_adjustments x where x.run_id = r.id and x.voided_at is null
              and (public.finance_active_payout(r.id, x.agent_user_id)).id is null) then
    raise exception 'Approve those agents'' payouts or void their adjustments first.' using errcode = '22023';
  end if;
  select count(distinct t.agent_user_id) into waiting from public.finance_run_records(r) t
   where (public.finance_active_payout(r.id, t.agent_user_id)).id is null;
  if waiting > 0 then
    perform public.finance_require_text(p_note, 'Some agents'' payouts aren''t approved: say why they wait for the next run.');
  end if;
  update public.finance_payout_runs set closed_at = now(), closed_by = auth.uid(), close_note = nullif(btrim(coalesce(p_note, '')), '') where id = r.id;
  perform public.finance_audit(r.agency_id, 'payout_run_closed', 'payout_run', r.id::text, p_note, jsonb_build_object('agentsWaiting', waiting));
end $$;

-- ───────────────────────────── approving and paying ─────────────────────────────

-- Approves one agent's payout in a run, as the admin saw it (the amount to pay and the number of records).
create or replace function public.approve_payout(p_run uuid, p_agent uuid, p_expected_pay_cents bigint, p_expected_items integer, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  r public.finance_payout_runs := public.finance_lock_run(p_run);
  l record;
  new_id uuid;
  inserted integer;
  left_cents bigint;
  take bigint;
  c record;
begin
  if r.closed_at is not null then raise exception 'This run is closed.' using errcode = '22023'; end if;
  if current_date <= r.period_end then raise exception 'The period isn''t over yet (it ends %).', to_char(r.period_end, 'FMMon FMDD') using errcode = '22023'; end if;
  if p_agent is null then raise exception 'Choose the agent.' using errcode = '22023'; end if;
  perform public.finance_lock_agent(r.agency_id, p_agent);
  if (public.finance_active_payout(r.id, p_agent)).id is not null then raise exception 'This agent''s payout is already approved.' using errcode = '22023'; end if;
  perform 1 from public.commission_transactions t where t.id in (select x.id from public.finance_run_records(r) x where x.agent_user_id = p_agent) for update;
  select * into l from public.finance_run_line(r, p_agent);
  if l.item_count = 0 and l.adjustments_cents = 0 then raise exception 'There''s nothing to approve for this agent in this run.' using errcode = '22023'; end if;
  if p_expected_pay_cents is distinct from l.pay_cents or p_expected_items is distinct from l.item_count then
    raise exception 'This payout changed since it was shown (now % records, % to pay): review it again.', l.item_count, to_char(l.pay_cents / 100.0, 'FM$999,999,999,990.00')
      using errcode = '40001';
  end if;
  insert into public.finance_payouts (agency_id, run_id, agent_user_id, agent_name, item_count, records_cents, adjustments_cents, line_cents,
                                      balance_before_cents, recovered_cents, carried_cents, pay_cents, approved_by, approve_note)
  values (r.agency_id, r.id, p_agent, public.finance_agent_label(r.agency_id, p_agent), l.item_count, l.records_cents, l.adjustments_cents, l.line_cents,
          l.balance_before_cents, l.recovered_cents, l.carried_cents, l.pay_cents, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into new_id;
  insert into public.finance_payout_items (agency_id, payout_id, transaction_id, agent_cents, late)
  select r.agency_id, new_id, t.id, t.agent_cents, public.finance_pay_date(t.agency_id, t.stream, t.payable_from) < r.pay_date
    from public.finance_run_records(r) t where t.agent_user_id = p_agent;
  get diagnostics inserted = row_count;
  if inserted <> l.item_count then raise exception 'The records changed while approving: review the payout again.' using errcode = '40001'; end if;
  if l.carried_cents < 0 then
    insert into public.finance_agent_balance_entries (agency_id, agent_user_id, kind, amount_cents, payout_id, created_by)
    values (r.agency_id, p_agent, 'carried', l.carried_cents, new_id, auth.uid());
  end if;
  -- Recover what the agent owes, oldest carried amount first.
  left_cents := l.recovered_cents;
  for c in select e.id from public.finance_agent_balance_entries e
            where e.agency_id = r.agency_id and e.agent_user_id = p_agent and e.kind = 'carried' and e.voided_at is null and e.payout_id <> new_id
            order by e.created_at, e.id loop
    exit when left_cents = 0;
    take := least(left_cents, public.finance_carried_left(c.id));
    if take > 0 then
      insert into public.finance_agent_balance_entries (agency_id, agent_user_id, kind, amount_cents, payout_id, applies_to, created_by)
      values (r.agency_id, p_agent, 'recovered', take, new_id, c.id, auth.uid());
      left_cents := left_cents - take;
    end if;
  end loop;
  if left_cents <> 0 then raise exception 'The agent''s balance changed while approving: review the payout again.' using errcode = '40001'; end if;
  perform public.finance_audit(r.agency_id, 'payout_approved', 'payout', new_id::text, p_note,
    jsonb_build_object('run', r.id, 'stream', r.stream, 'agent', p_agent, 'items', l.item_count, 'recordsCents', l.records_cents, 'adjustmentsCents', l.adjustments_cents,
                       'balanceBeforeCents', l.balance_before_cents, 'recoveredCents', l.recovered_cents, 'carriedCents', l.carried_cents, 'payCents', l.pay_cents));
  return new_id;
end $$;

-- "Approve all ready": the lines the admin saw, [{agent, payCents, items}]. Each is checked as above;
-- nothing unverified or flagged is in any of them.
create or replace function public.approve_payout_run(p_run uuid, p_lines jsonb, p_note text default null) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  x jsonb;
  n integer := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Choose the payouts to approve.' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_lines) loop
    perform public.approve_payout(p_run, (x ->> 'agent')::uuid, (x ->> 'payCents')::bigint, (x ->> 'items')::integer, p_note);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.finance_lock_payout(p_payout uuid) returns public.finance_payouts
language plpgsql security definer set search_path = ''
as $$
declare
  p public.finance_payouts;
begin
  select * into p from public.finance_payouts where id = p_payout and agency_id = public.finance_require_admin() for update;
  if not found then raise exception 'That payout doesn''t exist.' using errcode = 'P0002'; end if;
  return p;
end $$;
revoke all on function public.finance_lock_payout(uuid) from public, anon, authenticated;

-- Marks an approved payout paid, with the payment date (and a reference if there is one).
create or replace function public.mark_payout_paid(p_payout uuid, p_paid_on date, p_reference text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.finance_payouts := public.finance_lock_payout(p_payout);
  r public.finance_payout_runs;
begin
  select * into r from public.finance_payout_runs where id = p.run_id;
  if p.status <> 'approved' then raise exception 'Only an approved payout can be marked paid (this one is %).', p.status using errcode = '22023'; end if;
  if p.pay_cents = 0 then raise exception 'There''s nothing to pay on this payout: the agent''s balance is carried.' using errcode = '22023'; end if;
  if p_paid_on is null then raise exception 'Enter the date it was paid.' using errcode = '22023'; end if;
  if p_paid_on > current_date then raise exception 'The payment date can''t be in the future.' using errcode = '22023'; end if;
  if p_paid_on < r.period_start then raise exception 'The payment date is before the run''s period.' using errcode = '22023'; end if;
  if length(coalesce(p_reference, '')) > 200 then raise exception 'The reference is too long (200 characters at most).' using errcode = '22023'; end if;
  update public.finance_payouts set status = 'paid', paid_on = p_paid_on, paid_reference = nullif(btrim(coalesce(p_reference, '')), ''), paid_by = auth.uid(), paid_at = now()
   where id = p.id;
  perform public.finance_audit(p.agency_id, 'payout_paid', 'payout', p.id::text, null,
    jsonb_build_object('paidOn', p_paid_on, 'reference', nullif(btrim(coalesce(p_reference, '')), ''), 'payCents', p.pay_cents));
end $$;

-- Undoes an approval (before it's paid, while the run is open): its records are free again and its
-- balance entries are voided — unless a later payout already recovered part of what it carried.
create or replace function public.cancel_payout_approval(p_payout uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.finance_payouts := public.finance_lock_payout(p_payout);
  why text := public.finance_require_text(p_reason, 'Say why the approval is undone.');
  r public.finance_payout_runs;
begin
  select * into r from public.finance_payout_runs where id = p.run_id for update;
  if p.status <> 'approved' then
    raise exception 'A paid payout can''t be undone: add a correction or an adjustment in a later run.' using errcode = '22023';
  end if;
  if r.closed_at is not null then raise exception 'The run is closed: add an adjustment in a later run instead.' using errcode = '22023'; end if;
  perform public.finance_lock_agent(p.agency_id, p.agent_user_id);
  if exists (select 1 from public.finance_agent_balance_entries c join public.finance_agent_balance_entries x on x.applies_to = c.id and x.voided_at is null
              where c.payout_id = p.id and c.kind = 'carried' and c.voided_at is null) then
    raise exception 'Part of what this payout carried was already recovered or written off: undo that first.' using errcode = '22023';
  end if;
  update public.finance_payouts set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = why where id = p.id;
  update public.finance_payout_items set active = false where payout_id = p.id and active;
  update public.finance_agent_balance_entries set voided_at = now(), voided_by = auth.uid(), void_reason = 'Payout approval undone: ' || why
   where payout_id = p.id and voided_at is null;
  perform public.finance_audit(p.agency_id, 'payout_approval_undone', 'payout', p.id::text, why, jsonb_build_object('run', p.run_id, 'payCents', p.pay_cents));
end $$;

-- ───────────────────────────── adjustments, holds, write-offs ─────────────────────────────

create or replace function public.add_payout_adjustment(p_run uuid, p_agent uuid, p_amount_cents bigint, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_variable
declare
  r public.finance_payout_runs := public.finance_lock_run(p_run);
  reason text := public.finance_require_text(p_reason, 'Say why the payout is adjusted.');
  new_id uuid;
begin
  if r.closed_at is not null then raise exception 'This run is closed.' using errcode = '22023'; end if;
  if p_amount_cents is null or p_amount_cents = 0 or abs(p_amount_cents) >= 100000000000 then raise exception 'Enter the adjustment (+ or −).' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles pr where pr.user_id = p_agent and pr.agency_id = r.agency_id)
     and not exists (select 1 from public.commission_transactions t where t.agency_id = r.agency_id and t.agent_user_id = p_agent) then
    raise exception 'Choose an agent of your agency.' using errcode = '22023';
  end if;
  if (public.finance_active_payout(r.id, p_agent)).id is not null then raise exception 'This agent''s payout is already approved: undo the approval first.' using errcode = '22023'; end if;
  insert into public.finance_payout_adjustments (agency_id, run_id, agent_user_id, amount_cents, reason, created_by)
  values (r.agency_id, r.id, p_agent, p_amount_cents, reason, auth.uid()) returning id into new_id;
  perform public.finance_audit(r.agency_id, 'payout_adjustment', 'payout_run', r.id::text, reason, jsonb_build_object('adjustment', new_id, 'agent', p_agent, 'amountCents', p_amount_cents));
  return new_id;
end $$;

create or replace function public.void_payout_adjustment(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_variable
declare
  a uuid := public.finance_require_admin();
  reason text := public.finance_require_text(p_reason, 'Say why the adjustment is voided.');
  x public.finance_payout_adjustments;
  r public.finance_payout_runs;
begin
  select * into x from public.finance_payout_adjustments where id = p_id and agency_id = a and voided_at is null for update;
  if not found then raise exception 'That adjustment doesn''t exist or is already voided.' using errcode = 'P0002'; end if;
  r := public.finance_lock_run(x.run_id);
  if r.closed_at is not null then raise exception 'This run is closed.' using errcode = '22023'; end if;
  if (public.finance_active_payout(r.id, x.agent_user_id)).id is not null then raise exception 'This agent''s payout is already approved: undo the approval first.' using errcode = '22023'; end if;
  update public.finance_payout_adjustments set voided_at = now(), voided_by = auth.uid(), void_reason = reason where id = x.id;
  perform public.finance_audit(a, 'payout_adjustment_voided', 'payout_run', r.id::text, reason, jsonb_build_object('adjustment', x.id, 'amountCents', x.amount_cents));
end $$;

-- Holds a record out of this run (it stays verified and is due again in the next run). Never a negative one.
create or replace function public.hold_payout_record(p_run uuid, p_transaction_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_variable
declare
  r public.finance_payout_runs := public.finance_lock_run(p_run);
  reason text := public.finance_require_text(p_reason, 'Say why it''s held.');
  t public.commission_transactions;
  new_id uuid;
begin
  if r.closed_at is not null then raise exception 'This run is closed.' using errcode = '22023'; end if;
  select * into t from public.commission_transactions where id = p_transaction_id and agency_id = r.agency_id for update;
  if not found or not public.finance_payable_in(t, r) then raise exception 'Only a record payable in this run can be held.' using errcode = '22023'; end if;
  -- What an agent owes always counts: a cancellation or correction that reduces a payout isn't held.
  if t.agent_cents < 0 then raise exception 'A cancellation or correction that reduces the payout can''t be held: it always counts.' using errcode = '22023'; end if;
  if (public.finance_active_payout(r.id, t.agent_user_id)).id is not null then raise exception 'This agent''s payout is already approved: undo the approval first.' using errcode = '22023'; end if;
  insert into public.finance_payout_holds (agency_id, run_id, transaction_id, reason, created_by) values (r.agency_id, r.id, t.id, reason, auth.uid())
  on conflict (run_id, transaction_id) where released_at is null do nothing
  returning id into new_id;
  if new_id is null then raise exception 'It''s already held.' using errcode = '22023'; end if;
  perform public.finance_audit(r.agency_id, 'payout_record_held', 'transaction', t.id::text, reason, jsonb_build_object('run', r.id));
  return new_id;
end $$;

create or replace function public.release_payout_hold(p_hold uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_variable
declare
  a uuid := public.finance_require_admin();
  reason text := public.finance_require_text(p_reason, 'Say why it''s released.');
  h public.finance_payout_holds;
  r public.finance_payout_runs;
  agent uuid;
begin
  select * into h from public.finance_payout_holds where id = p_hold and agency_id = a and released_at is null for update;
  if not found then raise exception 'That hold doesn''t exist or is already released.' using errcode = 'P0002'; end if;
  r := public.finance_lock_run(h.run_id);
  if r.closed_at is not null then raise exception 'This run is closed: the record is due in the next run anyway.' using errcode = '22023'; end if;
  select agent_user_id into agent from public.commission_transactions where id = h.transaction_id;
  if (public.finance_active_payout(r.id, agent)).id is not null then raise exception 'This agent''s payout is already approved: undo the approval first.' using errcode = '22023'; end if;
  update public.finance_payout_holds set released_at = now(), released_by = auth.uid(), release_reason = reason where id = h.id;
  perform public.finance_audit(a, 'payout_hold_released', 'transaction', h.transaction_id::text, reason, jsonb_build_object('run', r.id));
end $$;

-- Writes off (part of) a carried amount: the agency absorbs it, with the reason. Never more than is left.
create or replace function public.write_off_agent_balance(p_carried uuid, p_amount_cents bigint, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_variable
declare
  a uuid := public.finance_require_admin();
  reason text := public.finance_require_text(p_reason, 'Say why the balance is written off.');
  c public.finance_agent_balance_entries;
  remaining bigint;
  new_id uuid;
begin
  select * into c from public.finance_agent_balance_entries where id = p_carried and agency_id = a and kind = 'carried' and voided_at is null;
  if not found then raise exception 'That carried amount doesn''t exist.' using errcode = 'P0002'; end if;
  perform public.finance_lock_agent(a, c.agent_user_id);
  remaining := public.finance_carried_left(c.id);
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Enter the amount to write off.' using errcode = '22023'; end if;
  if p_amount_cents > remaining then
    raise exception 'Only % is left of that carried amount.', to_char(remaining / 100.0, 'FM999,999,999,990.00') using errcode = '22023';
  end if;
  insert into public.finance_agent_balance_entries (agency_id, agent_user_id, kind, amount_cents, applies_to, reason, created_by)
  values (a, c.agent_user_id, 'written_off', p_amount_cents, c.id, reason, auth.uid()) returning id into new_id;
  perform public.finance_audit(a, 'balance_written_off', 'balance', c.id::text, reason,
    jsonb_build_object('agent', c.agent_user_id, 'amountCents', p_amount_cents, 'leftCents', remaining - p_amount_cents));
  return new_id;
end $$;

-- ───────────────────────────── what admins see ─────────────────────────────

-- A run as the payout screen shows it: each agent's payout (approved or paid as approved; otherwise as it
-- would be approved now), and the records due in it that can't be paid yet, with why.
create or replace function public.payout_run_details(p_run uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  a uuid := public.finance_require_admin();
  r public.finance_payout_runs;
  lines jsonb := '[]'::jsonb;
  waiting jsonb;
  ag uuid;
  p public.finance_payouts;
  l record;
begin
  select * into r from public.finance_payout_runs where id = p_run and agency_id = a;
  if not found then raise exception 'That payout run doesn''t exist.' using errcode = 'P0002'; end if;
  for ag in
    select x.agent from (
      select t.agent_user_id as agent from public.finance_run_records(r) t
      union select x.agent_user_id from public.finance_payout_adjustments x where x.run_id = r.id and x.voided_at is null
      union select x.agent_user_id from public.finance_payouts x where x.run_id = r.id and x.status <> 'cancelled') x
    order by public.finance_agent_label(a, x.agent)
  loop
    p := public.finance_active_payout(r.id, ag);
    if p.id is not null then
      lines := lines || jsonb_build_object(
        'agent', ag, 'agentName', p.agent_name, 'status', p.status, 'payoutId', p.id, 'itemCount', p.item_count,
        'recordsCents', p.records_cents, 'adjustmentsCents', p.adjustments_cents, 'lineCents', p.line_cents, 'balanceBeforeCents', p.balance_before_cents,
        'recoveredCents', p.recovered_cents, 'carriedCents', p.carried_cents, 'payCents', p.pay_cents,
        'approvedAt', p.approved_at, 'approveNote', p.approve_note, 'paidOn', p.paid_on, 'paidReference', p.paid_reference,
        'items', coalesce((select jsonb_agg(public.finance_payout_record_json(t, r, i.agent_cents) order by t.event_date, t.created_at)
                             from public.finance_payout_items i join public.commission_transactions t on t.id = i.transaction_id where i.payout_id = p.id and i.active), '[]'::jsonb),
        'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'amountCents', x.amount_cents, 'reason', x.reason, 'createdAt', x.created_at) order by x.created_at)
                                   from public.finance_payout_adjustments x where x.run_id = r.id and x.agent_user_id = ag and x.voided_at is null), '[]'::jsonb));
    else
      select * into l from public.finance_run_line(r, ag);
      lines := lines || jsonb_build_object(
        'agent', ag, 'agentName', public.finance_agent_label(a, ag), 'status', 'draft', 'payoutId', null, 'itemCount', l.item_count,
        'recordsCents', l.records_cents, 'adjustmentsCents', l.adjustments_cents, 'lineCents', l.line_cents, 'balanceBeforeCents', l.balance_before_cents,
        'recoveredCents', l.recovered_cents, 'carriedCents', l.carried_cents, 'payCents', l.pay_cents,
        'items', coalesce((select jsonb_agg(public.finance_payout_record_json(t, r) order by t.event_date, t.created_at)
                             from public.finance_run_records(r) t where t.agent_user_id = ag), '[]'::jsonb),
        'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'amountCents', x.amount_cents, 'reason', x.reason, 'createdAt', x.created_at) order by x.created_at)
                                   from public.finance_payout_adjustments x where x.run_id = r.id and x.agent_user_id = ag and x.voided_at is null), '[]'::jsonb));
    end if;
  end loop;
  -- Due by this payday but not payable yet (or held out of this run).
  select coalesce(jsonb_agg(w order by w ->> 'eventDate', w ->> 'clientName'), '[]'::jsonb) into waiting from (
    select public.finance_payout_record_json(t, r) || jsonb_build_object(
             'agent', t.agent_user_id, 'agentName', coalesce(t.agent_name, 'No agent'), 'status', public.finance_status(t),
             'flags', to_jsonb(public.finance_blocking_flags(t.review_flags)),
             'holdId', h.id, 'holdReason', h.reason) as w
      from public.commission_transactions t
      left join public.finance_payout_holds h on h.run_id = r.id and h.transaction_id = t.id and h.released_at is null
     where t.agency_id = a and t.stream = r.stream and t.replaced_by is null and t.verification_status <> 'void' and t.settlement = 'open'
       and public.finance_pay_date(t.agency_id, t.stream, t.payable_from) <= r.pay_date
       and not exists (select 1 from public.finance_payout_items i where i.transaction_id = t.id and i.active)
       and (h.id is not null or not public.finance_payable_in(t, r))) s;
  return jsonb_build_object(
    'run', jsonb_build_object('id', r.id, 'stream', r.stream, 'periodStart', r.period_start, 'periodEnd', r.period_end, 'payDate', r.pay_date,
                              'closedAt', r.closed_at, 'closeNote', r.close_note, 'periodOver', current_date > r.period_end),
    'lines', lines, 'waiting', waiting);
end $$;

-- ───────────────────────────── what agents see ─────────────────────────────

-- The signed-in agent's approved and paid payouts.
create or replace function public.my_payouts()
returns table (id uuid, stream text, period_start date, period_end date, pay_date date, status text, item_count integer, records_cents bigint,
               adjustments_cents bigint, balance_before_cents bigint, recovered_cents bigint, carried_cents bigint, pay_cents bigint, approved_at timestamptz, paid_on date)
language sql stable security definer set search_path = ''
as $$
  select p.id, r.stream, r.period_start, r.period_end, r.pay_date, p.status, p.item_count, p.records_cents, p.adjustments_cents, p.balance_before_cents,
         p.recovered_cents, p.carried_cents, p.pay_cents, p.approved_at, p.paid_on
    from public.finance_payouts p join public.finance_payout_runs r on r.id = p.run_id
   where auth.uid() is not null and p.agency_id = public.current_agency_id() and p.agent_user_id = auth.uid() and p.status <> 'cancelled'
   order by r.pay_date desc, r.stream
$$;

-- The records and adjustments in one of the signed-in agent's payouts (agent commission only).
create or replace function public.my_payout_lines(p_payout uuid)
returns table (line_type text, kind text, client_name text, policy_number text, event_date date, net_cents bigint, agent_rate numeric, agent_cents bigint, late boolean, reason text)
language sql stable security definer set search_path = ''
as $$
  with p as (select * from public.finance_payouts x
              where x.id = p_payout and auth.uid() is not null and x.agency_id = public.current_agency_id() and x.agent_user_id = auth.uid() and x.status <> 'cancelled')
  select 'record', t.kind, t.client_name, t.policy_number, t.event_date, t.net_cents, t.agent_rate, i.agent_cents, i.late, null::text
    from p join public.finance_payout_items i on i.payout_id = p.id and i.active join public.commission_transactions t on t.id = i.transaction_id
  union all
  select 'adjustment', null, null, null, null, null, null, a.amount_cents, false, a.reason
    from p join public.finance_payout_adjustments a on a.run_id = p.run_id and a.agent_user_id = p.agent_user_id and a.voided_at is null
$$;

-- The signed-in agent's commission balance: each carried amount (from which payout), and what was
-- recovered or written off against it.
create or replace function public.my_commission_balance()
returns table (id uuid, kind text, amount_cents bigint, created_at timestamptz, applies_to uuid, reason text, payout_id uuid, stream text,
               period_start date, period_end date, pay_date date, left_cents bigint)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.kind, e.amount_cents, e.created_at, e.applies_to, e.reason, e.payout_id, r.stream, r.period_start, r.period_end, r.pay_date,
         case when e.kind = 'carried' then public.finance_carried_left(e.id) end
    from public.finance_agent_balance_entries e
    left join public.finance_payouts p on p.id = e.payout_id
    left join public.finance_payout_runs r on r.id = p.run_id
   where auth.uid() is not null and e.agency_id = public.current_agency_id() and e.agent_user_id = auth.uid() and e.voided_at is null
   order by e.created_at, e.id
$$;

revoke all on function public.create_payout_run(text, date), public.close_payout_run(uuid, text),
  public.approve_payout(uuid, uuid, bigint, integer, text), public.approve_payout_run(uuid, jsonb, text),
  public.mark_payout_paid(uuid, date, text), public.cancel_payout_approval(uuid, text),
  public.add_payout_adjustment(uuid, uuid, bigint, text), public.void_payout_adjustment(uuid, text),
  public.hold_payout_record(uuid, uuid, text), public.release_payout_hold(uuid, text), public.write_off_agent_balance(uuid, bigint, text),
  public.payout_run_details(uuid), public.my_payouts(), public.my_payout_lines(uuid), public.my_commission_balance()
  from public, anon;
grant execute on function public.create_payout_run(text, date), public.close_payout_run(uuid, text),
  public.approve_payout(uuid, uuid, bigint, integer, text), public.approve_payout_run(uuid, jsonb, text),
  public.mark_payout_paid(uuid, date, text), public.cancel_payout_approval(uuid, text),
  public.add_payout_adjustment(uuid, uuid, bigint, text), public.void_payout_adjustment(uuid, text),
  public.hold_payout_record(uuid, uuid, text), public.release_payout_hold(uuid, text), public.write_off_agent_balance(uuid, bigint, text),
  public.payout_run_details(uuid), public.my_payouts(), public.my_payout_lines(uuid), public.my_commission_balance()
  to authenticated;

notify pgrst, 'reload schema';
