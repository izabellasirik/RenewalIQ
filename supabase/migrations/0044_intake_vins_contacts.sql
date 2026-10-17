-- 0044_intake_vins_contacts.sql
-- The client intake form now asks for the fleet's VIN numbers (required, one or more) and lets the
-- client list more than one contact. Both are stored on the submission, like the other answers.
--
--   intake_submissions.vin_numbers          text[]  — upper-cased, letters/digits only, max 17
--                                                     characters each, at most 300, no duplicates.
--   intake_submissions.additional_contacts  jsonb   — [{name, email, phone}], at most 10, each value
--                                                     trimmed and length-capped; empty entries dropped.
--
-- start_intake_submission (0029) is re-created with the same signature, security and behaviour, and
-- now also saves these two answers. Additive; safe to re-run. Needs 0029 first.

alter table public.intake_submissions add column if not exists vin_numbers text[] not null default '{}';
alter table public.intake_submissions add column if not exists additional_contacts jsonb not null default '[]'::jsonb;

create or replace function public.intake_vins(p jsonb) returns text[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(v order by first_pos), '{}')
    from (
      select v, min(pos) as first_pos
        from (
          select left(upper(regexp_replace(x, '[^A-Za-z0-9]', '', 'g')), 17) as v, pos
            from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as e(x, pos)
           limit 300
        ) cleaned
       where v <> ''
       group by v
    ) d
$$;

create or replace function public.intake_contacts(p jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_agg(c order by pos), '[]'::jsonb)
    from (
      select jsonb_strip_nulls(jsonb_build_object(
               'name', public.intake_text(e->>'name', 200),
               'email', public.intake_text(e->>'email', 200),
               'phone', public.intake_text(e->>'phone', 60))) as c, pos
        from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as t(e, pos)
       where jsonb_typeof(e) = 'object'
       limit 10
    ) x
   where c <> '{}'::jsonb
$$;

create or replace function public.start_intake_submission(p_link_token text, p_client_token uuid, p_answers jsonb, p_expected_files integer)
returns table (submission_id text, reference text, status text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_link public.intake_links;
  v_sub public.intake_submissions;
  a jsonb := coalesce(p_answers, '{}'::jsonb);
  v_was text;
begin
  if p_client_token is null then
    raise exception 'Missing submission key.' using errcode = '22023';
  end if;

  select * into v_sub from public.intake_submissions s where s.client_token = p_client_token;
  if found then
    -- The same browser sending again (a retried request, a reload): the same submission, never a second one.
    select * into v_link from public.intake_links l where l.id = v_sub.intake_link_id;
    if v_link.token is distinct from p_link_token then
      raise exception 'This submission belongs to a different link.' using errcode = '42501';
    end if;
    v_was := v_sub.status;
    if v_sub.status in ('uploading', 'incomplete') then
      update public.intake_submissions s set
        status = 'uploading',
        last_activity_at = now(),
        expected_files = greatest(0, coalesce(p_expected_files, 0)),
        named_insured = public.intake_text(a->>'namedInsured'),
        contact_name = public.intake_text(a->>'contactName'),
        contact_email = public.intake_text(a->>'contactEmail'),
        contact_phone = public.intake_text(a->>'contactPhone'),
        dot_number = public.intake_text(a->>'dotNumber', 40),
        mc_number = public.intake_text(a->>'mcNumber', 40),
        years_in_business = public.intake_int(a->>'yearsInBusiness'),
        power_units = public.intake_int(a->>'powerUnits'),
        driver_count = public.intake_int(a->>'driverCount'),
        operation_type = public.intake_text(a->>'operationType'),
        commodities_hauled = public.intake_text(a->>'commoditiesHauled'),
        operating_radius = public.intake_text(a->>'operatingRadius'),
        operating_states = public.intake_text(a->>'operatingStates'),
        coverage_requested = coalesce(array(select left(x, 60) from jsonb_array_elements_text(coalesce(a->'coverageRequested', '[]'::jsonb)) x limit 10), '{}'),
        current_carrier = public.intake_text(a->>'currentCarrier'),
        effective_date = public.intake_text(a->>'effectiveDate', 20),
        additional_notes = public.intake_text(a->>'additionalNotes', 5000),
        vin_numbers = public.intake_vins(a->'vinNumbers'),
        additional_contacts = public.intake_contacts(a->'additionalContacts')
       where s.id = v_sub.id
      returning * into v_sub;
      if v_was = 'incomplete' then
        perform public.intake_log(v_sub.id, 'resumed', '{}'::jsonb);
      end if;
    end if;
    return query select v_sub.id, v_sub.reference, v_sub.status;
    return;
  end if;

  select * into v_link from public.intake_links l where l.token = p_link_token and l.active;
  if not found then
    raise exception 'This submission link isn''t valid or is no longer active.' using errcode = '42501';
  end if;

  insert into public.intake_submissions (
    id, intake_link_id, user_id, status, client_token, reference, expected_files, last_activity_at,
    named_insured, contact_name, contact_email, contact_phone, dot_number, mc_number,
    years_in_business, power_units, driver_count, operation_type, commodities_hauled,
    operating_radius, operating_states, coverage_requested, current_carrier, effective_date, additional_notes,
    vin_numbers, additional_contacts
  ) values (
    'isub_' || replace(gen_random_uuid()::text, '-', ''), v_link.id, v_link.user_id, 'uploading', p_client_token,
    'RIQ-' || lpad(nextval('public.intake_reference_seq')::text, 6, '0'), greatest(0, coalesce(p_expected_files, 0)), now(),
    public.intake_text(a->>'namedInsured'), public.intake_text(a->>'contactName'), public.intake_text(a->>'contactEmail'),
    public.intake_text(a->>'contactPhone'), public.intake_text(a->>'dotNumber', 40), public.intake_text(a->>'mcNumber', 40),
    public.intake_int(a->>'yearsInBusiness'), public.intake_int(a->>'powerUnits'), public.intake_int(a->>'driverCount'),
    public.intake_text(a->>'operationType'), public.intake_text(a->>'commoditiesHauled'), public.intake_text(a->>'operatingRadius'),
    public.intake_text(a->>'operatingStates'),
    coalesce(array(select left(x, 60) from jsonb_array_elements_text(coalesce(a->'coverageRequested', '[]'::jsonb)) x limit 10), '{}'),
    public.intake_text(a->>'currentCarrier'), public.intake_text(a->>'effectiveDate', 20), public.intake_text(a->>'additionalNotes', 5000),
    public.intake_vins(a->'vinNumbers'), public.intake_contacts(a->'additionalContacts')
  )
  returning * into v_sub;
  perform public.intake_log(v_sub.id, 'started', jsonb_build_object('expected_files', v_sub.expected_files));
  return query select v_sub.id, v_sub.reference, v_sub.status;
end;
$$;

revoke all on function public.start_intake_submission(text, uuid, jsonb, integer) from public;
grant execute on function public.start_intake_submission(text, uuid, jsonb, integer) to anon, authenticated;
