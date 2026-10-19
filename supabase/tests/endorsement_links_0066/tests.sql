-- 0066: an endorsement keeps its link to its policy when a save (e.g. from an older app) drops it.
-- Run against a disposable copy of a database with 0066 applied (0064 optional: K10–K11 then check the
-- audit and the commission record). Fictional data. One transaction, rolled back. One PASS/FAIL per check.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.check(name text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
create or replace function pg_temp.agency() returns uuid language sql as $$ select agency_id from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d' $$;
create or replace function pg_temp.pol(id text, net bigint, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'carrier', 'Sample Mutual', 'boundDate', '2026-10-01', 'netPremiumCents', net, 'policyNumber', 'LK-' || id) || extra $$;
create or replace function pg_temp.endo(id text, net bigint, extra jsonb default '{}') returns jsonb language sql as $$
  select pg_temp.pol(id, net, jsonb_build_object('kind', 'endorsement', 'boundDate', '2026-10-05') || extra) $$;
create or replace function pg_temp.quotes(policies jsonb, other jsonb default null) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', 'q1', 'status', 'bound', 'marketName', 'Sample Market', 'policies', policies))
         || case when other is null then '[]'::jsonb else jsonb_build_array(other) end $$;
create or replace function pg_temp.link(sub text, endo text) returns text language sql as $$
  select p ->> 'forPolicyId' from public.submissions s, jsonb_array_elements(s.market_quotes) q, jsonb_array_elements(q -> 'policies') p where s.id = sub and p ->> 'id' = endo limit 1 $$;
create or replace function pg_temp.entry(sub text, entry_id text) returns jsonb language sql as $$
  select p from public.submissions s, jsonb_array_elements(s.market_quotes) q, jsonb_array_elements(q -> 'policies') p where s.id = sub and p ->> 'id' = entry_id limit 1 $$;
select set_config('request.jwt.claim.sub', '', true);

insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_lk_1', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Link Test (sample)', '00000000-0000-0000-0000-00000000000a',
   pg_temp.quotes(jsonb_build_array(pg_temp.pol('p1', 500000), pg_temp.pol('p2', 300000), pg_temp.endo('e1', 100000, '{"forPolicyId": "p1"}'), pg_temp.endo('e2', 50000))));
select pg_temp.check('K1 a new endorsement is saved with its link', pg_temp.link('acct_lk_1', 'e1') = 'p1');

-- An older app edits e1 (net 1,000 → 1,200): its form rebuilds the endorsement without forPolicyId.
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('p1', 500000), pg_temp.pol('p2', 300000), pg_temp.endo('e1', 120000), pg_temp.endo('e2', 50000))) where id = 'acct_lk_1';
select pg_temp.check('K2 an edit that drops the link: the link is kept', pg_temp.link('acct_lk_1', 'e1') = 'p1');
select pg_temp.check('K2b … and the edit itself is saved (net $1,200)', (pg_temp.entry('acct_lk_1', 'e1') ->> 'netPremiumCents')::bigint = 120000);
select pg_temp.check('K2c … nothing else changes: the other policies and the unlinked endorsement as saved', pg_temp.entry('acct_lk_1', 'p2') = pg_temp.pol('p2', 300000)
  and pg_temp.entry('acct_lk_1', 'e2') = pg_temp.endo('e2', 50000) and (select jsonb_array_length(market_quotes -> 0 -> 'policies') = 4 from public.submissions where id = 'acct_lk_1'));
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('p1', 500000), pg_temp.pol('p2', 300000), pg_temp.endo('e1', 120000, '{"forPolicyId": ""}'), pg_temp.endo('e2', 50000))) where id = 'acct_lk_1';
select pg_temp.check('K3 a blank link is kept as it was too', pg_temp.link('acct_lk_1', 'e1') = 'p1');
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('p1', 500000), pg_temp.pol('p2', 300000), pg_temp.endo('e1', 120000, '{"forPolicyId": "p2"}'), pg_temp.endo('e2', 50000))) where id = 'acct_lk_1';
select pg_temp.check('K4 linking it to another policy is saved as chosen', pg_temp.link('acct_lk_1', 'e1') = 'p2');
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('p1', 500000), pg_temp.pol('p2', 300000), pg_temp.endo('e1', 120000, '{"forPolicyId": "p2", "removedAt": "2026-10-10T00:00:00Z"}'), pg_temp.endo('e2', 50000))) where id = 'acct_lk_1';
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('p1', 500000), pg_temp.pol('p2', 300000), pg_temp.endo('e1', 120000, '{"removedAt": "2026-10-10T00:00:00Z"}'), pg_temp.endo('e2', 50000))) where id = 'acct_lk_1';
select pg_temp.check('K5 a removed endorsement keeps its link and stays removed', pg_temp.link('acct_lk_1', 'e1') = 'p2' and pg_temp.entry('acct_lk_1', 'e1') ->> 'removedAt' is not null);
-- Moved to another market on the account (an old app reorders markets): still kept.
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('p1', 500000), pg_temp.pol('p2', 300000), pg_temp.endo('e2', 50000)),
  jsonb_build_object('id', 'q2', 'status', 'bound', 'policies', jsonb_build_array(pg_temp.endo('e1', 120000)))) where id = 'acct_lk_1';
select pg_temp.check('K6 an endorsement on another market of the account keeps its link', pg_temp.link('acct_lk_1', 'e1') = 'p2');
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('p1', 500000), pg_temp.pol('p2', 300000))) where id = 'acct_lk_1';
select pg_temp.check('K7 an endorsement deleted from the account stays deleted', pg_temp.entry('acct_lk_1', 'e1') is null and pg_temp.entry('acct_lk_1', 'e2') is null);

-- Saves with nothing to keep are left exactly as sent.
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_lk_2', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Link Test Two (sample)', '00000000-0000-0000-0000-00000000000a',
   pg_temp.quotes(jsonb_build_array(pg_temp.pol('r1', 100000), pg_temp.endo('r2', 10000))));
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.endo('r2', 20000), pg_temp.pol('r1', 100000)), jsonb_build_object('id', 'q9', 'policies', '[]'::jsonb)) where id = 'acct_lk_2';
select pg_temp.check('K8 no link to keep: the markets are saved exactly as sent (order and empty lists too)', (select market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.endo('r2', 20000), pg_temp.pol('r1', 100000)), jsonb_build_object('id', 'q9', 'policies', '[]'::jsonb)) from public.submissions where id = 'acct_lk_2'));
update public.submissions set market_quotes = '[1, "x", {"id": "q1", "policies": "nope"}]'::jsonb where id = 'acct_lk_1';
select pg_temp.check('K9 odd market data still saves as sent', (select market_quotes = '[1, "x", {"id": "q1", "policies": "nope"}]'::jsonb from public.submissions where id = 'acct_lk_1'));

-- With 0064: the kept link is in the audit, and the commission record stays linked and unflagged.
insert into public.submissions (id, user_id, organization_id, named_insured, assigned_user_id, market_quotes) values
  ('acct_lk_3', '00000000-0000-0000-0000-00000000000a', pg_temp.agency(), 'Link Test Three (sample)', '00000000-0000-0000-0000-00000000000a',
   pg_temp.quotes(jsonb_build_array(pg_temp.pol('s1', 500000), pg_temp.endo('s2', 100000, '{"forPolicyId": "s1"}'))));
update public.submissions set market_quotes = pg_temp.quotes(jsonb_build_array(pg_temp.pol('s1', 500000), pg_temp.endo('s2', 100000, '{"notes": "edited in an older app"}'))) where id = 'acct_lk_3';
-- (Run only when 0064 is there; a missing table can't appear in a plain query.)
create or replace function pg_temp.when64(q text) returns boolean language plpgsql as $$
declare r boolean;
begin
  if to_regclass('public.commission_transactions') is null then return true; end if;
  execute q into r;
  return r;
end $$;
select pg_temp.check('K10 the kept link is noted in the audit (when 0064 is installed)', pg_temp.when64($$select count(*) = 1 from public.finance_audit_log where action = 'endorsement_link_kept' and entity_id = 'acct_lk_3' and detail -> 'endorsements' ->> 's2' = 's1'$$));
select pg_temp.check('K11 the endorsement''s commission record stays linked to its policy, not flagged (when 0064 is installed)', pg_temp.when64($$select e.original_transaction_id = p.id and not ('unlinked_endorsement' = any (e.review_flags)) and not ('changed_since_recorded' = any (e.review_flags))
        from public.commission_transactions e, public.commission_transactions p where e.policy_id = 's2' and p.policy_id = 's1' and e.replaced_by is null and p.replaced_by is null$$));
select pg_temp.check('K12 no sync errors (when 0064 is installed)', pg_temp.when64($$select count(*) = 0 from public.finance_audit_log where action = 'sync_error'$$));
rollback;
