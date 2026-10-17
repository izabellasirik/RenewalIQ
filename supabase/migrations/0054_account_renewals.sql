-- Renewal tracking on the account: whether the client came in as a new venture or a renewal, and the
-- renewals being tracked for it (one per policy term — see src/services/workflow/renewals.ts).
--
-- The account's main renewal date is NOT stored here: it stays the Risk Profile's Renewal / effective
-- date. A renewal for another policy (another line or carrier renewing on another date) carries its
-- own date inside `renewals`. A renewal is closed only by a market bound for it.
--
-- Two columns on submissions, like account_notes (0020) and loss_runs (0025): who can see and save the
-- account is unchanged (no new policies). Accounts from before keep business_type null and renewals
-- empty, and their renewal reminder works exactly as before.
--
-- Who sets up renewals is enforced here too (submissions_renewal_guard): the assigned broker, an
-- agency admin, or — on a personal or unassigned account — whoever created it. Someone only helping on
-- the account can do what binding or un-binding a market does (a renewal renewed by a market, or open
-- again), nothing else:
-- their changes to the type, dates, start dates, labels, or the list itself are quietly kept as they
-- were — like the archive guard (0021) — so a helper's ordinary save never fails.
-- The account's main renewal date is the Risk Profile's effective date: on an account that tracks
-- renewals it's guarded the same way (field_values / field_alternates triggers), so a helper's save —
-- which rewrites every Risk Profile row (0028) — keeps the date as it was. On an account that doesn't
-- track renewals the effective date stays an ordinary Risk Profile field, as before.
--
-- Additive; safe to run more than once. The app saves without these columns until it's applied.

alter table public.submissions add column if not exists business_type text;
alter table public.submissions drop constraint if exists submissions_business_type_check;
alter table public.submissions add constraint submissions_business_type_check check (business_type is null or business_type in ('new_venture', 'renewal'));

alter table public.submissions add column if not exists renewals jsonb not null default '[]'::jsonb;
alter table public.submissions drop constraint if exists submissions_renewals_array;
alter table public.submissions add constraint submissions_renewals_array check (jsonb_typeof(renewals) = 'array');

create or replace function public.can_manage_renewals(p_agency_id uuid, p_assigned_user_id uuid, p_creator_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when auth.uid() is null then false
      when p_agency_id is null then p_creator_id = auth.uid()
      when p_agency_id = public.current_agency_id() and public.is_agency_admin() then true
      else coalesce(p_assigned_user_id, p_creator_id) = auth.uid()
    end,
    false)
$$;

create or replace function public.submissions_renewal_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o jsonb;
  n jsonb;
  kept jsonb := '[]'::jsonb;
begin
  -- SQL editor / service role: leave alone.
  if auth.uid() is null then
    return new;
  end if;
  if public.can_manage_renewals(old.organization_id, old.assigned_user_id, old.user_id) then
    return new;
  end if;
  new.business_type := old.business_type;
  if new.renewals is not distinct from old.renewals then
    return new;
  end if;
  -- Each renewal as it was, taking only what binding a market changes. Renewals the helper added are
  -- left out; ones they removed stay.
  for o in select value from jsonb_array_elements(old.renewals) loop
    n := (select value from jsonb_array_elements(new.renewals) where value->>'id' = o->>'id' limit 1);
    -- Bound by a market, or open again; never "not renewing" (that's the broker's call).
    if n is not null and (o->>'status') in ('open', 'bound') and ((n->>'status') = 'open' or ((n->>'status') = 'bound' and n->>'boundQuoteId' is not null)) then
      if (n->>'status') is distinct from (o->>'status') or (n->>'boundQuoteId') is distinct from (o->>'boundQuoteId') then
        o := (o - 'status' - 'boundQuoteId' - 'closedAt' - 'updatedAt')
          || jsonb_strip_nulls(jsonb_build_object('status', n->'status', 'boundQuoteId', n->'boundQuoteId', 'closedAt', n->'closedAt', 'updatedAt', n->'updatedAt'));
        -- The main renewal keeps the date it was for when it closes — the account's own date, not one
        -- sent by the helper — and follows the account's date again when reopened.
        if coalesce((o->>'main')::boolean, false) then
          o := o - 'renewalDate';
          if (n->>'status') = 'bound' then
            o := o || coalesce((select jsonb_build_object('renewalDate', fv.value #>> '{}') from public.field_values fv
                                 where fv.submission_id = old.id and fv.section = 'business' and fv.field_key = 'effectiveDate'
                                   and fv.value #>> '{}' ~ '^\d{4}-\d{2}-\d{2}$' limit 1), '{}'::jsonb);
          end if;
        end if;
      end if;
    end if;
    kept := kept || jsonb_build_array(o);
  end loop;
  new.renewals := kept;
  return new;
end;
$$;

drop trigger if exists submissions_renewal_guard on public.submissions;
create trigger submissions_renewal_guard before update of business_type, renewals on public.submissions
  for each row execute function public.submissions_renewal_guard();

-- Whether the signed-in user may NOT change this account's renewal dates: it tracks renewals and they
-- aren't its assigned broker or an admin. The SQL editor / service role is never limited.
create or replace function public.renewal_dates_locked(p_submission_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and coalesce((
    select (s.business_type is not null or s.renewals <> '[]'::jsonb)
           and not public.can_manage_renewals(s.organization_id, s.assigned_user_id, s.user_id)
      from public.submissions s where s.id = p_submission_id), false)
$$;

-- The effective date row on such an account: a helper's update, delete or insert of it is skipped, so
-- the date stays as it was and the rest of their save goes through.
create or replace function public.field_values_renewal_date_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_date_old boolean := tg_op <> 'INSERT' and old.section = 'business' and old.field_key = 'effectiveDate';
  is_date_new boolean := tg_op <> 'DELETE' and new.section = 'business' and new.field_key = 'effectiveDate';
begin
  if tg_op = 'UPDATE' then
    if (is_date_old and public.renewal_dates_locked(old.submission_id)) or (is_date_new and public.renewal_dates_locked(new.submission_id)) then
      return old;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if is_date_old and public.renewal_dates_locked(old.submission_id) then
      return null;
    end if;
    return old;
  end if;
  if is_date_new and public.renewal_dates_locked(new.submission_id) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists field_values_renewal_date_guard on public.field_values;
create trigger field_values_renewal_date_guard before insert or update or delete on public.field_values
  for each row execute function public.field_values_renewal_date_guard();

-- Its conflict history goes with it (kept as it was too).
create or replace function public.field_alternates_renewal_date_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_id text := case when tg_op = 'DELETE' then old.field_value_id else new.field_value_id end;
  locked boolean;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select public.renewal_dates_locked(fv.submission_id) into locked
    from public.field_values fv where fv.id = parent_id and fv.section = 'business' and fv.field_key = 'effectiveDate';
  -- The date row itself was just refused (none existed): its history (id "<account>::business::effectiveDate") goes too.
  if locked is null and tg_op = 'INSERT' and parent_id like '%::business::effectiveDate' and not exists (select 1 from public.field_values where id = parent_id) then
    locked := public.renewal_dates_locked(split_part(parent_id, '::', 1));
  end if;
  if coalesce(locked, false) then
    return case when tg_op = 'UPDATE' then old else null end;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists field_alternates_renewal_date_guard on public.field_alternates;
create trigger field_alternates_renewal_date_guard before insert or update or delete on public.field_alternates
  for each row execute function public.field_alternates_renewal_date_guard();

notify pgrst, 'reload schema';
