-- 0074 The carrier % entered on a policy / endorsement (0073): readable by those who may set it, and an
-- admin's "checked" tick ("Needs Review" → "Verified" in Analytics). Needs 0073.
--
-- - policy_carrier_rates(account): the entered % per policy / endorsement, with whether an admin checked it —
--   for the account's assigned agent and the agency's admins only (null account: every account they may see).
--   An endorsement's form starts from its policy's %.
-- - review_policy_carrier_rate(account, policy, checked): an admin ticks (or unticks) that the entered % is
--   right. Separate from verifying the commission (document check, payout), which is unchanged.
-- - Entering a different % clears the tick; entering the same % keeps it.
-- Nothing else changes: no commission record, amount or access rule. Re-runnable. Rollback: supabase/release/rollback_0074.sql.

do $$
begin
  if to_regclass('public.policy_carrier_commission') is null then raise exception '0074 needs 0073.'; end if;
end $$;

alter table public.policy_carrier_commission add column if not exists reviewed_by uuid references auth.users (id) on delete set null;
alter table public.policy_carrier_commission add column if not exists reviewed_at timestamptz;

-- 0073's function, plus: a changed % clears the admin's check.
create or replace function public.enter_policy_carrier_rate(p_submission_id text, p_policy_id text, p_rate numeric) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s public.submissions;
  t public.commission_transactions;
  cr public.carrier_commission_rates;
  fl text[];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into s from public.submissions x where x.id = p_submission_id;
  if s.id is null or s.organization_id is null or s.organization_id is distinct from public.current_agency_id()
     or not (public.is_agency_admin() or s.assigned_user_id = auth.uid()) then
    raise exception 'Only the assigned agent or an agency admin can set the carrier %% on this account.' using errcode = '42501';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate > 0.5 then
    raise exception 'Enter a carrier %% above 0%% and at most 50%%.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_policy_id, '')), '') is null then raise exception 'Missing policy.' using errcode = '22023'; end if;

  select * into t from public.commission_transactions x
   where x.agency_id = s.organization_id and x.submission_id = s.id and x.policy_id = p_policy_id and x.replaced_by is null
     and x.verification_status <> 'void'
   for update;
  if t.id is not null and (t.verification_status <> 'unverified' or t.settlement <> 'open' or t.origin = 'historical') then
    return 'locked';
  end if;

  insert into public.policy_carrier_commission (agency_id, submission_id, policy_id, rate, set_by)
  values (s.organization_id, s.id, p_policy_id, p_rate, auth.uid())
  on conflict (submission_id, policy_id) do update set rate = excluded.rate, set_by = excluded.set_by, set_at = now(), agency_id = excluded.agency_id,
    -- A different % needs checking again (0074); the same % keeps its check.
    reviewed_at = case when public.policy_carrier_commission.rate = excluded.rate then public.policy_carrier_commission.reviewed_at end,
    reviewed_by = case when public.policy_carrier_commission.rate = excluded.rate then public.policy_carrier_commission.reviewed_by end;
  if t.id is null then return 'saved'; end if;

  cr := public.carrier_rate_on(t.agency_id, t.carrier_key, t.event_date);
  fl := array_remove(array_remove(t.review_flags, 'no_carrier_rate'), 'carrier_rate_differs');
  if cr.id is not null and cr.rate <> p_rate then fl := fl || 'carrier_rate_differs'::text; end if;
  perform set_config('renewaliq.finance_op', 'policy_carrier_rate', true);
  update public.commission_transactions
     set carrier_rate = p_rate, carrier_rate_id = null, carrier_rate_source = 'policy_rate', carrier_cents = public.finance_apply_rate(t.net_cents, p_rate),
         agent_cents = public.finance_agent_cents(t.net_cents, p_rate, t.agent_rate), review_flags = fl
   where id = t.id;
  perform set_config('renewaliq.finance_op', '', true);
  perform public.finance_audit(t.agency_id, 'policy_carrier_rate_set', 'transaction', t.id::text, null,
    jsonb_build_object('from', t.carrier_rate, 'to', p_rate, 'source', t.carrier_rate_source));
  return 'applied';
end $$;

create or replace function public.policy_carrier_rates(p_submission_id text default null)
returns table (submission_id text, policy_id text, rate numeric, reviewed boolean, reviewed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.submission_id, r.policy_id, r.rate, r.reviewed_at is not null, r.reviewed_at
    from public.policy_carrier_commission r
    join public.submissions s on s.id = r.submission_id
   where auth.uid() is not null
     and (p_submission_id is null or r.submission_id = p_submission_id)
     and s.organization_id is not null and s.organization_id = public.current_agency_id() and r.agency_id = s.organization_id
     and (public.is_agency_admin() or s.assigned_user_id = auth.uid())
$$;
revoke all on function public.policy_carrier_rates(text) from public, anon;
grant execute on function public.policy_carrier_rates(text) to authenticated;

create or replace function public.review_policy_carrier_rate(p_submission_id text, p_policy_id text, p_checked boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  r public.policy_carrier_commission;
begin
  if auth.uid() is null or not public.is_agency_admin() then
    raise exception 'Only an agency admin can check a carrier %%.' using errcode = '42501';
  end if;
  select * into r from public.policy_carrier_commission x where x.submission_id = p_submission_id and x.policy_id = p_policy_id for update;
  if r.submission_id is null or r.agency_id is distinct from public.current_agency_id() then
    raise exception 'No carrier %% entered on that policy.' using errcode = '42501';
  end if;
  update public.policy_carrier_commission
     set reviewed_at = case when p_checked then now() end, reviewed_by = case when p_checked then auth.uid() end
   where submission_id = p_submission_id and policy_id = p_policy_id;
  perform public.finance_audit(r.agency_id, case when p_checked then 'policy_carrier_rate_checked' else 'policy_carrier_rate_unchecked' end,
    'policy', p_submission_id || '|' || p_policy_id, null, jsonb_build_object('rate', r.rate));
  return p_checked;
end $$;
revoke all on function public.review_policy_carrier_rate(text, text, boolean) from public, anon;
grant execute on function public.review_policy_carrier_rate(text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
