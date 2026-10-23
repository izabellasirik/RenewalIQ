-- 0072: "Possible existing account" when a broker creates an account (New Account, by hand or from documents).
--
-- find_account_duplicates(name, dot, mc) compares what the broker is about to create with the accounts of the
-- caller's OWN agency (or, with no agency, only the caller's own personal accounts) — never another agency's.
-- It only reads: nothing is merged, changed or deleted, and the broker decides (open the existing account,
-- or create a separate one anyway).
--
-- What comes back, per match (at most 5):
--   * accounts the caller may open: the account id, name, assigned broker and the reasons;
--   * accounts the caller may NOT open: only the name, the assigned broker and the reasons — no id, USDOT,
--     MC, address, contacts, documents or notes — and only for strong matches (same USDOT, same MC, same name
--     after normalizing, or the same words reordered). Similar-name matches are never returned for them,
--     so typing partial names can't list other brokers' accounts.
-- Rules (mirrored in src/services/accounts/duplicateCheck.ts):
--   * same USDOT or same MC number (digits, no leading zeros) → match;
--   * otherwise both have a USDOT (or both an MC) and they differ → a different business, no match;
--   * otherwise same normalized name, same words in another order, or (openable accounts only) a similar
--     name: letter-pair (Dice) similarity of the word-sorted name ≥ 0.85, both names ≥ 6 letters.
-- Names under 3 letters aren't compared. Intake import's check (0039) is unchanged.
--
-- Additive; safe to run more than once. Needs 0011 and 0026. Rollback: supabase/release/rollback_0072.sql.

-- Lower case, '&' as 'and', punctuation and common legal suffixes / a leading "the" dropped.
create or replace function public.normalize_account_name(p text) returns text
language sql immutable set search_path = ''
as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           replace(lower(coalesce(p, '')), '&', ' and '),
           '[^a-z0-9 ]+', ' ', 'g'),
           '\m(l l c|l l p|l p)\M', ' ', 'g'),
           '\m(llc|llp|lp|pllc|plc|inc|incorporated|corp|corporation|co|company|ltd|limited)\M', ' ', 'g'),
           '^\s*the\s+', ' '),
         '\s+', ' ', 'g')), '')
$$;

-- The normalized name's words in alphabetical order ("trucking abc" = "abc trucking").
create or replace function public.account_name_key(p text) returns text
language sql immutable set search_path = ''
as $$
  select nullif(string_agg(w, ' ' order by w), '')
    from unnest(string_to_array(coalesce(public.normalize_account_name(p), ''), ' ')) as w
   where w <> ''
$$;

-- Dice coefficient of the letter pairs of two strings (spaces ignored), 0..1.
create or replace function public.account_name_similarity(a text, b text) returns numeric
language sql immutable set search_path = ''
as $$
  with x as (select replace(coalesce(a, ''), ' ', '') as s), y as (select replace(coalesce(b, ''), ' ', '') as s),
  ga as (select substr(x.s, i, 2) as g, count(*) as n from x, generate_series(1, greatest(length(x.s) - 1, 0)) i group by 1),
  gb as (select substr(y.s, i, 2) as g, count(*) as n from y, generate_series(1, greatest(length(y.s) - 1, 0)) i group by 1),
  tot as (select (select coalesce(sum(n), 0) from ga) + (select coalesce(sum(n), 0) from gb) as t)
  select case when (select t from tot) = 0 then 0
              else round(2.0 * coalesce((select sum(least(ga.n, gb.n)) from ga join gb using (g)), 0) / (select t from tot), 3) end
$$;

create or replace function public.find_account_duplicates(p_name text, p_dot text default null, p_mc text default null)
returns table (account_id text, named_insured text, assigned_user_id uuid, assigned_name text, can_open boolean, archived boolean,
               reasons text[], similarity numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_agency uuid;
  v_dot text := nullif(ltrim(regexp_replace(coalesce(p_dot, ''), '\D', '', 'g'), '0'), '');
  v_mc text := nullif(ltrim(regexp_replace(coalesce(p_mc, ''), '\D', '', 'g'), '0'), '');
  v_name text := public.normalize_account_name(p_name);
  v_key text := public.account_name_key(p_name);
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if length(coalesce(v_name, '')) < 3 then v_name := null; v_key := null; end if;
  if v_dot is null and v_mc is null and v_name is null then
    return;
  end if;
  v_agency := public.current_agency_id();

  return query
  with scoped as (
    select s.* from public.submissions s
     where (v_agency is not null and s.organization_id = v_agency)
        or (s.organization_id is null and s.user_id = v_uid)
  ), ids as (
    select s.id,
           (select nullif(ltrim(regexp_replace(coalesce(fv.value #>> '{}', ''), '\D', '', 'g'), '0'), '') from public.field_values fv
             where fv.submission_id = s.id and fv.section = 'transportation' and fv.field_key = 'dotNumber' limit 1) as dot,
           (select nullif(ltrim(regexp_replace(coalesce(fv.value #>> '{}', ''), '\D', '', 'g'), '0'), '') from public.field_values fv
             where fv.submission_id = s.id and fv.section = 'transportation' and fv.field_key = 'mcNumber' limit 1) as mc,
           public.normalize_account_name(s.named_insured) as nname,
           public.account_name_key(s.named_insured) as nkey,
           public.submission_visible_with_collaborators(s.organization_id, s.assigned_user_id, s.user_id, s.collaborator_ids) as open
      from scoped s
  ), scored as (
    select i.*,
           (v_dot is not null and i.dot = v_dot) as same_dot,
           (v_mc is not null and i.mc = v_mc) as same_mc,
           ((v_dot is not null and i.dot is not null and i.dot <> v_dot) or (v_mc is not null and i.mc is not null and i.mc <> v_mc)) as conflict,
           (v_name is not null and i.nname = v_name) as same_name,
           (v_key is not null and i.nkey = v_key and i.nname is distinct from v_name) as reordered,
           case when v_key is not null and i.nkey is not null and length(replace(v_key, ' ', '')) >= 6 and length(replace(i.nkey, ' ', '')) >= 6
                then public.account_name_similarity(v_key, i.nkey) end as sim
      from ids i
  ), matched as (
    select sc.*,
           array_remove(array[
             case when sc.same_dot then 'same_dot' end,
             case when sc.same_mc then 'same_mc' end,
             case when not sc.conflict and sc.same_name then 'same_name' end,
             case when not sc.conflict and sc.reordered then 'reordered_name' end,
             case when not sc.conflict and sc.open and not sc.same_name and not sc.reordered and coalesce(sc.sim, 0) >= 0.85 then 'similar_name' end
           ], null) as why
      from scored sc
  )
  select case when m.open then s.id end,
         s.named_insured,
         coalesce(s.assigned_user_id, s.user_id),
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = coalesce(s.assigned_user_id, s.user_id)),
         m.open,
         coalesce(s.archived, false),
         m.why,
         case when m.open then m.sim end
    from matched m join scoped s on s.id = m.id
   where cardinality(m.why) > 0
   order by (m.same_dot or m.same_mc) desc, (m.same_name or m.reordered) desc, m.sim desc nulls last, s.updated_at desc
   limit 5;
end;
$$;
revoke all on function public.find_account_duplicates(text, text, text) from public, anon;
grant execute on function public.find_account_duplicates(text, text, text) to authenticated;
revoke all on function public.normalize_account_name(text), public.account_name_key(text), public.account_name_similarity(text, text) from public, anon;
grant execute on function public.normalize_account_name(text), public.account_name_key(text), public.account_name_similarity(text, text) to authenticated;
