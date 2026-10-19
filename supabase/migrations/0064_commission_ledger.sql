-- 0064 Commission records (needs 0058 agent commission % and 0063 carrier rates).
--
-- Every policy and endorsement recorded on an account gets one commission record, written by the
-- database when the account is saved (so any version of the app is covered). The record freezes, at that
-- moment: the agent (the account's assigned agent), the agent's split, the carrier's rate in force on the
-- bound / endorsed date (0063; 10% where none is set), the net premium, the carrier commission (net ×
-- carrier %) and the agent commission (net × 10% × agent split). Later changes to rates, splits, the
-- assigned agent or the account never change a record: a correction or a cancellation is a separate
-- record linked to the original. Nothing is ever deleted.
--
-- Commission is payable from the bound / endorsed date (weekly for policies: Monday–Sunday, paid the
-- following Friday; monthly for endorsements), never depending on whether the carrier has paid the agency
-- (carrier receipts are tracked separately). An admin must verify each record first: "Missing Proof" until
-- the policy has a document, then "Pending Verification", then "Verified". An admin may verify without
-- proof only as an exception, with a reason that stays in the audit. Payouts themselves come in 0065.
--
-- Policies and endorsements that already exist when 0064 is applied are historical: they are only noted
-- here (ids, no amounts), and become records only when an admin runs the historical backfill — as
-- "Historical – needs review", never verified with today's rates and never payable until an admin
-- confirms the agent, split and carrier rate (with evidence), or marks them settled outside RenewalIQ.
--
-- Who can do what: the agency's admins read everything and do every action, through the functions below
-- only (no direct writes). Agents read only their own commissions — never carrier rates or carrier
-- commission — and can request a cancellation on an account they work on. Every action is in
-- finance_audit_log (append-only). Re-runnable.

-- ───────────────────────────── settings ─────────────────────────────

create table if not exists public.finance_settings (
  agency_id uuid primary key references public.agencies (id),
  -- When this agency's records started; policies created before it are flagged if recorded later.
  ledger_started_at timestamptz not null default now(),
  -- Weekly policy payouts: periods start on this ISO weekday (1 = Monday) and are paid on the first
  -- pay weekday (5 = Friday) after the period ends — so a Friday binding is paid the following Friday.
  weekly_period_start_dow smallint not null default 1 check (weekly_period_start_dow between 1 and 7),
  weekly_pay_dow smallint not null default 5 check (weekly_pay_dow between 1 and 7),
  -- Monthly endorsement payouts, for the endorsements dated in a calendar month: the first
  -- monthly_pay_dow of the next month, or day monthly_pay_day of the next month.
  monthly_pay_rule text not null default 'first_weekday' check (monthly_pay_rule in ('first_weekday', 'day_of_month')),
  monthly_pay_dow smallint not null default 5 check (monthly_pay_dow between 1 and 7),
  monthly_pay_day smallint check (monthly_pay_day between 1 and 28),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint finance_settings_monthly_day check (monthly_pay_rule <> 'day_of_month' or monthly_pay_day is not null)
);
alter table public.finance_settings enable row level security;

-- When 0064 was first applied (once): what existed before it is historical.
create table if not exists public.finance_ledger_install (
  id boolean primary key default true check (id),
  installed_at timestamptz not null default now()
);
alter table public.finance_ledger_install enable row level security;

-- Policies and endorsements that existed before records began (ids only, no amounts).
create table if not exists public.finance_historical_entries (
  agency_id uuid not null references public.agencies (id),
  submission_id text not null,
  policy_id text not null,
  noted_at timestamptz not null default now(),
  backfilled_at timestamptz,
  primary key (submission_id, policy_id)
);
alter table public.finance_historical_entries enable row level security;

-- ───────────────────────────── records ─────────────────────────────

create table if not exists public.commission_transactions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id),
  -- The account (kept even if the account is later deleted) and the policy / endorsement on it.
  submission_id text not null,
  client_name text not null default '',
  quote_id text,
  policy_id text,
  kind text not null check (kind in ('policy', 'endorsement', 'cancellation', 'correction')),
  -- weekly = policies (and their cancellations / corrections); monthly = endorsements (and theirs).
  stream text not null check (stream in ('weekly', 'monthly')),
  origin text not null check (origin in ('recorded', 'historical', 'admin')),
  -- endorsement → its policy; cancellation → the policy; correction → the corrected record.
  original_transaction_id uuid references public.commission_transactions (id),
  cancellation_id uuid,
  -- Set when an unverified record was voided and recorded again (the new record's id).
  replaced_by uuid,
  policy_number text,
  carrier_name text not null,
  carrier_key text not null,
  business_type text,
  -- Bound / endorsed date (a cancellation's effective date; a correction's date).
  event_date date not null,
  -- From when it can be paid: the event date, or the approval date of a cancellation / correction.
  payable_from date not null,
  net_cents bigint not null,
  -- Frozen when recorded.
  base_rate numeric(7, 6) not null default 0.100000,
  agent_user_id uuid,
  agent_name text,
  agent_rate numeric(7, 6) check (agent_rate >= 0 and agent_rate <= 1),
  agent_cents bigint,
  carrier_rate numeric(7, 6) not null check (carrier_rate >= 0 and carrier_rate <= 1),
  carrier_rate_id bigint,
  carrier_rate_source text not null check (carrier_rate_source in ('carrier_rate', 'default', 'historical', 'confirmed', 'actual')),
  carrier_cents bigint not null,
  -- The policy / endorsement as recorded, and the account details an admin accepted later.
  recorded_snapshot jsonb not null default '{}'::jsonb,
  acknowledged_snapshot jsonb,
  -- Policy proof (documents on the policy) — separate from the commission-rate evidence below.
  proof_status text not null default 'missing_proof' check (proof_status in ('missing_proof', 'has_proof')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'void')),
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  verified_without_proof boolean not null default false,
  verification_reason text check (length(verification_reason) <= 1000),
  -- Commission-rate evidence (historical records): who confirmed the rates, and on what basis.
  rate_evidence text check (length(rate_evidence) <= 1000),
  rate_confirmed_by uuid references auth.users (id) on delete set null,
  rate_confirmed_at timestamptz,
  void_reason text check (length(void_reason) <= 1000),
  voided_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  settlement text not null default 'open' check (settlement in ('open', 'settled_outside')),
  settled_by uuid references auth.users (id) on delete set null,
  settled_at timestamptz,
  settled_reason text check (length(settled_reason) <= 1000),
  review_flags text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_transactions_without_proof check (not verified_without_proof or length(btrim(coalesce(verification_reason, ''))) > 0),
  constraint commission_transactions_verified check ((verification_status = 'verified') = (verified_at is not null)),
  constraint commission_transactions_void check ((verification_status = 'void') = (voided_at is not null and length(btrim(coalesce(void_reason, ''))) > 0)),
  constraint commission_transactions_settled check ((settlement = 'settled_outside') = (settled_at is not null and length(btrim(coalesce(settled_reason, ''))) > 0)),
  constraint commission_transactions_entry check ((kind in ('policy', 'endorsement')) = (policy_id is not null)),
  constraint commission_transactions_link check (kind in ('policy', 'endorsement') or original_transaction_id is not null)
);
-- One current record per policy / endorsement: the same commission can't be recorded twice.
create unique index if not exists commission_transactions_one_per_entry on public.commission_transactions (agency_id, submission_id, policy_id) where policy_id is not null and replaced_by is null;
create unique index if not exists commission_transactions_one_per_cancellation on public.commission_transactions (cancellation_id) where cancellation_id is not null;
create index if not exists commission_transactions_agent on public.commission_transactions (agency_id, agent_user_id);
create index if not exists commission_transactions_status on public.commission_transactions (agency_id, verification_status, settlement);
create index if not exists commission_transactions_original on public.commission_transactions (original_transaction_id);
create index if not exists commission_transactions_submission on public.commission_transactions (submission_id);
alter table public.commission_transactions enable row level security;

create table if not exists public.commission_cancellations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id),
  transaction_id uuid not null references public.commission_transactions (id),
  submission_id text not null,
  cancel_type text not null check (cancel_type in ('full', 'partial')),
  effective_date date not null,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  expected_refund_cents bigint check (expected_refund_cents > 0),
  document_ids text[] not null default '{}',
  status text not null default 'requested' check (status in ('requested', 'awaiting_amount', 'approved', 'rejected', 'withdrawn')),
  requested_by uuid not null references auth.users (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 1000),
  returned_net_cents bigint check (returned_net_cents > 0),
  carrier_adjustment_cents bigint check (carrier_adjustment_cents >= 0),
  result_transaction_id uuid references public.commission_transactions (id),
  updated_at timestamptz not null default now(),
  constraint commission_cancellations_approved check ((status = 'approved') = (result_transaction_id is not null and returned_net_cents is not null and carrier_adjustment_cents is not null))
);
-- One open request per policy at a time.
create unique index if not exists commission_cancellations_one_open on public.commission_cancellations (transaction_id) where status in ('requested', 'awaiting_amount');
alter table public.commission_cancellations enable row level security;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'commission_transactions_cancellation_fk') then
    alter table public.commission_transactions add constraint commission_transactions_cancellation_fk foreign key (cancellation_id) references public.commission_cancellations (id);
  end if;
end $$;

-- What the carrier actually paid the agency on a record. Tracked only — it never affects agent payouts.
create table if not exists public.commission_carrier_receipts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id),
  transaction_id uuid not null references public.commission_transactions (id),
  amount_cents bigint not null check (amount_cents <> 0),
  received_date date not null,
  reference text check (length(reference) <= 200),
  note text check (length(note) <= 1000),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text check (length(void_reason) <= 1000),
  constraint commission_carrier_receipts_void check ((voided_at is null) = (void_reason is null))
);
create index if not exists commission_carrier_receipts_transaction on public.commission_carrier_receipts (transaction_id);
alter table public.commission_carrier_receipts enable row level security;

-- Every action, with who, when, what changed and why. Append-only.
create table if not exists public.finance_audit_log (
  id bigint generated always as identity primary key,
  agency_id uuid,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  reason text,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists finance_audit_log_entity on public.finance_audit_log (agency_id, entity, entity_id);
alter table public.finance_audit_log enable row level security;

-- ───────────────────────────── guards ─────────────────────────────

create or replace function public.finance_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'This history can''t be changed or deleted.' using errcode = '42501';
end $$;
drop trigger if exists finance_audit_log_append_only on public.finance_audit_log;
create trigger finance_audit_log_append_only before update or delete on public.finance_audit_log
  for each row execute function public.finance_append_only();

create or replace function public.commission_transactions_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  op text := coalesce(current_setting('renewaliq.finance_op', true), '');
begin
  if tg_op = 'DELETE' then
    raise exception 'Commission records are kept: void or correct them instead of deleting.' using errcode = '42501';
  end if;
  if (new.id, new.agency_id, new.submission_id, new.client_name, new.quote_id, new.policy_id, new.kind, new.stream, new.origin, new.cancellation_id,
      new.policy_number, new.carrier_name, new.carrier_key, new.business_type, new.event_date, new.payable_from, new.net_cents, new.base_rate,
      new.recorded_snapshot, new.created_by, new.created_at)
     is distinct from
     (old.id, old.agency_id, old.submission_id, old.client_name, old.quote_id, old.policy_id, old.kind, old.stream, old.origin, old.cancellation_id,
      old.policy_number, old.carrier_name, old.carrier_key, old.business_type, old.event_date, old.payable_from, old.net_cents, old.base_rate,
      old.recorded_snapshot, old.created_by, old.created_at) then
    raise exception 'A commission record''s policy, date and amounts can''t be changed: add a correction instead.' using errcode = '42501';
  end if;
  if (new.agent_user_id, new.agent_name, new.agent_rate, new.agent_cents, new.carrier_rate, new.carrier_rate_id, new.carrier_rate_source, new.carrier_cents)
     is distinct from (old.agent_user_id, old.agent_name, old.agent_rate, old.agent_cents, old.carrier_rate, old.carrier_rate_id, old.carrier_rate_source, old.carrier_cents)
     and not (op = 'confirm_historical' and old.origin = 'historical' and old.verification_status = 'unverified' and old.settlement = 'open' and old.rate_confirmed_at is null)
     and not (op = 'resolve_agent' and old.verification_status = 'unverified' and old.settlement = 'open' and (old.agent_user_id is null or old.agent_rate is null)
              and (old.agent_user_id is null or new.agent_user_id = old.agent_user_id)
              and (new.carrier_rate, new.carrier_rate_id, new.carrier_rate_source, new.carrier_cents) is not distinct from (old.carrier_rate, old.carrier_rate_id, old.carrier_rate_source, old.carrier_cents)) then
    raise exception 'The agent, split, rates and amounts are frozen when a commission is recorded.' using errcode = '42501';
  end if;
  if new.original_transaction_id is distinct from old.original_transaction_id
     and not (old.kind = 'endorsement' and old.verification_status = 'unverified'
              and (old.original_transaction_id is null
                   or exists (select 1 from public.commission_transactions x where x.id = old.original_transaction_id and x.verification_status = 'void'))) then
    raise exception 'A commission record''s link can''t be changed.' using errcode = '42501';
  end if;
  if new.replaced_by is distinct from old.replaced_by and not ((old.replaced_by is null or old.replaced_by = old.id) and new.verification_status = 'void') then
    raise exception 'Only a voided record can be replaced, once.' using errcode = '42501';
  end if;
  if new.verification_status is distinct from old.verification_status and old.verification_status <> 'unverified' then
    raise exception 'A verified or voided commission keeps its status: add a correction or a cancellation.' using errcode = '42501';
  end if;
  if old.verification_status <> 'unverified'
     and (new.verified_by, new.verified_at, new.verified_without_proof, new.verification_reason, new.void_reason, new.voided_by, new.voided_at)
         is distinct from (old.verified_by, old.verified_at, old.verified_without_proof, old.verification_reason, old.void_reason, old.voided_by, old.voided_at) then
    raise exception 'A verification or void can''t be changed.' using errcode = '42501';
  end if;
  if new.settlement is distinct from old.settlement and not (old.settlement = 'open' and new.settlement = 'settled_outside') then
    raise exception 'A commission settled outside RenewalIQ stays settled.' using errcode = '42501';
  end if;
  if old.settlement <> 'open' and (new.settled_by, new.settled_at, new.settled_reason) is distinct from (old.settled_by, old.settled_at, old.settled_reason) then
    raise exception 'A settlement can''t be changed.' using errcode = '42501';
  end if;
  if old.rate_confirmed_at is not null and (new.rate_evidence, new.rate_confirmed_by, new.rate_confirmed_at) is distinct from (old.rate_evidence, old.rate_confirmed_by, old.rate_confirmed_at) then
    raise exception 'Confirmed rates can''t be changed.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists commission_transactions_guard on public.commission_transactions;
create trigger commission_transactions_guard before update or delete on public.commission_transactions
  for each row execute function public.commission_transactions_guard();

create or replace function public.commission_cancellations_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Cancellation requests are kept.' using errcode = '42501'; end if;
  if old.status in ('approved', 'rejected', 'withdrawn') then raise exception 'A decided cancellation request can''t be changed.' using errcode = '42501'; end if;
  if (new.id, new.agency_id, new.transaction_id, new.submission_id, new.cancel_type, new.effective_date, new.reason, new.expected_refund_cents, new.document_ids, new.requested_by, new.requested_at)
     is distinct from (old.id, old.agency_id, old.transaction_id, old.submission_id, old.cancel_type, old.effective_date, old.reason, old.expected_refund_cents, old.document_ids, old.requested_by, old.requested_at) then
    raise exception 'A cancellation request can''t be edited: withdraw it and request again.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists commission_cancellations_guard on public.commission_cancellations;
create trigger commission_cancellations_guard before update or delete on public.commission_cancellations
  for each row execute function public.commission_cancellations_guard();

create or replace function public.commission_carrier_receipts_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Carrier receipts are kept: void one entered by mistake.' using errcode = '42501'; end if;
  if old.voided_at is not null
     or (new.id, new.agency_id, new.transaction_id, new.amount_cents, new.received_date, new.reference, new.note, new.recorded_by, new.recorded_at)
        is distinct from (old.id, old.agency_id, old.transaction_id, old.amount_cents, old.received_date, old.reference, old.note, old.recorded_by, old.recorded_at) then
    raise exception 'A carrier receipt can''t be changed: void it and record it again.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists commission_carrier_receipts_guard on public.commission_carrier_receipts;
create trigger commission_carrier_receipts_guard before update or delete on public.commission_carrier_receipts
  for each row execute function public.commission_carrier_receipts_guard();

-- ───────────────────────────── access ─────────────────────────────

drop policy if exists finance_settings_read on public.finance_settings;
create policy finance_settings_read on public.finance_settings for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists commission_transactions_read on public.commission_transactions;
create policy commission_transactions_read on public.commission_transactions for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists commission_cancellations_read on public.commission_cancellations;
create policy commission_cancellations_read on public.commission_cancellations for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists commission_carrier_receipts_read on public.commission_carrier_receipts;
create policy commission_carrier_receipts_read on public.commission_carrier_receipts for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists finance_audit_log_read on public.finance_audit_log;
create policy finance_audit_log_read on public.finance_audit_log for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());
drop policy if exists finance_historical_entries_read on public.finance_historical_entries;
create policy finance_historical_entries_read on public.finance_historical_entries for select to authenticated
  using (agency_id = public.current_agency_id() and public.is_agency_admin());

revoke all on public.finance_settings, public.finance_ledger_install, public.finance_historical_entries, public.commission_transactions,
  public.commission_cancellations, public.commission_carrier_receipts, public.finance_audit_log from public, anon, authenticated;
grant select on public.finance_settings, public.finance_historical_entries, public.commission_transactions, public.commission_cancellations,
  public.commission_carrier_receipts, public.finance_audit_log to authenticated;

-- ───────────────────────────── helpers (internal) ─────────────────────────────

-- cents × rate, to the cent, half away from zero (the app's rounding).
create or replace function public.finance_apply_rate(p_cents bigint, p_rate numeric) returns bigint
language sql immutable set search_path = ''
as $$ select round(p_cents::numeric * p_rate)::bigint $$;
-- The agent's commission: net × 10% × split, rounded at each step.
create or replace function public.finance_agent_cents(p_net bigint, p_rate numeric) returns bigint
language sql immutable set search_path = ''
as $$ select case when p_rate is null then null else public.finance_apply_rate(public.finance_apply_rate(p_net, 0.1), p_rate) end $$;

create or replace function public.finance_cents(v jsonb) returns bigint
language sql immutable set search_path = ''
as $$ select case when jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^-?[0-9]{1,13}$' then (v #>> '{}')::bigint end $$;

create or replace function public.finance_date(v text) returns date
language plpgsql immutable set search_path = ''
as $$
begin
  if v is null or v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  return v::date;
exception when others then
  return null;
end $$;

create or replace function public.finance_timestamp(v text) returns timestamptz
language plpgsql stable set search_path = ''
as $$
begin
  if v is null or v = '' then return null; end if;
  return v::timestamptz;
exception when others then
  return null;
end $$;

-- The policies and endorsements on an account's markets.
create or replace function public.finance_entries(p_quotes jsonb)
returns table (quote_id text, entry jsonb)
language sql immutable set search_path = ''
as $$
  select q ->> 'id', p
    from jsonb_array_elements(case when jsonb_typeof(p_quotes) = 'array' then p_quotes else '[]'::jsonb end) q
   cross join lateral jsonb_array_elements(case when jsonb_typeof(q -> 'policies') = 'array' then q -> 'policies' else '[]'::jsonb end) p
   where jsonb_typeof(p) = 'object' and coalesce(p ->> 'id', '') <> ''
$$;

-- What a record keeps of the policy / endorsement (no notes, no files).
create or replace function public.finance_entry_snapshot(p jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p ->> 'id',
    'kind', case when p ->> 'kind' = 'endorsement' then 'endorsement' else 'policy' end,
    'policyNumber', left(p ->> 'policyNumber', 100),
    'carrier', left(p ->> 'carrier', 200),
    'businessType', left(p ->> 'businessType', 20),
    'boundDate', left(p ->> 'boundDate', 10),
    'effectiveDate', left(p ->> 'effectiveDate', 10),
    'expirationDate', left(p ->> 'expirationDate', 10),
    'netPremiumCents', p -> 'netPremiumCents',
    'taxesCents', p -> 'taxesCents',
    'feesCents', p -> 'feesCents',
    'forPolicyId', left(p ->> 'forPolicyId', 100),
    'createdAt', left(p ->> 'createdAt', 40)))
$$;

-- What a change is compared on: kind, net, date, carrier, policy number.
create or replace function public.finance_entry_key(s jsonb) returns text
language sql immutable set search_path = ''
as $$
  select concat_ws('|', coalesce(s ->> 'kind', 'policy'), s ->> 'netPremiumCents', s ->> 'boundDate', public.carrier_key(s ->> 'carrier'),
                   upper(regexp_replace(coalesce(s ->> 'policyNumber', ''), '[^A-Za-z0-9]', '', 'g')))
$$;

create or replace function public.finance_audit(p_agency uuid, p_action text, p_entity text, p_entity_id text, p_reason text, p_detail jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.finance_audit_log (agency_id, actor, action, entity, entity_id, reason, detail)
  values (p_agency, auth.uid(), p_action, p_entity, p_entity_id, nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_detail, '{}'::jsonb))
$$;

create or replace function public.finance_require_admin() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
begin
  if auth.uid() is null or a is null or not public.is_agency_admin() then
    raise exception 'Only an agency admin can do this.' using errcode = '42501';
  end if;
  return a;
end $$;

create or replace function public.finance_require_text(p_text text, p_message text) returns text
language plpgsql immutable set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_text, '')), '') is null then raise exception '%', p_message using errcode = '22023'; end if;
  if length(p_text) > 1000 then raise exception 'That note is too long (1,000 characters at most).' using errcode = '22023'; end if;
  return btrim(p_text);
end $$;

-- The agent's split on a date, from the 0058 history (for historical records): the latest change on or
-- before it, else the value before the first later change, else today's rate (from_history = false).
create or replace function public.finance_agent_rate_on(p_agency uuid, p_user uuid, p_date date)
returns table (rate numeric, from_history boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  r numeric;
begin
  select h.new_rate into r from public.agent_commission_rate_history h
   where h.agency_id = p_agency and h.user_id = p_user and h.changed_at < (p_date + 1)::timestamptz
   order by h.changed_at desc, h.id desc limit 1;
  if found then return query select r, true; return; end if;
  select h.old_rate into r from public.agent_commission_rate_history h
   where h.agency_id = p_agency and h.user_id = p_user and h.changed_at >= (p_date + 1)::timestamptz
   order by h.changed_at, h.id limit 1;
  if found then return query select r, true; return; end if;
  return query select (select c.rate from public.agent_commission_rates c where c.agency_id = p_agency and c.user_id = p_user), false;
end $$;

-- Expected payout date for a record of this stream payable from this date (schedule in finance_settings).
create or replace function public.finance_pay_date(p_agency uuid, p_stream text, p_date date) returns date
language plpgsql stable security definer set search_path = ''
as $$
declare
  wstart smallint := 1; wpay smallint := 5; mrule text := 'first_weekday'; mdow smallint := 5; mday smallint;
  period_start date; period_end date; first_of_next date;
begin
  if p_date is null then return null; end if;
  select s.weekly_period_start_dow, s.weekly_pay_dow, s.monthly_pay_rule, s.monthly_pay_dow, s.monthly_pay_day
    into wstart, wpay, mrule, mdow, mday
    from public.finance_settings s where s.agency_id = p_agency;
  if not found then wstart := 1; wpay := 5; mrule := 'first_weekday'; mdow := 5; mday := null; end if;
  if p_stream = 'weekly' then
    period_start := p_date - ((extract(isodow from p_date)::int - wstart + 7) % 7);
    period_end := period_start + 6;
    return period_end + 1 + ((wpay - extract(isodow from period_end + 1)::int + 7) % 7);
  end if;
  first_of_next := (date_trunc('month', p_date) + interval '1 month')::date;
  if mrule = 'day_of_month' then return first_of_next + (mday - 1); end if;
  return first_of_next + ((mdow - extract(isodow from first_of_next)::int + 7) % 7);
end $$;

-- What the record shows as: Void, Settled outside RenewalIQ, Verified, Historical – needs review,
-- Missing Proof or Pending Verification.
create or replace function public.finance_status(p public.commission_transactions) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p.verification_status = 'void' then 'void'
    when p.settlement = 'settled_outside' then 'settled_outside'
    when p.verification_status = 'verified' then 'verified'
    when p.origin = 'historical' and p.rate_confirmed_at is null then 'historical_review'
    when p.proof_status = 'missing_proof' then 'missing_proof'
    else 'pending_verification' end
$$;

-- Flags that stop verification until an admin deals with them.
create or replace function public.finance_blocking_flags(p_flags text[]) returns text[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(f order by f), '{}') from unnest(p_flags) f
   where f in ('no_agent', 'no_agent_rate', 'unlinked_endorsement', 'changed_since_recorded', 'removed', 'account_deleted', 'invalid_amount', 'invalid_date', 'invalid_carrier')
$$;

-- Flags worked out again on every save (the rest are set when recorded, or cleared by an admin).
create or replace function public.finance_dynamic_flags() returns text[]
language sql immutable set search_path = ''
as $$ select array['changed_since_recorded', 'removed', 'account_deleted'] $$;

create or replace function public.finance_ensure_settings(p_agency uuid) returns void
language sql security definer set search_path = ''
as $$ insert into public.finance_settings (agency_id) values (p_agency) on conflict (agency_id) do nothing $$;

-- Records one policy / endorsement of an account, freezing the agent, split, rates and amounts now.
-- p_keep: an earlier record of the same entry whose agent and split (and carrier rate, if the carrier
-- and date are the same) are kept. Returns the new record's id (null if one already exists).
create or replace function public.finance_record_entry(p_sub public.submissions, p_quote_id text, p jsonb, p_origin text, p_keep public.commission_transactions default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := p_sub.organization_id;
  k text := case when p ->> 'kind' = 'endorsement' then 'endorsement' else 'policy' end;
  snap jsonb := public.finance_entry_snapshot(p);
  net bigint := public.finance_cents(p -> 'netPremiumCents');
  d date := public.finance_date(p ->> 'boundDate');
  ck text := public.carrier_key(p ->> 'carrier');
  cname text := left(coalesce(nullif(btrim(p ->> 'carrier'), ''), 'Unknown carrier'), 200);
  agent uuid; aname text; arate numeric; from_hist boolean := false;
  cr public.carrier_commission_rates;
  crate numeric; crate_id bigint; csource text;
  flags text[] := '{}';
  link uuid;
  started timestamptz;
  created timestamptz;
  new_id uuid;
begin
  if a is null then return null; end if;
  perform public.finance_ensure_settings(a);
  if ck = '' then ck := 'unknown carrier'; flags := flags || 'invalid_carrier'::text; end if;
  if net is null then net := 0; flags := flags || 'invalid_amount'::text; end if;
  if d is null then d := current_date; flags := flags || 'invalid_date'::text; end if;

  if p_keep.id is not null then
    agent := p_keep.agent_user_id; aname := p_keep.agent_name; arate := p_keep.agent_rate;
    flags := flags || (select coalesce(array_agg(f), '{}') from unnest(p_keep.review_flags) f
                        where f in ('no_agent', 'no_agent_rate', 'historical', 'uncertain_carrier_rate', 'uncertain_agent', 'uncertain_agent_rate', 'created_before_ledger'));
  else
    select pr.user_id, coalesce(nullif(btrim(pr.display_name), ''), pr.email) into agent, aname
      from public.profiles pr where pr.user_id = p_sub.assigned_user_id and pr.agency_id = a;
    if agent is null then
      flags := flags || 'no_agent'::text;
    else
      if p_origin = 'historical' then
        select r.rate, r.from_history into arate, from_hist from public.finance_agent_rate_on(a, agent, d) r;
      else
        select c.rate into arate from public.agent_commission_rates c where c.agency_id = a and c.user_id = agent;
      end if;
      if arate is null then flags := flags || 'no_agent_rate'::text; end if;
    end if;
  end if;

  if p_keep.id is not null and p_keep.carrier_key = ck and p_keep.event_date = d then
    crate := p_keep.carrier_rate; crate_id := p_keep.carrier_rate_id; csource := p_keep.carrier_rate_source;
  else
    cr := public.carrier_rate_on(a, ck, d);
    if cr.id is not null then crate := cr.rate; crate_id := cr.id; csource := 'carrier_rate';
    else crate := 0.1; crate_id := null; csource := 'default'; flags := flags || 'default_carrier_rate'::text;
    end if;
    if p_origin = 'historical' then csource := 'historical'; end if;
  end if;
  if p_origin = 'historical' and p_keep.id is null then
    flags := flags || array['historical', 'uncertain_carrier_rate', 'uncertain_agent'];
    if agent is not null and not from_hist then flags := flags || 'uncertain_agent_rate'::text; end if;
  end if;

  if k = 'endorsement' then
    select t.id into link from public.commission_transactions t
     where t.agency_id = a and t.submission_id = p_sub.id and t.policy_id = p ->> 'forPolicyId' and t.kind = 'policy'
       and t.replaced_by is null and t.verification_status <> 'void';
    if link is null and p_keep.id is not null and p_keep.kind = 'endorsement' then link := p_keep.original_transaction_id; end if;
    if link is null then flags := flags || 'unlinked_endorsement'::text; end if;
  end if;
  select s.ledger_started_at into started from public.finance_settings s where s.agency_id = a;
  created := public.finance_timestamp(p ->> 'createdAt');
  if p_origin = 'recorded' and p_keep.id is null and created is not null and created < started then flags := flags || 'created_before_ledger'::text; end if;
  if p ->> 'removedAt' is not null then flags := flags || 'removed'::text; end if;

  insert into public.commission_transactions (
    agency_id, submission_id, client_name, quote_id, policy_id, kind, stream, origin, original_transaction_id,
    policy_number, carrier_name, carrier_key, business_type, event_date, payable_from, net_cents,
    agent_user_id, agent_name, agent_rate, agent_cents, carrier_rate, carrier_rate_id, carrier_rate_source, carrier_cents,
    recorded_snapshot, proof_status, review_flags, created_by)
  values (
    a, p_sub.id, left(coalesce(p_sub.named_insured, ''), 300), p_quote_id, p ->> 'id', k, case when k = 'policy' then 'weekly' else 'monthly' end, p_origin, link,
    left(p ->> 'policyNumber', 100), cname, ck, case when k = 'policy' then (case when p ->> 'businessType' = 'renewal' then 'renewal' else 'new' end) end, d, d, net,
    agent, aname, arate, public.finance_agent_cents(net, arate), crate, crate_id, csource, public.finance_apply_rate(net, crate),
    snap, case when jsonb_typeof(p -> 'attachments') = 'array' and jsonb_array_length(p -> 'attachments') > 0 then 'has_proof' else 'missing_proof' end,
    (select coalesce(array_agg(distinct f order by f), '{}') from unnest(flags) f), auth.uid())
  on conflict (agency_id, submission_id, policy_id) where policy_id is not null and replaced_by is null do nothing
  returning id into new_id;
  if new_id is not null then
    perform public.finance_audit(a, 'recorded', 'transaction', new_id::text, null,
      jsonb_build_object('origin', p_origin, 'kind', k, 'policyNumber', snap ->> 'policyNumber', 'netCents', net, 'agentRate', arate, 'carrierRate', crate, 'flags', flags));
  end if;
  return new_id;
end $$;

-- Proof, flags and the endorsement link of an existing record, from the account as it is now.
create or replace function public.finance_refresh_entry(p_t public.commission_transactions, p jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  dyn text[] := '{}';
  flags text[];
  proof text := case when jsonb_typeof(p -> 'attachments') = 'array' and jsonb_array_length(p -> 'attachments') > 0 then 'has_proof' else 'missing_proof' end;
  link uuid := p_t.original_transaction_id;
begin
  if public.finance_entry_key(coalesce(p_t.acknowledged_snapshot, p_t.recorded_snapshot)) <> public.finance_entry_key(public.finance_entry_snapshot(p)) then dyn := dyn || 'changed_since_recorded'::text; end if;
  if p ->> 'removedAt' is not null then dyn := dyn || 'removed'::text; end if;
  flags := (select coalesce(array_agg(f), '{}') from unnest(p_t.review_flags) f where not f = any (public.finance_dynamic_flags())) || dyn;
  if p_t.kind = 'endorsement' and p_t.verification_status = 'unverified' and link is not null
     and exists (select 1 from public.commission_transactions x where x.id = link and x.verification_status = 'void') then link := null; end if;
  if p_t.kind = 'endorsement' and link is null and p_t.verification_status = 'unverified' and coalesce(p ->> 'forPolicyId', '') <> '' then
    select t.id into link from public.commission_transactions t
     where t.agency_id = p_t.agency_id and t.submission_id = p_t.submission_id and t.policy_id = p ->> 'forPolicyId' and t.kind = 'policy'
       and t.replaced_by is null and t.verification_status <> 'void';
  end if;
  if link is not null then flags := array_remove(flags, 'unlinked_endorsement');
  elsif p_t.kind = 'endorsement' then flags := flags || 'unlinked_endorsement'::text; end if;
  flags := (select coalesce(array_agg(distinct f order by f), '{}') from unnest(flags) f);
  if flags is distinct from p_t.review_flags or proof is distinct from p_t.proof_status or link is distinct from p_t.original_transaction_id then
    update public.commission_transactions set review_flags = flags, proof_status = proof, original_transaction_id = link where id = p_t.id;
  end if;
end $$;

-- Brings an account's records up to date: records new policies / endorsements, refreshes the rest, flags
-- the ones no longer on the account. Historical entries (noted before records began) wait for the backfill.
create or replace function public.finance_sync(p_sub public.submissions) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  t public.commission_transactions;
  ids text[] := '{}';
begin
  if p_sub.organization_id is null then return; end if;
  for r in select * from public.finance_entries(p_sub.market_quotes) loop
    ids := ids || (r.entry ->> 'id');
    select * into t from public.commission_transactions x
     where x.agency_id = p_sub.organization_id and x.submission_id = p_sub.id and x.policy_id = r.entry ->> 'id' and x.replaced_by is null;
    if found then
      if t.verification_status <> 'void' then perform public.finance_refresh_entry(t, r.entry); end if;
    elsif r.entry ->> 'removedAt' is null
          and not exists (select 1 from public.finance_historical_entries h where h.submission_id = p_sub.id and h.policy_id = r.entry ->> 'id' and h.backfilled_at is null) then
      perform public.finance_record_entry(p_sub, r.quote_id, r.entry, 'recorded');
    end if;
  end loop;
  update public.commission_transactions x
     set review_flags = (select coalesce(array_agg(distinct f order by f), '{}') from unnest(x.review_flags || array['removed']) f)
   where x.agency_id = p_sub.organization_id and x.submission_id = p_sub.id and x.policy_id is not null and x.replaced_by is null
     and x.verification_status <> 'void' and not (x.policy_id = any (ids)) and not ('removed' = any (x.review_flags));
end $$;

-- The trigger on accounts. It never stops a save: a problem is written to the audit log instead.
create or replace function public.finance_sync_submission() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  agency uuid;
  sub_id text;
begin
  if tg_op = 'DELETE' then
    agency := old.organization_id; sub_id := old.id;
  else
    agency := new.organization_id; sub_id := new.id;
  end if;
  begin
    if tg_op = 'DELETE' then
      update public.commission_transactions x
         set review_flags = (select coalesce(array_agg(distinct f order by f), '{}') from unnest(x.review_flags || array['account_deleted']) f)
       where x.submission_id = old.id and not ('account_deleted' = any (x.review_flags));
      return old;
    end if;
    if new.organization_id is null then return new; end if;
    -- An account newly shared with an agency: what's already on it is historical for that agency.
    if tg_op = 'UPDATE' and old.organization_id is distinct from new.organization_id then
      insert into public.finance_historical_entries (agency_id, submission_id, policy_id)
      select new.organization_id, new.id, e.entry ->> 'id' from public.finance_entries(new.market_quotes) e
      on conflict (submission_id, policy_id) do nothing;
    elsif tg_op = 'UPDATE' and new.market_quotes is not distinct from old.market_quotes then
      return new;
    end if;
    perform public.finance_sync(new);
  exception when others then
    begin
      insert into public.finance_audit_log (agency_id, actor, action, entity, entity_id, detail)
      values (agency, auth.uid(), 'sync_error', 'account', sub_id, jsonb_build_object('error', left(sqlerrm, 500), 'state', sqlstate));
    exception when others then
      null;
    end;
  end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists finance_sync_submission on public.submissions;
create trigger finance_sync_submission after insert or update of market_quotes, organization_id or delete on public.submissions
  for each row execute function public.finance_sync_submission();

revoke all on function public.finance_apply_rate(bigint, numeric), public.finance_agent_cents(bigint, numeric), public.finance_cents(jsonb),
  public.finance_date(text), public.finance_timestamp(text), public.finance_entries(jsonb), public.finance_entry_snapshot(jsonb), public.finance_entry_key(jsonb),
  public.finance_audit(uuid, text, text, text, text, jsonb), public.finance_require_admin(), public.finance_require_text(text, text),
  public.finance_agent_rate_on(uuid, uuid, date), public.finance_pay_date(uuid, text, date), public.finance_status(public.commission_transactions),
  public.finance_blocking_flags(text[]), public.finance_dynamic_flags(), public.finance_ensure_settings(uuid),
  public.finance_record_entry(public.submissions, text, jsonb, text, public.commission_transactions), public.finance_refresh_entry(public.commission_transactions, jsonb),
  public.finance_sync(public.submissions), public.finance_sync_submission() from public, anon, authenticated;
-- The status of a record is shown to admins (who can read the record anyway).
grant execute on function public.finance_status(public.commission_transactions) to authenticated;

-- ───────────────────────────── first install ─────────────────────────────

-- Once: note what already exists (historical), and give every agency its settings.
do $$
begin
  if not exists (select 1 from public.finance_ledger_install) then
    insert into public.finance_historical_entries (agency_id, submission_id, policy_id)
    select s.organization_id, s.id, e.entry ->> 'id'
      from public.submissions s cross join lateral public.finance_entries(s.market_quotes) e
     where s.organization_id is not null
    on conflict (submission_id, policy_id) do nothing;
    insert into public.finance_settings (agency_id) select id from public.agencies on conflict (agency_id) do nothing;
    insert into public.finance_ledger_install default values;
  end if;
end $$;

-- ───────────────────────────── historical backfill ─────────────────────────────

-- Counts only: what the backfill would record for an agency (all agencies when run from the SQL editor).
create or replace function public.finance_backfill_preview(p_agency uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  a uuid := p_agency;
  out jsonb;
begin
  if auth.uid() is not null then a := public.finance_require_admin(); end if;
  select jsonb_build_object(
    'noted', count(*),
    'already_recorded', count(*) filter (where h.backfilled_at is not null),
    'to_record', count(*) filter (where h.backfilled_at is null and e.entry is not null and e.entry ->> 'removedAt' is null),
    'removed_or_gone', count(*) filter (where h.backfilled_at is null and (e.entry is null or e.entry ->> 'removedAt' is not null)),
    'policies', count(*) filter (where h.backfilled_at is null and e.entry is not null and e.entry ->> 'removedAt' is null and coalesce(e.entry ->> 'kind', 'policy') <> 'endorsement'),
    'endorsements', count(*) filter (where h.backfilled_at is null and e.entry is not null and e.entry ->> 'removedAt' is null and e.entry ->> 'kind' = 'endorsement'),
    'endorsements_without_link', count(*) filter (where h.backfilled_at is null and e.entry ->> 'kind' = 'endorsement' and e.entry ->> 'removedAt' is null and coalesce(e.entry ->> 'forPolicyId', '') = ''),
    'without_agent', count(*) filter (where h.backfilled_at is null and e.entry is not null and e.entry ->> 'removedAt' is null
                                      and not exists (select 1 from public.profiles pr where pr.user_id = s.assigned_user_id and pr.agency_id = h.agency_id)))
    into out
    from public.finance_historical_entries h
    left join public.submissions s on s.id = h.submission_id
    left join lateral (select x.entry from public.finance_entries(s.market_quotes) x where x.entry ->> 'id' = h.policy_id limit 1) e on true
   where a is null or h.agency_id = a;
  return out;
end $$;

-- Records the historical entries as "Historical – needs review" (never verified, never payable until an
-- admin reviews them). For an agency's admin: their agency. From the SQL editor: p_agency, or all.
create or replace function public.finance_backfill_historical(p_agency uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := p_agency;
  h record;
  s public.submissions;
  qid text;
  ent jsonb;
  recorded int := 0;
  skipped int := 0;
begin
  if auth.uid() is not null then a := public.finance_require_admin(); end if;
  -- Policies before their endorsements, so the endorsements can link to them.
  for h in select x.* from public.finance_historical_entries x
            left join public.submissions sx on sx.id = x.submission_id
            left join lateral (select y.entry from public.finance_entries(sx.market_quotes) y where y.entry ->> 'id' = x.policy_id limit 1) ey on true
           where x.backfilled_at is null and (a is null or x.agency_id = a)
           order by (coalesce(ey.entry ->> 'kind', 'policy') = 'endorsement'), x.submission_id, x.policy_id
           for update of x loop
    s := null; qid := null; ent := null;
    select * into s from public.submissions where id = h.submission_id;
    select x.quote_id, x.entry into qid, ent from public.finance_entries(s.market_quotes) x where x.entry ->> 'id' = h.policy_id limit 1;
    if s.id is null or ent is null or ent ->> 'removedAt' is not null or s.organization_id is distinct from h.agency_id then
      skipped := skipped + 1;
    elsif public.finance_record_entry(s, qid, ent, 'historical') is not null then
      recorded := recorded + 1;
    end if;
    update public.finance_historical_entries set backfilled_at = now() where submission_id = h.submission_id and policy_id = h.policy_id;
  end loop;
  perform public.finance_audit(a, 'historical_backfill', 'agency', coalesce(a::text, 'all'), null, jsonb_build_object('recorded', recorded, 'skipped', skipped));
  return jsonb_build_object('recorded', recorded, 'skipped', skipped);
end $$;
revoke all on function public.finance_backfill_preview(uuid), public.finance_backfill_historical(uuid) from public, anon;
grant execute on function public.finance_backfill_preview(uuid), public.finance_backfill_historical(uuid) to authenticated;

-- ───────────────────────────── admin actions ─────────────────────────────

create or replace function public.finance_lock_transaction(p_id uuid) returns public.commission_transactions
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions;
begin
  select * into t from public.commission_transactions where id = p_id and agency_id = public.finance_require_admin() for update;
  if not found then raise exception 'That commission record doesn''t exist.' using errcode = 'P0002'; end if;
  return t;
end $$;
revoke all on function public.finance_lock_transaction(uuid) from public, anon, authenticated;

-- The entry on the account that a record came from, as it is now (null if it's gone).
create or replace function public.finance_current_entry(p_t public.commission_transactions) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select e.entry from public.submissions s cross join lateral public.finance_entries(s.market_quotes) e
   where s.id = p_t.submission_id and e.entry ->> 'id' = p_t.policy_id limit 1
$$;
revoke all on function public.finance_current_entry(public.commission_transactions) from public, anon, authenticated;

-- Verify: the amounts match the proof. Without proof only as an exception, with a reason.
create or replace function public.verify_commission(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_id);
  blocking text[];
begin
  if t.verification_status <> 'unverified' then raise exception 'This commission is already %.', t.verification_status using errcode = '22023'; end if;
  if t.settlement <> 'open' then raise exception 'This commission was settled outside RenewalIQ.' using errcode = '22023'; end if;
  if t.origin = 'historical' and t.rate_confirmed_at is null then
    raise exception 'Confirm this historical record''s agent, split and carrier rate first.' using errcode = '22023';
  end if;
  blocking := public.finance_blocking_flags(t.review_flags);
  if cardinality(blocking) > 0 then raise exception 'Resolve these first: %.', array_to_string(blocking, ', ') using errcode = '22023'; end if;
  if t.proof_status = 'missing_proof' then
    perform public.finance_require_text(p_reason, 'Verifying without proof is an exception: give the reason.');
  end if;
  update public.commission_transactions
     set verification_status = 'verified', verified_by = auth.uid(), verified_at = now(),
         verified_without_proof = (t.proof_status = 'missing_proof'), verification_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = t.id;
  perform public.finance_audit(t.agency_id, case when t.proof_status = 'missing_proof' then 'verified_without_proof' else 'verified' end, 'transaction', t.id::text, p_reason,
    jsonb_build_object('netCents', t.net_cents, 'agentCents', t.agent_cents, 'carrierCents', t.carrier_cents));
end $$;

-- Historical records: an admin confirms the agent, split and carrier rate (with the evidence for the rates).
create or replace function public.confirm_historical_commission(p_id uuid, p_agent_user_id uuid, p_agent_rate numeric, p_carrier_rate numeric, p_evidence text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_id);
  aname text;
  evidence text := public.finance_require_text(p_evidence, 'Say what the rates are based on (the evidence).');
begin
  if t.origin <> 'historical' then raise exception 'Only historical records are confirmed this way.' using errcode = '22023'; end if;
  if t.verification_status <> 'unverified' or t.settlement <> 'open' or t.rate_confirmed_at is not null then
    raise exception 'This record is no longer waiting for review.' using errcode = '22023';
  end if;
  if p_agent_rate is null or p_agent_rate < 0 or p_agent_rate > 1 or p_carrier_rate is null or p_carrier_rate < 0 or p_carrier_rate > 1 then
    raise exception 'Rates are between 0%% and 100%%.' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(pr.display_name), ''), pr.email) into aname from public.profiles pr where pr.user_id = p_agent_user_id and pr.agency_id = t.agency_id;
  if aname is null then raise exception 'Choose an agent from your agency.' using errcode = '22023'; end if;
  perform set_config('renewaliq.finance_op', 'confirm_historical', true);
  update public.commission_transactions
     set agent_user_id = p_agent_user_id, agent_name = aname, agent_rate = p_agent_rate, agent_cents = public.finance_agent_cents(t.net_cents, p_agent_rate),
         carrier_rate = p_carrier_rate, carrier_rate_id = null, carrier_rate_source = 'confirmed', carrier_cents = public.finance_apply_rate(t.net_cents, p_carrier_rate),
         rate_evidence = evidence, rate_confirmed_by = auth.uid(), rate_confirmed_at = now(),
         review_flags = array(select f from unnest(t.review_flags) f where f not in ('uncertain_carrier_rate', 'uncertain_agent', 'uncertain_agent_rate', 'no_agent', 'no_agent_rate', 'default_carrier_rate'))
   where id = t.id;
  perform set_config('renewaliq.finance_op', '', true);
  perform public.finance_audit(t.agency_id, 'historical_confirmed', 'transaction', t.id::text, evidence,
    jsonb_build_object('before', jsonb_build_object('agent', t.agent_user_id, 'agentRate', t.agent_rate, 'carrierRate', t.carrier_rate),
                       'after', jsonb_build_object('agent', p_agent_user_id, 'agentRate', p_agent_rate, 'carrierRate', p_carrier_rate)));
end $$;

-- A record saved without an agent or without the agent's split: an admin fills in only what's missing, with a
-- reason, on the record itself (the policy stays as it is). An agent already recorded is never changed.
create or replace function public.resolve_commission_agent(p_id uuid, p_agent_user_id uuid, p_agent_rate numeric, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_id);
  reason text := public.finance_require_text(p_reason, 'Say how the agent and split were decided.');
  aname text;
begin
  if t.kind not in ('policy', 'endorsement') or t.verification_status <> 'unverified' or t.settlement <> 'open' then
    raise exception 'Only an unverified policy or endorsement is resolved this way.' using errcode = '22023';
  end if;
  if t.origin = 'historical' and t.rate_confirmed_at is null then
    raise exception 'Confirm this historical record instead: that sets its agent, split and carrier rate.' using errcode = '22023';
  end if;
  if t.agent_user_id is not null and t.agent_rate is not null then
    raise exception 'This commission already has its agent and split; they stay as recorded.' using errcode = '22023';
  end if;
  if t.agent_user_id is not null and p_agent_user_id is distinct from t.agent_user_id then
    raise exception 'The agent stays as recorded; only the missing split is added.' using errcode = '22023';
  end if;
  if p_agent_rate is null or p_agent_rate < 0 or p_agent_rate > 1 then raise exception 'The split is between 0%% and 100%%.' using errcode = '22023'; end if;
  select coalesce(nullif(btrim(pr.display_name), ''), pr.email) into aname from public.profiles pr where pr.user_id = p_agent_user_id and pr.agency_id = t.agency_id;
  if aname is null then raise exception 'Choose an agent from your agency.' using errcode = '22023'; end if;
  perform set_config('renewaliq.finance_op', 'resolve_agent', true);
  update public.commission_transactions
     set agent_user_id = p_agent_user_id, agent_name = coalesce(t.agent_name, aname), agent_rate = p_agent_rate,
         agent_cents = public.finance_agent_cents(t.net_cents, p_agent_rate),
         review_flags = array(select f from unnest(t.review_flags) f where f not in ('no_agent', 'no_agent_rate'))
   where id = t.id;
  perform set_config('renewaliq.finance_op', '', true);
  perform public.finance_audit(t.agency_id, 'agent_resolved', 'transaction', t.id::text, reason,
    jsonb_build_object('before', jsonb_build_object('agent', t.agent_user_id, 'agentRate', t.agent_rate, 'agentCents', t.agent_cents),
                       'after', jsonb_build_object('agent', p_agent_user_id, 'agentRate', p_agent_rate, 'agentCents', public.finance_agent_cents(t.net_cents, p_agent_rate))));
end $$;

-- Links an endorsement recorded without its policy (admin review; never assigned automatically).
create or replace function public.link_commission_endorsement(p_id uuid, p_policy_transaction_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_id);
  pol public.commission_transactions;
begin
  if t.kind <> 'endorsement' or t.verification_status <> 'unverified'
     or (t.original_transaction_id is not null and not exists (select 1 from public.commission_transactions x where x.id = t.original_transaction_id and x.verification_status = 'void')) then
    raise exception 'Only an unverified endorsement without its policy can be linked.' using errcode = '22023';
  end if;
  select * into pol from public.commission_transactions where id = p_policy_transaction_id and agency_id = t.agency_id and submission_id = t.submission_id
     and kind = 'policy' and replaced_by is null and verification_status <> 'void';
  if not found then raise exception 'Choose a policy on the same account.' using errcode = '22023'; end if;
  update public.commission_transactions set original_transaction_id = pol.id, review_flags = array_remove(t.review_flags, 'unlinked_endorsement') where id = t.id;
  perform public.finance_audit(t.agency_id, 'endorsement_linked', 'transaction', t.id::text, null, jsonb_build_object('policyTransaction', pol.id, 'policyNumber', pol.policy_number));
end $$;

-- Keeps the record as it is and accepts the account's current details (e.g. a policy number filled in).
create or replace function public.acknowledge_commission_changes(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_id);
  note text := public.finance_require_text(p_note, 'Add a note on why the record stays as it is.');
  cur jsonb := public.finance_current_entry(t);
begin
  if not (t.review_flags && array['changed_since_recorded', 'removed']) then raise exception 'Nothing to acknowledge.' using errcode = '22023'; end if;
  update public.commission_transactions
     set acknowledged_snapshot = case when cur is null then coalesce(t.acknowledged_snapshot, t.recorded_snapshot) else public.finance_entry_snapshot(cur) end,
         review_flags = array(select f from unnest(t.review_flags) f where f not in ('changed_since_recorded', 'removed'))
   where id = t.id;
  perform public.finance_audit(t.agency_id, 'changes_acknowledged', 'transaction', t.id::text, note, jsonb_build_object('flags', t.review_flags));
end $$;

-- Voids an unverified record (not a commission: entered by mistake, never written). Kept, with the reason.
create or replace function public.void_commission(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_id);
  reason text := public.finance_require_text(p_reason, 'Say why this commission is voided.');
begin
  if t.verification_status <> 'unverified' then raise exception 'Only an unverified commission can be voided; add a correction or a cancellation instead.' using errcode = '22023'; end if;
  if t.settlement <> 'open' then raise exception 'This commission was settled outside RenewalIQ.' using errcode = '22023'; end if;
  update public.commission_transactions set verification_status = 'void', void_reason = reason, voided_by = auth.uid(), voided_at = now() where id = t.id;
  perform public.finance_audit(t.agency_id, 'voided', 'transaction', t.id::text, reason, '{}'::jsonb);
end $$;

-- Re-records an unverified record from the account as it is now, keeping its agent and split (and its
-- carrier rate when the carrier and date are unchanged). p_current_agent: only for a record that had no
-- agent or no split — then the account's current agent and split are used.
create or replace function public.rerecord_commission(p_id uuid, p_reason text, p_current_agent boolean default false) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_id);
  reason text := public.finance_require_text(p_reason, 'Say why this commission is recorded again.');
  s public.submissions;
  qid text;
  ent jsonb;
  new_id uuid;
begin
  if t.verification_status <> 'unverified' or t.settlement <> 'open' or t.kind not in ('policy', 'endorsement') then
    raise exception 'Only an unverified policy or endorsement can be recorded again; add a correction instead.' using errcode = '22023';
  end if;
  if p_current_agent and not (t.review_flags && array['no_agent', 'no_agent_rate']) then
    raise exception 'The agent and split stay as recorded; only a record without an agent or split takes the current ones.' using errcode = '22023';
  end if;
  select * into s from public.submissions where id = t.submission_id;
  select x.quote_id, x.entry into qid, ent from public.finance_entries(s.market_quotes) x where x.entry ->> 'id' = t.policy_id limit 1;
  if s.id is null or ent is null or ent ->> 'removedAt' is not null then raise exception 'This policy is no longer on the account.' using errcode = '22023'; end if;
  -- Void it, pointing at itself for a moment so the new record isn't blocked by the one-per-entry index.
  update public.commission_transactions set verification_status = 'void', void_reason = reason, voided_by = auth.uid(), voided_at = now(), replaced_by = t.id where id = t.id;
  new_id := public.finance_record_entry(s, qid, ent, t.origin, case when p_current_agent then null else t end);
  if new_id is null then raise exception 'The policy couldn''t be recorded again.' using errcode = 'P0001'; end if;
  update public.commission_transactions set replaced_by = new_id where id = t.id;
  perform public.finance_audit(t.agency_id, 'rerecorded', 'transaction', t.id::text, reason, jsonb_build_object('newTransaction', new_id, 'currentAgent', p_current_agent));
  return new_id;
end $$;

-- A correction of a verified (or settled) record: the difference to the new net premium, with the
-- original's agent, split and carrier rate. A separate, verified record.
create or replace function public.correct_commission(p_id uuid, p_new_net_cents bigint, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_id);
  reason text := public.finance_require_text(p_reason, 'Say why the commission is corrected.');
  cur_net bigint; cur_agent bigint; cur_carrier bigint;
  new_id uuid;
  cur jsonb;
begin
  if t.kind not in ('policy', 'endorsement') then raise exception 'Correct the original policy or endorsement.' using errcode = '22023'; end if;
  if t.verification_status <> 'verified' and t.settlement <> 'settled_outside' then
    raise exception 'Verify the commission first (or record it again while it''s unverified).' using errcode = '22023';
  end if;
  if t.verification_status = 'void' then raise exception 'This commission is void.' using errcode = '22023'; end if;
  if p_new_net_cents is null or abs(p_new_net_cents) >= 100000000000 then raise exception 'Enter the corrected net premium.' using errcode = '22023'; end if;
  if t.kind = 'policy' and p_new_net_cents < 0 then raise exception 'A policy''s net premium can''t be negative.' using errcode = '22023'; end if;
  select t.net_cents + coalesce(sum(c.net_cents), 0), coalesce(t.agent_cents, 0) + coalesce(sum(c.agent_cents), 0), t.carrier_cents + coalesce(sum(c.carrier_cents), 0)
    into cur_net, cur_agent, cur_carrier
    from public.commission_transactions c where c.original_transaction_id = t.id and c.kind = 'correction' and c.verification_status <> 'void';
  if p_new_net_cents = cur_net then raise exception 'That''s the net premium already recorded.' using errcode = '22023'; end if;
  insert into public.commission_transactions (
    agency_id, submission_id, client_name, quote_id, kind, stream, origin, original_transaction_id, policy_number, carrier_name, carrier_key, business_type,
    event_date, payable_from, net_cents, agent_user_id, agent_name, agent_rate, agent_cents, carrier_rate, carrier_rate_id, carrier_rate_source, carrier_cents,
    recorded_snapshot, proof_status, verification_status, verified_by, verified_at, verification_reason, created_by)
  values (
    t.agency_id, t.submission_id, t.client_name, t.quote_id, 'correction', t.stream, 'admin', t.id, t.policy_number, t.carrier_name, t.carrier_key, t.business_type,
    current_date, current_date, p_new_net_cents - cur_net, t.agent_user_id, t.agent_name, t.agent_rate,
    case when t.agent_rate is null then null else public.finance_agent_cents(p_new_net_cents, t.agent_rate) - cur_agent end,
    t.carrier_rate, t.carrier_rate_id, t.carrier_rate_source, public.finance_apply_rate(p_new_net_cents, t.carrier_rate) - cur_carrier,
    jsonb_build_object('correctedNetCents', p_new_net_cents, 'previousNetCents', cur_net), t.proof_status, 'verified', auth.uid(), now(), reason, auth.uid())
  returning id into new_id;
  cur := public.finance_current_entry(t);
  update public.commission_transactions
     set acknowledged_snapshot = jsonb_set(coalesce(public.finance_entry_snapshot(cur), coalesce(t.acknowledged_snapshot, t.recorded_snapshot)), '{netPremiumCents}', to_jsonb(p_new_net_cents)),
         review_flags = array_remove(t.review_flags, 'changed_since_recorded')
   where id = t.id;
  perform public.finance_audit(t.agency_id, 'corrected', 'transaction', t.id::text, reason,
    jsonb_build_object('correction', new_id, 'fromNetCents', cur_net, 'toNetCents', p_new_net_cents));
  return new_id;
end $$;

-- Historical records already paid before RenewalIQ: marked settled outside, in bulk, with a reason and the
-- exact number confirmed. Never assumed. They stay for history and are never paid again.
create or replace function public.settle_commissions_outside(p_ids uuid[], p_reason text, p_confirm_count integer) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.finance_require_admin();
  reason text := public.finance_require_text(p_reason, 'Say how these were settled (e.g. paid before RenewalIQ, by cheque).');
  n integer;
  ids uuid[] := (select coalesce(array_agg(distinct x), '{}') from unnest(p_ids) x);
begin
  if p_confirm_count is null or p_confirm_count <> cardinality(ids) or cardinality(ids) = 0 then
    raise exception 'Confirm the number of records to mark settled.' using errcode = '22023';
  end if;
  perform 1 from public.commission_transactions where id = any (ids) for update;
  select count(*) into n from public.commission_transactions
   where id = any (ids) and agency_id = a and origin = 'historical' and settlement = 'open' and verification_status <> 'void';
  if n <> cardinality(ids) then raise exception 'Only open historical records can be marked settled outside RenewalIQ.' using errcode = '22023'; end if;
  update public.commission_transactions set settlement = 'settled_outside', settled_by = auth.uid(), settled_at = now(), settled_reason = reason where id = any (ids);
  perform public.finance_audit(a, 'settled_outside', 'transaction', x::text, reason, jsonb_build_object('batch', cardinality(ids))) from unnest(ids) x;
  return n;
end $$;

-- Carrier receipts (tracking only).
create or replace function public.record_carrier_receipt(p_transaction_id uuid, p_amount_cents bigint, p_received_date date, p_reference text default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.commission_transactions := public.finance_lock_transaction(p_transaction_id);
  new_id uuid;
begin
  if p_amount_cents is null or p_amount_cents = 0 or abs(p_amount_cents) >= 100000000000 then raise exception 'Enter the amount received.' using errcode = '22023'; end if;
  if p_received_date is null then raise exception 'Enter the date it was received.' using errcode = '22023'; end if;
  insert into public.commission_carrier_receipts (agency_id, transaction_id, amount_cents, received_date, reference, note, recorded_by)
  values (t.agency_id, t.id, p_amount_cents, p_received_date, nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into new_id;
  perform public.finance_audit(t.agency_id, 'carrier_receipt', 'transaction', t.id::text, p_note, jsonb_build_object('receipt', new_id, 'amountCents', p_amount_cents, 'date', p_received_date));
  return new_id;
end $$;

create or replace function public.void_carrier_receipt(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.finance_require_admin();
  reason text := public.finance_require_text(p_reason, 'Say why the receipt is voided.');
  r public.commission_carrier_receipts;
begin
  select * into r from public.commission_carrier_receipts where id = p_id and agency_id = a and voided_at is null for update;
  if not found then raise exception 'That receipt doesn''t exist or is already voided.' using errcode = 'P0002'; end if;
  update public.commission_carrier_receipts set voided_at = now(), voided_by = auth.uid(), void_reason = reason where id = r.id;
  perform public.finance_audit(a, 'carrier_receipt_voided', 'transaction', r.transaction_id::text, reason, jsonb_build_object('receipt', r.id));
end $$;

-- The payout schedule (used for expected payout dates now, and by 0065's payouts).
create or replace function public.set_finance_payout_schedule(p_weekly_period_start_dow integer, p_weekly_pay_dow integer, p_monthly_pay_rule text,
  p_monthly_pay_dow integer, p_monthly_pay_day integer, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.finance_require_admin();
  reason text := public.finance_require_text(p_reason, 'Say why the schedule changes.');
  before public.finance_settings;
begin
  if p_weekly_period_start_dow not between 1 and 7 or p_weekly_pay_dow not between 1 and 7 or p_monthly_pay_dow not between 1 and 7 then
    raise exception 'Choose weekdays.' using errcode = '22023';
  end if;
  if p_monthly_pay_rule not in ('first_weekday', 'day_of_month') then raise exception 'Choose how the monthly payday is set.' using errcode = '22023'; end if;
  if p_monthly_pay_rule = 'day_of_month' and (p_monthly_pay_day is null or p_monthly_pay_day not between 1 and 28) then
    raise exception 'Choose a day between 1 and 28.' using errcode = '22023';
  end if;
  perform public.finance_ensure_settings(a);
  select * into before from public.finance_settings where agency_id = a for update;
  update public.finance_settings
     set weekly_period_start_dow = p_weekly_period_start_dow, weekly_pay_dow = p_weekly_pay_dow, monthly_pay_rule = p_monthly_pay_rule,
         monthly_pay_dow = p_monthly_pay_dow, monthly_pay_day = case when p_monthly_pay_rule = 'day_of_month' then p_monthly_pay_day end,
         updated_by = auth.uid(), updated_at = now()
   where agency_id = a;
  perform public.finance_audit(a, 'payout_schedule', 'settings', a::text, reason,
    jsonb_build_object('before', to_jsonb(before) - 'agency_id' - 'ledger_started_at',
                       'after', jsonb_build_object('weekly_period_start_dow', p_weekly_period_start_dow, 'weekly_pay_dow', p_weekly_pay_dow, 'monthly_pay_rule', p_monthly_pay_rule,
                                                   'monthly_pay_dow', p_monthly_pay_dow, 'monthly_pay_day', p_monthly_pay_day)));
end $$;

-- ───────────────────────────── cancellations ─────────────────────────────

-- An agent working on the account (or an admin) requests a cancellation of a policy or an endorsement.
create or replace function public.request_commission_cancellation(p_transaction_id uuid, p_cancel_type text, p_effective_date date, p_reason text,
  p_expected_refund_cents bigint default null, p_document_ids text[] default '{}') returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a uuid := public.current_agency_id();
  t public.commission_transactions;
  reason text := public.finance_require_text(p_reason, 'Say why the policy is cancelled.');
  docs text[] := (select coalesce(array_agg(distinct d), '{}') from unnest(coalesce(p_document_ids, '{}')) d where d <> '');
  new_id uuid;
begin
  if auth.uid() is null or a is null then raise exception 'Sign in to your agency.' using errcode = '42501'; end if;
  select * into t from public.commission_transactions where id = p_transaction_id and agency_id = a for update;
  if not found or not (public.is_agency_admin() or public.can_access_submission(t.submission_id)) then
    raise exception 'That policy doesn''t exist or isn''t on an account you work on.' using errcode = '42501';
  end if;
  if t.kind not in ('policy', 'endorsement') or t.verification_status = 'void' or t.replaced_by is not null then raise exception 'Cancellations are requested on a recorded policy or endorsement.' using errcode = '22023'; end if;
  if p_cancel_type not in ('full', 'partial') then raise exception 'Choose a full or a partial cancellation.' using errcode = '22023'; end if;
  if p_effective_date is null then raise exception 'Enter the cancellation''s effective date.' using errcode = '22023'; end if;
  if p_expected_refund_cents is not null and (p_expected_refund_cents <= 0 or p_expected_refund_cents >= 100000000000) then raise exception 'The expected refund is a positive amount.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(docs) d where not exists (select 1 from public.documents x where x.id = d and x.submission_id = t.submission_id)) then
    raise exception 'Attach documents from this account.' using errcode = '22023';
  end if;
  if exists (select 1 from public.commission_cancellations c where c.transaction_id = t.id and c.status in ('requested', 'awaiting_amount')) then
    raise exception 'A cancellation is already waiting on this policy.' using errcode = '23505';
  end if;
  insert into public.commission_cancellations (agency_id, transaction_id, submission_id, cancel_type, effective_date, reason, expected_refund_cents, document_ids, requested_by)
  values (a, t.id, t.submission_id, p_cancel_type, p_effective_date, reason, p_expected_refund_cents, docs, auth.uid())
  returning id into new_id;
  perform public.finance_audit(a, 'cancellation_requested', 'cancellation', new_id::text, reason,
    jsonb_build_object('transaction', t.id, 'type', p_cancel_type, 'effectiveDate', p_effective_date, 'expectedRefundCents', p_expected_refund_cents));
  return new_id;
end $$;

create or replace function public.withdraw_commission_cancellation(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.commission_cancellations;
begin
  select * into c from public.commission_cancellations where id = p_id and agency_id = public.current_agency_id() for update;
  if not found or auth.uid() is null or not (c.requested_by = auth.uid() or public.is_agency_admin()) then raise exception 'That request doesn''t exist.' using errcode = '42501'; end if;
  if c.status not in ('requested', 'awaiting_amount') then raise exception 'This request is already decided.' using errcode = '22023'; end if;
  update public.commission_cancellations set status = 'withdrawn', decided_by = auth.uid(), decided_at = now() where id = c.id;
  perform public.finance_audit(c.agency_id, 'cancellation_withdrawn', 'cancellation', c.id::text, null, '{}'::jsonb);
end $$;

create or replace function public.finance_lock_cancellation(p_id uuid) returns public.commission_cancellations
language plpgsql security definer set search_path = ''
as $$
declare
  c public.commission_cancellations;
begin
  select * into c from public.commission_cancellations where id = p_id and agency_id = public.finance_require_admin() for update;
  if not found then raise exception 'That cancellation request doesn''t exist.' using errcode = 'P0002'; end if;
  if c.status not in ('requested', 'awaiting_amount') then raise exception 'This request is already decided.' using errcode = '22023'; end if;
  return c;
end $$;
revoke all on function public.finance_lock_cancellation(uuid) from public, anon, authenticated;

-- Waiting for the carrier's actual refund: nothing is worked out until the admin has it.
create or replace function public.mark_cancellation_awaiting_amount(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.commission_cancellations := public.finance_lock_cancellation(p_id);
begin
  update public.commission_cancellations set status = 'awaiting_amount', decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = c.id;
  perform public.finance_audit(c.agency_id, 'cancellation_awaiting_amount', 'cancellation', c.id::text, p_note, '{}'::jsonb);
end $$;

create or replace function public.reject_commission_cancellation(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.commission_cancellations := public.finance_lock_cancellation(p_id);
  note text := public.finance_require_text(p_note, 'Say why the request is rejected.');
begin
  update public.commission_cancellations set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = note where id = c.id;
  perform public.finance_audit(c.agency_id, 'cancellation_rejected', 'cancellation', c.id::text, note, '{}'::jsonb);
end $$;

-- How much net premium is still on a policy (or an endorsement): it, its corrections, a policy's
-- endorsements (and theirs), less what earlier cancellations of any of them returned.
create or replace function public.finance_remaining_net(p_policy uuid) returns bigint
language sql stable security definer set search_path = ''
as $$
  with related as (
    select id, net_cents from public.commission_transactions where id = p_policy
    union all
    select e.id, e.net_cents from public.commission_transactions e
     where e.original_transaction_id = p_policy and e.kind = 'endorsement' and e.verification_status <> 'void' and e.replaced_by is null
  )
  select coalesce((select sum(net_cents) from related), 0)
       + coalesce((select sum(c.net_cents) from public.commission_transactions c where c.original_transaction_id in (select id from related) and c.kind = 'correction' and c.verification_status <> 'void'), 0)
       + coalesce((select sum(c.net_cents) from public.commission_transactions c where c.original_transaction_id in (select id from related) and c.kind = 'cancellation' and c.verification_status <> 'void'), 0)
$$;
revoke all on function public.finance_remaining_net(uuid) from public, anon, authenticated;

-- An admin approves with the actual amounts from the carrier: the returned net premium and the carrier
-- commission returned. The agent adjustment uses the original's agent and split (net × 10% × split),
-- recorded as a separate negative record linked to it, paid with the original's payouts (a policy's
-- weekly, an endorsement's monthly). The original is never changed.
create or replace function public.approve_commission_cancellation(p_id uuid, p_returned_net_cents bigint, p_carrier_adjustment_cents bigint,
  p_note text default null, p_without_proof_reason text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  c public.commission_cancellations := public.finance_lock_cancellation(p_id);
  t public.commission_transactions;
  remaining bigint;
  new_id uuid;
  no_proof boolean := cardinality(c.document_ids) = 0;
begin
  select * into t from public.commission_transactions where id = c.transaction_id for update;
  if t.verification_status <> 'verified' and t.settlement <> 'settled_outside' then
    raise exception 'Verify the original policy first (or void it if it was never written).' using errcode = '22023';
  end if;
  if p_returned_net_cents is null or p_returned_net_cents <= 0 then raise exception 'Enter the actual net premium returned by the carrier.' using errcode = '22023'; end if;
  if p_carrier_adjustment_cents is null or p_carrier_adjustment_cents < 0 then raise exception 'Enter the actual carrier commission returned (0 if none).' using errcode = '22023'; end if;
  remaining := public.finance_remaining_net(t.id);
  -- An endorsement's refund also has to fit in what's left on its policy (a policy cancellation may have returned it).
  if t.kind = 'endorsement' and t.original_transaction_id is not null then remaining := least(remaining, public.finance_remaining_net(t.original_transaction_id)); end if;
  if p_returned_net_cents > remaining then
    raise exception 'That''s more than the % net premium left on the policy.', to_char(remaining / 100.0, 'FM999,999,999,990.00') using errcode = '22023';
  end if;
  if no_proof then perform public.finance_require_text(p_without_proof_reason, 'Approving without the cancellation notice is an exception: give the reason.'); end if;
  insert into public.commission_transactions (
    agency_id, submission_id, client_name, quote_id, kind, stream, origin, original_transaction_id, cancellation_id, policy_number, carrier_name, carrier_key, business_type,
    event_date, payable_from, net_cents, agent_user_id, agent_name, agent_rate, agent_cents, carrier_rate, carrier_rate_id, carrier_rate_source, carrier_cents,
    recorded_snapshot, proof_status, verification_status, verified_by, verified_at, verified_without_proof, verification_reason, created_by)
  values (
    t.agency_id, t.submission_id, t.client_name, t.quote_id, 'cancellation', t.stream, 'admin', t.id, c.id, t.policy_number, t.carrier_name, t.carrier_key, t.business_type,
    c.effective_date, current_date, -p_returned_net_cents, t.agent_user_id, t.agent_name, t.agent_rate, public.finance_agent_cents(-p_returned_net_cents, t.agent_rate),
    t.carrier_rate, t.carrier_rate_id, 'actual', -p_carrier_adjustment_cents,
    jsonb_build_object('cancelType', c.cancel_type, 'effectiveDate', c.effective_date, 'returnedNetCents', p_returned_net_cents, 'carrierAdjustmentCents', p_carrier_adjustment_cents),
    case when no_proof then 'missing_proof' else 'has_proof' end, 'verified', auth.uid(), now(), no_proof,
    coalesce(nullif(btrim(coalesce(p_without_proof_reason, '')), ''), nullif(btrim(coalesce(p_note, '')), '')), auth.uid())
  returning id into new_id;
  update public.commission_cancellations
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         returned_net_cents = p_returned_net_cents, carrier_adjustment_cents = p_carrier_adjustment_cents, result_transaction_id = new_id
   where id = c.id;
  perform public.finance_audit(t.agency_id, 'cancellation_approved', 'cancellation', c.id::text, coalesce(p_without_proof_reason, p_note),
    jsonb_build_object('transaction', new_id, 'returnedNetCents', p_returned_net_cents, 'carrierAdjustmentCents', p_carrier_adjustment_cents, 'withoutProof', no_proof));
  return new_id;
end $$;

-- ───────────────────────────── what agents see ─────────────────────────────

-- The signed-in agent's own commissions: no carrier rate, no carrier commission.
create or replace function public.my_commissions()
returns table (id uuid, kind text, submission_id text, client_name text, policy_id text, policy_number text, carrier_name text, event_date date,
               payable_from date, expected_pay_date date, net_cents bigint, agent_rate numeric, agent_cents bigint, status text, original_transaction_id uuid)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.kind, t.submission_id, t.client_name, t.policy_id, t.policy_number, t.carrier_name, t.event_date, t.payable_from,
         public.finance_pay_date(t.agency_id, t.stream, t.payable_from), t.net_cents, t.agent_rate, t.agent_cents, public.finance_status(t), t.original_transaction_id
    from public.commission_transactions t
   where auth.uid() is not null and t.agency_id = public.current_agency_id() and t.agent_user_id = auth.uid() and t.replaced_by is null
   order by t.event_date desc, t.created_at desc
$$;

-- Commission status of an account's policies, for its agent and the agency's admins (others see nothing).
create or replace function public.account_commission_statuses(p_submission_id text)
returns table (transaction_id uuid, policy_id text, kind text, status text, flags text[], expected_pay_date date, agent_cents bigint)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.policy_id, t.kind, public.finance_status(t),
         array(select f from unnest(t.review_flags) f where f in ('unlinked_endorsement', 'changed_since_recorded', 'removed', 'no_agent', 'no_agent_rate')),
         public.finance_pay_date(t.agency_id, t.stream, t.payable_from), t.agent_cents
    from public.commission_transactions t
   where auth.uid() is not null and t.agency_id = public.current_agency_id() and t.submission_id = p_submission_id and t.policy_id is not null and t.replaced_by is null
     and (public.is_agency_admin() or t.agent_user_id = auth.uid())
$$;

-- Cancellation requests the signed-in user made, or on their own policies.
create or replace function public.my_commission_cancellations()
returns table (id uuid, transaction_id uuid, submission_id text, cancel_type text, effective_date date, reason text, expected_refund_cents bigint, status text,
               requested_at timestamptz, decided_at timestamptz, decision_note text, returned_net_cents bigint, agent_adjustment_cents bigint)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.transaction_id, c.submission_id, c.cancel_type, c.effective_date, c.reason, c.expected_refund_cents, c.status, c.requested_at, c.decided_at,
         c.decision_note, c.returned_net_cents, r.agent_cents
    from public.commission_cancellations c
    join public.commission_transactions t on t.id = c.transaction_id
    left join public.commission_transactions r on r.id = c.result_transaction_id
   where auth.uid() is not null and c.agency_id = public.current_agency_id() and (c.requested_by = auth.uid() or t.agent_user_id = auth.uid())
   order by c.requested_at desc
$$;

-- Expected payout date (for the admin screens; the same rule as above).
create or replace function public.commission_pay_date(p_stream text, p_date date) returns date
language sql stable security definer set search_path = ''
as $$ select public.finance_pay_date(public.current_agency_id(), p_stream, p_date) $$;

revoke all on function public.verify_commission(uuid, text), public.confirm_historical_commission(uuid, uuid, numeric, numeric, text),
  public.resolve_commission_agent(uuid, uuid, numeric, text),
  public.link_commission_endorsement(uuid, uuid), public.acknowledge_commission_changes(uuid, text), public.void_commission(uuid, text),
  public.rerecord_commission(uuid, text, boolean), public.correct_commission(uuid, bigint, text), public.settle_commissions_outside(uuid[], text, integer),
  public.record_carrier_receipt(uuid, bigint, date, text, text), public.void_carrier_receipt(uuid, text),
  public.set_finance_payout_schedule(integer, integer, text, integer, integer, text),
  public.request_commission_cancellation(uuid, text, date, text, bigint, text[]), public.withdraw_commission_cancellation(uuid),
  public.mark_cancellation_awaiting_amount(uuid, text), public.reject_commission_cancellation(uuid, text),
  public.approve_commission_cancellation(uuid, bigint, bigint, text, text),
  public.my_commissions(), public.account_commission_statuses(text), public.my_commission_cancellations(), public.commission_pay_date(text, date)
  from public, anon;
grant execute on function public.verify_commission(uuid, text), public.confirm_historical_commission(uuid, uuid, numeric, numeric, text),
  public.resolve_commission_agent(uuid, uuid, numeric, text),
  public.link_commission_endorsement(uuid, uuid), public.acknowledge_commission_changes(uuid, text), public.void_commission(uuid, text),
  public.rerecord_commission(uuid, text, boolean), public.correct_commission(uuid, bigint, text), public.settle_commissions_outside(uuid[], text, integer),
  public.record_carrier_receipt(uuid, bigint, date, text, text), public.void_carrier_receipt(uuid, text),
  public.set_finance_payout_schedule(integer, integer, text, integer, integer, text),
  public.request_commission_cancellation(uuid, text, date, text, bigint, text[]), public.withdraw_commission_cancellation(uuid),
  public.mark_cancellation_awaiting_amount(uuid, text), public.reject_commission_cancellation(uuid, text),
  public.approve_commission_cancellation(uuid, bigint, bigint, text, text),
  public.my_commissions(), public.account_commission_statuses(text), public.my_commission_cancellations(), public.commission_pay_date(text, date)
  to authenticated;

notify pgrst, 'reload schema';
