-- 0051 follow-up: close open invitations whose person is ALREADY a member of that agency (added
-- another way before 0051). The Team page shows them as "Already on your team"; this closes them in
-- bulk, recording the member as having accepted. Nothing else changes — no membership, account,
-- document or submission is touched.
--
-- PREVIEW (default): lists the agency and invited email of each such invitation; changes nothing.
-- APPLY: run   set renewaliq.confirm_0051_close = 'yes';   in the same SQL editor run, before this.
-- Needs 0051. Safe to run more than once.

begin;
create temporary table _stale on commit drop as
select i.id, a.name as agency, i.email,
       (select p.user_id from public.profiles p join auth.users u on u.id = p.user_id
         where p.agency_id = i.agency_id and (lower(p.email) = i.email or lower(u.email) = i.email) limit 1) as member
  from public.agency_invitations i
  join public.agencies a on a.id = i.agency_id
 where i.accepted_at is null and i.revoked_at is null
   and exists (select 1 from public.profiles p join auth.users u on u.id = p.user_id
                where p.agency_id = i.agency_id and (lower(p.email) = i.email or lower(u.email) = i.email));

select agency, email, coalesce(current_setting('renewaliq.confirm_0051_close', true), '') = 'yes' as closing from _stale order by agency, email;

do $$
declare n integer;
begin
  if coalesce(current_setting('renewaliq.confirm_0051_close', true), '') <> 'yes' then
    raise notice 'PREVIEW ONLY — nothing changed. To close them: set renewaliq.confirm_0051_close = ''yes''; then run this again.';
    return;
  end if;
  update public.agency_invitations i set accepted_at = now(), accepted_by = s.member from _stale s where s.id = i.id and i.accepted_at is null;
  get diagnostics n = row_count;
  raise notice 'CLOSED % invitation(s) of people already on their team.', n;
end $$;
commit;
