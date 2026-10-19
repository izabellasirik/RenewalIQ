-- 0066 Keeps each endorsement's link to its policy (forPolicyId) when an account is saved.
--
-- Older versions of the app (Round 4 and before) rebuild an endorsement from their form when it's
-- edited, and their form doesn't know the link, so saving an edit there would silently drop it. This
-- trigger puts it back: when a save leaves an endorsement that had a link without one, the link it had
-- is kept. A save that links it to a different policy is kept as saved; an endorsement taken off the
-- account stays off. Nothing else on the account is touched, and a save is never refused because of it.
-- Each link kept is noted in finance_audit_log (when 0064 is installed).
--
-- Independent of 0064 / 0065 (it can be applied before or after them). No existing row is changed when
-- it's applied. Re-runnable.

create or replace function public.keep_endorsement_links() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  links jsonb;
  kept jsonb;
begin
  if jsonb_typeof(new.market_quotes) is distinct from 'array' or jsonb_typeof(old.market_quotes) is distinct from 'array' then return new; end if;
  -- The links the account had: endorsement id → its policy.
  select jsonb_object_agg(p ->> 'id', p ->> 'forPolicyId') into links
    from jsonb_array_elements(old.market_quotes) q
   cross join lateral jsonb_array_elements(case when jsonb_typeof(q -> 'policies') = 'array' then q -> 'policies' else '[]'::jsonb end) p
   where jsonb_typeof(p) = 'object' and p ->> 'kind' = 'endorsement' and coalesce(p ->> 'id', '') <> '' and coalesce(p ->> 'forPolicyId', '') <> '';
  if links is null then return new; end if;
  -- The endorsements this save left without the link they had.
  select jsonb_object_agg(p ->> 'id', links ->> (p ->> 'id')) into kept
    from jsonb_array_elements(new.market_quotes) q
   cross join lateral jsonb_array_elements(case when jsonb_typeof(q -> 'policies') = 'array' then q -> 'policies' else '[]'::jsonb end) p
   where jsonb_typeof(p) = 'object' and p ->> 'kind' = 'endorsement' and coalesce(p ->> 'forPolicyId', '') = '' and links ? (p ->> 'id');
  if kept is null then return new; end if;
  new.market_quotes := (
    select coalesce(jsonb_agg(
             case when jsonb_typeof(q) = 'object' and jsonb_typeof(q -> 'policies') = 'array' then
               jsonb_set(q, '{policies}', coalesce((
                 select jsonb_agg(case when jsonb_typeof(p) = 'object' and p ->> 'kind' = 'endorsement' and coalesce(p ->> 'forPolicyId', '') = '' and kept ? (p ->> 'id')
                                       then p || jsonb_build_object('forPolicyId', kept ->> (p ->> 'id')) else p end order by pi)
                   from jsonb_array_elements(q -> 'policies') with ordinality as x(p, pi)), '[]'::jsonb))
             else q end order by qi), new.market_quotes)
      from jsonb_array_elements(new.market_quotes) with ordinality as y(q, qi));
  begin
    if to_regclass('public.finance_audit_log') is not null then
      insert into public.finance_audit_log (agency_id, actor, action, entity, entity_id, detail)
      values (new.organization_id, auth.uid(), 'endorsement_link_kept', 'account', new.id, jsonb_build_object('endorsements', kept));
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;
revoke all on function public.keep_endorsement_links() from public, anon, authenticated;

drop trigger if exists keep_endorsement_links on public.submissions;
create trigger keep_endorsement_links before update of market_quotes on public.submissions
  for each row execute function public.keep_endorsement_links();
