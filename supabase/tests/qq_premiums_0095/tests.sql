-- 0095 cancelled-policy premiums entered by admins: admins only, amounts checked. Fictional; rolled back.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, true); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
create or replace function pg_temp.refused(sql text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return true;
end $$;
grant usage on schema public to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
insert into agency_qq_premiums (agency_id, row_key, premium_cents, set_by) values (public.current_agency_id(), 'c:k1', 570000, '00000000-0000-0000-0000-00000000000a');
select pg_temp.check('P1 an admin enters a premium; who did is stamped', (select premium_cents = 570000 and set_by = '00000000-0000-0000-0000-00000000000d' from agency_qq_premiums));
update agency_qq_premiums set premium_cents = 600000;
select pg_temp.check('P2 the admin corrects it', (select premium_cents = 600000 from agency_qq_premiums));
select pg_temp.check('P3 a negative premium is refused', pg_temp.refused($$insert into agency_qq_premiums (agency_id, row_key, premium_cents) values (public.current_agency_id(), 'c:k2', -1)$$));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('P4 an agent can''t see or enter premiums', (select count(*) = 0 from agency_qq_premiums) and pg_temp.refused($$insert into agency_qq_premiums (agency_id, row_key, premium_cents) values (public.current_agency_id(), 'c:k3', 1)$$));
rollback;
