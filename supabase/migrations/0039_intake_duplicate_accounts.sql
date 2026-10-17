-- "Possible existing account" before importing a client intake submission.
--
-- Returns the accounts in the SAME organization as the submission that could be the same business —
-- same DOT number, or the same company name — with what the app compares (DOT, whether the contact email or
-- phone matches, and — only for accounts the caller may open — the address), whose account it is, and whether the caller may open it. The app then decides
-- whether it is a likely match (services/intake/duplicateDetection.ts) and the broker chooses:
-- add the submission to that account, open it, or create a new account anyway. Nothing is merged or
-- changed here, and the submission and its files are untouched.
--
-- Scope: the organization of the broker whose link the submission came through (their agency, or —
-- with no agency — only that broker's own personal accounts). Only someone who can see the
-- submission (its broker, or an admin of that agency — 0036/0038) may ask. Accounts in other
-- organizations are never compared or returned.
--
-- Additive; safe to run more than once. Must run after 0038.

create or replace function public.normalize_company_name(p text) returns text
language sql immutable set search_path = ''
as $$
  select nullif(btrim(regexp_replace(regexp_replace(
           regexp_replace(lower(coalesce(p, '')), '[^a-z0-9 ]+', ' ', 'g'),
           '\m(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited)\M', ' ', 'g'),
         '\s+', ' ', 'g')), '')
$$;

create or replace function public.find_intake_duplicate_accounts(p_intake_submission_id text)
returns table (account_id text, named_insured text, dot_number text, address text, email_match boolean, phone_match boolean,
               assigned_user_id uuid, assigned_name text, can_open boolean, archived boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.intake_submissions;
  v_agency uuid;
  v_dot text;
  v_name text;
  v_email text;
  v_phone text;
begin
  select * into v from public.intake_submissions s where s.id = p_intake_submission_id;
  if not found or not public.can_manage_intake_link(v.user_id) then
    raise exception 'You can''t see this submission.' using errcode = '42501';
  end if;
  select p.agency_id into v_agency from public.profiles p where p.user_id = v.user_id;
  v_dot := nullif(regexp_replace(coalesce(v.dot_number, ''), '\D', '', 'g'), '');
  v_name := public.normalize_company_name(v.named_insured);
  v_email := lower(nullif(btrim(v.contact_email), ''));
  v_phone := right(nullif(regexp_replace(coalesce(v.contact_phone, ''), '\D', '', 'g'), ''), 10);
  if v_dot is null and v_name is null then
    return;
  end if;

  return query
  with scoped as (
    select s.* from public.submissions s
     where (v_agency is not null and s.organization_id = v_agency)
        or (v_agency is null and s.organization_id is null and s.user_id = v.user_id)
  ), ids as (
    select s.id,
           nullif(regexp_replace(coalesce((select fv.value #>> '{}' from public.field_values fv
                                            where fv.submission_id = s.id and fv.section = 'transportation' and fv.field_key = 'dotNumber' limit 1), ''), '\D', '', 'g'), '') as dot,
           (select string_agg(fv.value #>> '{}', ', ' order by case fv.field_key when 'address' then 1 when 'city' then 2 when 'state' then 3 else 4 end)
              from public.field_values fv
             where fv.submission_id = s.id and fv.section = 'business' and fv.field_key in ('address', 'city', 'state', 'zip')
               and nullif(btrim(fv.value #>> '{}'), '') is not null) as addr
      from scoped s
  )
  select s.id, s.named_insured, i.dot,
         -- The address only for an account the caller may open; for others just whether email/phone match.
         case when public.submission_visible_with_collaborators(s.organization_id, s.assigned_user_id, s.user_id, s.collaborator_ids) then i.addr end,
         coalesce(v_email is not null and (lower(btrim(s.contact_email)) = v_email
           or exists (select 1 from jsonb_array_elements(coalesce(s.contacts, '[]'::jsonb)) c where lower(btrim(c->>'email')) = v_email)), false),
         coalesce(length(coalesce(v_phone, '')) >= 7 and (right(regexp_replace(coalesce(s.contact_phone, ''), '\D', '', 'g'), 10) = v_phone
           or exists (select 1 from jsonb_array_elements(coalesce(s.contacts, '[]'::jsonb)) c where right(regexp_replace(coalesce(c->>'phone', ''), '\D', '', 'g'), 10) = v_phone)), false),
         coalesce(s.assigned_user_id, s.user_id),
         (select coalesce(nullif(btrim(p.display_name), ''), p.email) from public.profiles p where p.user_id = coalesce(s.assigned_user_id, s.user_id)),
         public.submission_visible_with_collaborators(s.organization_id, s.assigned_user_id, s.user_id, s.collaborator_ids),
         coalesce(s.archived, false)
    from scoped s join ids i on i.id = s.id
   where (v_dot is not null and i.dot = v_dot)
      or (v_name is not null and public.normalize_company_name(s.named_insured) = v_name)
   order by (v_dot is not null and i.dot = v_dot) desc, s.updated_at desc
   limit 10;
end;
$$;
revoke all on function public.find_intake_duplicate_accounts(text) from public, anon;
grant execute on function public.find_intake_duplicate_accounts(text) to authenticated;
