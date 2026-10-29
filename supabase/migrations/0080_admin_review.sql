-- 0080 Admin Review: things an agency admin should look at, starting with possible duplicate accounts. Needs 0026, 0072.
--
-- When an AGENT saves a new agency account (by hand, from documents or from an intake import) that looks like
-- one the agency already has — same USDOT, same MC, the same name, or the same words reordered (0072's strong
-- rules; "similar names" aren't flagged) — the database records it for review and notifies every admin of the
-- agency (the bell), linking to it. Admins decide: keep both, or archive the new one. Nothing is merged or
-- deleted. An admin's own accounts aren't flagged. A new match on a later save (e.g. the USDOT added) is
-- flagged once; matches already reviewed aren't flagged again.
-- Admins read and decide through admin_review_items() / resolve_admin_review(); the table isn't readable
-- directly. Additive and re-runnable. Rollback: supabase/release/rollback_0080.sql.

do $$
begin
  if to_regclass('public.notifications') is null or to_regprocedure('public.account_name_key(text)') is null then
    raise exception '0080 needs 0026 and 0072.';
  end if;
end $$;

-- A notification can point at a review item (opens Admin Review there).
alter table public.notifications add column if not exists review_item_id uuid;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in ('assigned', 'collaborator_added', 'admin_review'));

create or replace function public.notifications_read_only_fields() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Everything but read_at stays as the database wrote it.
  new.id := old.id;
  new.user_id := old.user_id;
  new.type := old.type;
  new.submission_id := old.submission_id;
  new.message := old.message;
  new.actor_name := old.actor_name;
  new.created_at := old.created_at;
  new.review_item_id := old.review_item_id;
  return new;
end;
$$;

create table if not exists public.admin_review_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  kind text not null check (kind in ('possible_duplicate')),
  -- The account that was created, and the existing ones it may duplicate.
  submission_id text not null,
  related_ids text[] not null default '{}',
  detail jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution in ('kept_both', 'archived_new')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz
);
create index if not exists admin_review_items_agency_idx on public.admin_review_items (agency_id, status, created_at desc);
create index if not exists admin_review_items_submission_idx on public.admin_review_items (submission_id);
alter table public.admin_review_items enable row level security;
revoke all on public.admin_review_items from public, anon, authenticated;

-- The agency's other accounts this one strongly matches (0072's strong rules), with the reasons.
create or replace function public.admin_review_duplicates_of(p_id text)
returns table (account_id text, reasons text[])
language sql stable security definer set search_path = ''
as $$
  with me as (
    select s.id, s.organization_id, public.normalize_account_name(s.named_insured) as nname, public.account_name_key(s.named_insured) as nkey,
           (select nullif(ltrim(regexp_replace(coalesce(fv.value #>> '{}', ''), '\D', '', 'g'), '0'), '') from public.field_values fv
             where fv.submission_id = s.id and fv.section = 'transportation' and fv.field_key = 'dotNumber' limit 1) as dot,
           (select nullif(ltrim(regexp_replace(coalesce(fv.value #>> '{}', ''), '\D', '', 'g'), '0'), '') from public.field_values fv
             where fv.submission_id = s.id and fv.section = 'transportation' and fv.field_key = 'mcNumber' limit 1) as mc
      from public.submissions s where s.id = p_id
  ), others as (
    select o.id, public.normalize_account_name(o.named_insured) as nname, public.account_name_key(o.named_insured) as nkey,
           (select nullif(ltrim(regexp_replace(coalesce(fv.value #>> '{}', ''), '\D', '', 'g'), '0'), '') from public.field_values fv
             where fv.submission_id = o.id and fv.section = 'transportation' and fv.field_key = 'dotNumber' limit 1) as dot,
           (select nullif(ltrim(regexp_replace(coalesce(fv.value #>> '{}', ''), '\D', '', 'g'), '0'), '') from public.field_values fv
             where fv.submission_id = o.id and fv.section = 'transportation' and fv.field_key = 'mcNumber' limit 1) as mc
      from public.submissions o, me
     where o.organization_id = me.organization_id and o.id <> me.id
  )
  select o.id,
         array_remove(array[
           case when me.dot is not null and o.dot = me.dot then 'same_dot' end,
           case when me.mc is not null and o.mc = me.mc then 'same_mc' end,
           case when not conflict and length(coalesce(me.nname, '')) >= 3 and o.nname = me.nname then 'same_name' end,
           case when not conflict and length(coalesce(me.nname, '')) >= 3 and o.nkey = me.nkey and o.nname is distinct from me.nname then 'reordered_name' end
         ], null)
    from me, others o,
         lateral (select ((me.dot is not null and o.dot is not null and o.dot <> me.dot) or (me.mc is not null and o.mc is not null and o.mc <> me.mc)) as conflict) c
   where (me.dot is not null and o.dot = me.dot) or (me.mc is not null and o.mc = me.mc)
      or (not c.conflict and length(coalesce(me.nname, '')) >= 3 and (o.nname = me.nname or o.nkey = me.nkey))
   limit 5
$$;
revoke all on function public.admin_review_duplicates_of(text) from public, anon, authenticated;

-- Flags an agent's new account if it may duplicate one the agency has, and tells the admins. Never raises.
create or replace function public.admin_review_check_duplicate(p_id text, p_actor uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.submissions;
  matches record;
  ids text[];
  reasons jsonb;
  seen text[];
  fresh text[];
  open_item uuid;
  item uuid;
  actor_name text;
  first_name text;
begin
  select * into s from public.submissions where id = p_id;
  if s.id is null or s.organization_id is null or p_actor is null then return; end if;
  -- Admins' own accounts aren't flagged (they review these themselves).
  if exists (select 1 from public.profiles p where p.user_id = p_actor and p.agency_id = s.organization_id and p.role = 'admin') then return; end if;
  select coalesce(array_agg(d.account_id), '{}'), coalesce(jsonb_object_agg(d.account_id, to_jsonb(d.reasons)), '{}'::jsonb) into ids, reasons
    from public.admin_review_duplicates_of(p_id) d;
  if cardinality(ids) = 0 then return; end if;
  select coalesce(array_agg(distinct x), '{}') into seen from public.admin_review_items i, unnest(i.related_ids) x where i.submission_id = p_id;
  fresh := array(select x from unnest(ids) x where not (x = any (seen)));
  select i.id into open_item from public.admin_review_items i where i.submission_id = p_id and i.status = 'open' limit 1;
  if open_item is not null then
    update public.admin_review_items set related_ids = array(select distinct x from unnest(related_ids || ids) x), detail = detail || jsonb_build_object('reasons', coalesce(detail -> 'reasons', '{}'::jsonb) || reasons)
     where id = open_item;
    return;
  end if;
  if cardinality(fresh) = 0 then return; end if;
  insert into public.admin_review_items (agency_id, kind, submission_id, related_ids, detail, created_by)
  values (s.organization_id, 'possible_duplicate', p_id, fresh, jsonb_build_object('reasons', reasons), p_actor)
  returning id into item;
  select coalesce(nullif(btrim(p.display_name), ''), u.email, 'An agent') into actor_name
    from auth.users u left join public.profiles p on p.user_id = u.id where u.id = p_actor;
  select o.named_insured into first_name from public.submissions o where o.id = fresh[1];
  insert into public.notifications (user_id, type, submission_id, message, actor_name, review_item_id)
  select p.user_id, 'admin_review', p_id,
         format('%s created %s, which may duplicate %s%s.', coalesce(actor_name, 'An agent'), coalesce(nullif(btrim(s.named_insured), ''), 'an account'),
                coalesce(first_name, 'an existing account'), case when cardinality(fresh) > 1 then format(' (and %s more)', cardinality(fresh) - 1) else '' end),
         actor_name, item
    from public.profiles p
   where p.agency_id = s.organization_id and p.role = 'admin';
exception when others then
  return; -- never blocks a save
end $$;
revoke all on function public.admin_review_check_duplicate(text, uuid) from public, anon, authenticated;

-- On a new account, and when its USDOT / MC is saved.
create or replace function public.admin_review_on_account() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.admin_review_check_duplicate(new.id, coalesce(auth.uid(), new.user_id));
  return null;
exception when others then
  return null;
end $$;
revoke all on function public.admin_review_on_account() from public, anon, authenticated;
drop trigger if exists admin_review_on_account on public.submissions;
create trigger admin_review_on_account after insert on public.submissions
  for each row execute function public.admin_review_on_account();

create or replace function public.admin_review_on_number() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.section = 'transportation' and new.field_key in ('dotNumber', 'mcNumber') then
    perform public.admin_review_check_duplicate(new.submission_id, coalesce(auth.uid(), new.user_id));
  end if;
  return null;
exception when others then
  return null;
end $$;
revoke all on function public.admin_review_on_number() from public, anon, authenticated;
drop trigger if exists admin_review_on_number on public.field_values;
create trigger admin_review_on_number after insert or update of value on public.field_values
  for each row execute function public.admin_review_on_number();

-- Admins: the agency's review items, newest first (open ones, and the last 50 decided).
create or replace function public.admin_review_items()
returns table (id uuid, kind text, status text, created_at timestamptz, created_by_name text, submission_id text, account_name text, account_archived boolean,
               account_agent text, related jsonb, resolution text, resolved_by_name text, resolved_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.kind, i.status, i.created_at,
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = i.created_by),
         i.submission_id, s.named_insured, coalesce(s.archived, false),
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = coalesce(s.assigned_user_id, s.user_id)),
         coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.named_insured, 'archived', coalesce(o.archived, false), 'createdAt', o.created_at,
                     'agent', (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = coalesce(o.assigned_user_id, o.user_id)),
                     'reasons', i.detail -> 'reasons' -> o.id))
                     from public.submissions o where o.id = any (i.related_ids)), '[]'::jsonb),
         i.resolution,
         (select coalesce(nullif(btrim(p.display_name), ''), 'Team member') from public.profiles p where p.user_id = i.resolved_by),
         i.resolved_at
    from public.admin_review_items i
    left join public.submissions s on s.id = i.submission_id
   where auth.uid() is not null and public.is_agency_admin() and i.agency_id = public.current_agency_id()
     and (i.status = 'open' or i.id in (select x.id from public.admin_review_items x where x.agency_id = i.agency_id and x.status = 'resolved' order by x.resolved_at desc limit 50))
   order by (i.status = 'open') desc, i.created_at desc
$$;
revoke all on function public.admin_review_items() from public, anon;
grant execute on function public.admin_review_items() to authenticated;

-- Admins decide: keep both accounts, or archive the new one (it can be restored from Archived).
create or replace function public.resolve_admin_review(p_id uuid, p_action text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  i public.admin_review_items;
begin
  if auth.uid() is null or not public.is_agency_admin() then raise exception 'Only an agency admin can do this.' using errcode = '42501'; end if;
  select * into i from public.admin_review_items x where x.id = p_id for update;
  if i.id is null or i.agency_id is distinct from public.current_agency_id() then raise exception 'No such review item.' using errcode = '42501'; end if;
  if i.status <> 'open' then raise exception 'This was already decided.' using errcode = '22023'; end if;
  if p_action not in ('keep_both', 'archive_new') then raise exception 'Choose keep both or archive the new account.' using errcode = '22023'; end if;
  if p_action = 'archive_new' then
    update public.submissions set archived = true where id = i.submission_id and organization_id = i.agency_id;
  end if;
  update public.admin_review_items
     set status = 'resolved', resolution = case when p_action = 'keep_both' then 'kept_both' else 'archived_new' end, resolved_by = auth.uid(), resolved_at = now()
   where id = p_id;
  -- Every admin's bell for it reads as done.
  update public.notifications set read_at = now() where review_item_id = p_id and read_at is null;
  return case when p_action = 'keep_both' then 'kept_both' else 'archived_new' end;
end $$;
revoke all on function public.resolve_admin_review(uuid, text) from public, anon;
grant execute on function public.resolve_admin_review(uuid, text) to authenticated;

notify pgrst, 'reload schema';
