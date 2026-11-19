-- 0096 faster account reads: every person sees exactly the rows the old per-row rule
-- (can_access_submission / can_access_field_value) allowed — no more, no fewer — on every table.
-- Run against a disposable copy with 0096 applied (users as in the agency RLS tests). Rolled back.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
end $$;
-- Rows the person sees now vs. rows the old rule allows (old rule called directly, as the database owner).
create or replace function pg_temp.same(t text, u text) returns boolean language plpgsql as $$
declare seen text[]; allowed text[]; key text := case when t = 'field_alternates' then 'field_value_id' else 'submission_id' end;
begin
  perform pg_temp.as_user(u);
  execute 'set local role authenticated';
  execute format('select coalesce(array_agg(id::text order by id::text), ''{}'') from public.%I', t) into seen;
  execute 'reset role';
  execute format('select coalesce(array_agg(id::text order by id::text), ''{}'') from public.%I x where %s', t,
    case when t = 'field_alternates' then 'public.can_access_field_value(x.field_value_id)' else 'public.can_access_submission(x.submission_id)' end) into allowed;
  return seen = allowed;
end $$;
create temp table who (name text, uid text);
insert into who values ('admin', '00000000-0000-0000-0000-00000000000d'), ('agent', '00000000-0000-0000-0000-00000000000a');
insert into who select 'other agency admin', p.user_id::text from profiles p where p.agency_id <> (select agency_id from profiles where user_id = '00000000-0000-0000-0000-00000000000d') and p.role = 'admin' limit 1;
grant usage on schema public to authenticated;
select pg_temp.check('F ' || w.name || ': ' || t || ' — the same rows as before', pg_temp.same(t, w.uid))
from who w, unnest(array['activity_events','field_values','field_alternates','coverage_lines','vehicles','drivers','losses','documents']) t
order by w.name, t;
rollback;
