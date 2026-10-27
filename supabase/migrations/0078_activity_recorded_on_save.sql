-- 0078 Founder Analytics can't miss a broker's work because of their browser. Needs 0043 and 0070.
--
-- Some browsers and ad / privacy blockers drop the app's background "track" call, so a broker's work
-- (accounts, markets, policies, documents) could be saved with no activity recorded. Now:
--   * The database records the key actions itself when the work is saved: an account created, a
--     market added, a policy or endorsement recorded, a document uploaded.
--   * The app's call has a neutral name (note_work — the same as track_product_event, which stays).
-- Each of those actions has one key per account / market / policy / document, used by both the app
-- and the database, so the same action is never counted twice. Saving never fails because of this.
-- Nothing already recorded changes. Additive and re-runnable. Rollback: supabase/release/rollback_0078.sql.

do $$
begin
  if to_regprocedure('public.track_product_event(text,text,jsonb,text)') is null or to_regprocedure('public.analytics_user_is_test(uuid)') is null then
    raise exception '0078 needs 0043 and 0070.';
  end if;
end $$;

-- The app's call, under a name blockers don't target.
create or replace function public.note_work(p_event_name text, p_account_id text default null, p_metadata jsonb default '{}'::jsonb, p_dedupe_key text default null)
returns boolean
language sql security definer set search_path = ''
as $$ select public.track_product_event(p_event_name, p_account_id, p_metadata, p_dedupe_key) $$;
revoke all on function public.note_work(text, text, jsonb, text) from public, anon;
grant execute on function public.note_work(text, text, jsonb, text) to authenticated;

-- One action, recorded by the database (key as the app's: "<user>:<key>"). Never raises.
create or replace function public.record_saved_work(p_event_name text, p_user uuid, p_org uuid, p_account text, p_metadata jsonb, p_key text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user is null then return; end if;
  insert into public.product_events (event_name, user_id, organization_id, account_id, is_test, metadata, dedupe_key)
  values (p_event_name, p_user, p_org, p_account, public.analytics_account_is_test(p_account), public.analytics_clean_metadata(p_metadata),
          left(p_user::text || ':' || p_key, 200))
  on conflict do nothing;
exception when others then
  return; -- never blocks a save
end $$;
revoke all on function public.record_saved_work(text, uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- An account saved: new account, new markets, new policies / endorsements.
create or replace function public.activity_from_account_save() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  who uuid := coalesce(auth.uid(), new.user_id);
  q jsonb;
  e record;
begin
  if tg_op = 'INSERT' then
    perform public.record_saved_work('account_created', who, new.organization_id, new.id, '{"source":"saved"}', 'account_created:' || new.id);
  end if;
  -- Markets on it now that weren't before.
  for q in
    select x from jsonb_array_elements(case when jsonb_typeof(new.market_quotes) = 'array' then new.market_quotes else '[]'::jsonb end) x
     where jsonb_typeof(x) = 'object' and coalesce(x ->> 'id', '') <> ''
       and (tg_op = 'INSERT' or not exists (
         select 1 from jsonb_array_elements(case when jsonb_typeof(old.market_quotes) = 'array' then old.market_quotes else '[]'::jsonb end) o
          where jsonb_typeof(o) = 'object' and o ->> 'id' = x ->> 'id'))
  loop
    perform public.record_saved_work('market_added', who, new.organization_id, new.id,
      jsonb_build_object('source', 'saved', 'status', left(q ->> 'status', 40)), 'market_added:' || new.id || ':' || (q ->> 'id'));
  end loop;
  -- Policies / endorsements on it now that weren't before (not removed ones).
  for e in
    select n.entry from public.finance_entries(new.market_quotes) n
     where n.entry ->> 'removedAt' is null
       and (tg_op = 'INSERT' or not exists (select 1 from public.finance_entries(old.market_quotes) o where o.entry ->> 'id' = n.entry ->> 'id'))
  loop
    perform public.record_saved_work('policy_bound', who, new.organization_id, new.id,
      jsonb_build_object('source', 'saved', 'status', case when e.entry ->> 'kind' = 'endorsement' then 'endorsed' else 'bound' end),
      'policy_bound:' || new.id || ':' || (e.entry ->> 'id'));
  end loop;
  return null;
exception when others then
  return null; -- never blocks a save
end $$;
revoke all on function public.activity_from_account_save() from public, anon, authenticated;
drop trigger if exists activity_from_account_save on public.submissions;
create trigger activity_from_account_save after insert or update of market_quotes on public.submissions
  for each row execute function public.activity_from_account_save();

-- A document saved.
create or replace function public.activity_from_document_save() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.record_saved_work('document_uploaded', coalesce(auth.uid(), new.user_id),
    (select s.organization_id from public.submissions s where s.id = new.submission_id), new.submission_id,
    '{"source":"saved","count":1}', 'document_uploaded:' || new.id);
  return null;
exception when others then
  return null;
end $$;
revoke all on function public.activity_from_document_save() from public, anon, authenticated;
drop trigger if exists activity_from_document_save on public.documents;
create trigger activity_from_document_save after insert on public.documents
  for each row execute function public.activity_from_document_save();

notify pgrst, 'reload schema';
