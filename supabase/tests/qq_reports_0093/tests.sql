-- 0093 endorsement reports: only the agency's admins can see, add or delete them; the uploader is
-- stamped by the database; reports can't be edited. Run against a disposable copy of a database with
-- 0093 applied (agencies and users as in the agency RLS tests). Fictional data; rolled back.
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
create temp table ids (name text primary key, id uuid);
insert into ids select 'other_agency', a.id from agencies a where a.id <> (select agency_id from profiles where user_id = '00000000-0000-0000-0000-00000000000d') limit 1;
insert into ids select 'other_admin', p.user_id from profiles p where p.agency_id = (select id from ids where name = 'other_agency') and p.role = 'admin' limit 1;
grant all on ids to authenticated;
grant usage on schema public to authenticated;
set local role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
with x as (insert into agency_qq_reports (agency_id, kind, title, period, file_name, rows, uploaded_by)
  values (public.current_agency_id(), 'endorsements', 'Endorsements', 'October (sample)', 'endorsements.pdf',
          '[{"amountCents": 41600, "date": "2026-10-12", "description": "Add unit (sample)", "client": "Sample Freight LLC", "agent": "Ben Agent"}]', '00000000-0000-0000-0000-00000000000a') returning id)
insert into ids select 'rep', id from x;
select pg_temp.check('Q1 an admin uploads a report', (select count(*) = 1 from agency_qq_reports));
select pg_temp.check('Q2 the uploader is stamped by the database', (select uploaded_by = '00000000-0000-0000-0000-00000000000d' from agency_qq_reports));
select pg_temp.check('Q3 a report can''t be edited', pg_temp.refused($$update agency_qq_reports set title = 'x'$$));
select pg_temp.check('Q4 an unknown kind is refused', pg_temp.refused($$insert into agency_qq_reports (agency_id, kind) values (public.current_agency_id(), 'renewals')$$));
select pg_temp.check('Q5 a report for another agency is refused', pg_temp.refused($$insert into agency_qq_reports (agency_id, kind) values ((select id from ids where name = 'other_agency'), 'endorsements')$$));

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('Q6 an agent of the agency sees no reports', (select count(*) = 0 from agency_qq_reports));
select pg_temp.check('Q7 an agent can''t upload one', pg_temp.refused($$insert into agency_qq_reports (agency_id, kind) values (public.current_agency_id(), 'endorsements')$$));
delete from agency_qq_reports;
select pg_temp.as_user((select id::text from ids where name = 'other_admin'));
select pg_temp.check('Q8 another agency''s admin sees no reports', (select count(*) = 0 from agency_qq_reports));
delete from agency_qq_reports;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('Q9 nobody else could delete it', (select count(*) = 1 from agency_qq_reports));
delete from agency_qq_reports where id = (select id from ids where name = 'rep');
select pg_temp.check('Q10 the admin deletes it', (select count(*) = 0 from agency_qq_reports));
rollback;
