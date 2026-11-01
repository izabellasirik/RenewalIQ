-- Rollback of 0086: admins mark payments again (0084); the Agency Owner is forgotten.
begin;
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

drop function if exists public.set_agency_owner(uuid, uuid);
drop function if exists public.set_agency_owner(uuid, uuid, boolean);
drop function if exists public.is_agency_owner();
drop table if exists public.agency_owners;
notify pgrst, 'reload schema';
commit;
