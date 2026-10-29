-- Cleanup: checklist items the app added by itself, never acted on. Run the PREVIEW first; APPLY only after
-- checking it. Re-runnable: a second run finds nothing.
--
-- Removed (all must hold):
--   * added automatically:
--       - the standard trucking checklist (Application, Loss Runs, MVR, IFTA, Unit List, Driver List) that
--         accounts got by themselves until early October 2026 (created before the cutoff below), or
--       - an "Updated MVR / loss run" item (templateKey refresh:…), which the app no longer adds;
--   * still "missing": never requested from the client, not received, not marked not applicable;
--   * not asked for by a market, not linked to a document, not part of any client request.
-- Kept: everything a person added or worked on — requested, received, waived, linked to a market or document.

-- ─── PREVIEW (read-only) ───────────────────────────────────────────────────────────────────────
with params as (select timestamptz '2026-10-03 00:00:00+00' as cutoff),
items as (
  select s.id as account_id, s.named_insured, s.archived, e.item
    from public.submissions s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.missing_items) = 'array' then s.missing_items else '[]'::jsonb end) e(item)
),
auto as (
  select i.* from items i, params p
   where i.item ->> 'status' = 'missing'
     and coalesce(i.item ->> 'requestedAt', '') = '' and coalesce(i.item ->> 'requestedFromContactId', '') = ''
     and coalesce(i.item ->> 'followUpDate', '') = '' and coalesce(i.item ->> 'documentId', '') = ''
     and coalesce(i.item ->> 'neededByQuoteId', '') = ''
     and coalesce(jsonb_array_length(case when jsonb_typeof(i.item -> 'neededByQuoteIds') = 'array' then i.item -> 'neededByQuoteIds' end), 0) = 0
     and not exists (select 1 from public.document_request_items r where r.missing_item_id = i.item ->> 'id')
     and (
       (split_part(i.item ->> 'templateKey', ':', 1) in ('application', 'loss_runs', 'mvr', 'ifta', 'unit_list', 'driver_list')
        and coalesce(i.item ->> 'notes', '') = '' and coalesce(i.item ->> 'instructions', '') = ''
        and (i.item ->> 'createdAt')::timestamptz < p.cutoff)
       or (i.item ->> 'templateKey') like 'refresh:%'
     )
)
select named_insured as client, archived, count(*) as items_to_remove, string_agg(item ->> 'label', ', ' order by item ->> 'label') as labels
  from auto group by account_id, named_insured, archived
 order by count(*) desc, named_insured;

-- ─── APPLY (changes data) — only after checking the preview ─────────────────────────────────────
begin;
with params as (select timestamptz '2026-10-03 00:00:00+00' as cutoff),
items as (
  select s.id as account_id, s.named_insured, s.archived, e.item
    from public.submissions s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.missing_items) = 'array' then s.missing_items else '[]'::jsonb end) e(item)
),
auto as (
  select i.* from items i, params p
   where i.item ->> 'status' = 'missing'
     and coalesce(i.item ->> 'requestedAt', '') = '' and coalesce(i.item ->> 'requestedFromContactId', '') = ''
     and coalesce(i.item ->> 'followUpDate', '') = '' and coalesce(i.item ->> 'documentId', '') = ''
     and coalesce(i.item ->> 'neededByQuoteId', '') = ''
     and coalesce(jsonb_array_length(case when jsonb_typeof(i.item -> 'neededByQuoteIds') = 'array' then i.item -> 'neededByQuoteIds' end), 0) = 0
     and not exists (select 1 from public.document_request_items r where r.missing_item_id = i.item ->> 'id')
     and (
       (split_part(i.item ->> 'templateKey', ':', 1) in ('application', 'loss_runs', 'mvr', 'ifta', 'unit_list', 'driver_list')
        and coalesce(i.item ->> 'notes', '') = '' and coalesce(i.item ->> 'instructions', '') = ''
        and (i.item ->> 'createdAt')::timestamptz < p.cutoff)
       or (i.item ->> 'templateKey') like 'refresh:%'
     )
),
gone as (select account_id, array_agg(item ->> 'id') as ids from auto group by account_id),
upd as (
  update public.submissions s
     set missing_items = (select coalesce(jsonb_agg(x order by ord), '[]'::jsonb)
                            from jsonb_array_elements(s.missing_items) with ordinality t(x, ord)
                           where not ((x ->> 'id') = any (g.ids)))
    from gone g
   where s.id = g.account_id
  returning s.id
)
select count(*) as accounts_cleaned from upd;
commit;
