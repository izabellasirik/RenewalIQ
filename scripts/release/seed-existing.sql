-- Synthetic "existing data" for the isolated TEST project, created in the schema production has
-- before this release (0001–0046). Stands in for a design partner's accounts so the release can prove it leaves
-- such data alone. Every name, email and number here is made up (example.com addresses only, plus
-- the founder's own sign-in for Founder Analytics). Run by test-env.sh setup — never on production
-- (test-env.sh refuses any database without the release_test marker).
\set ON_ERROR_STOP on
begin;

insert into public.agencies (name) values ('Synthetic Test Agency'), ('Other Test Agency');

insert into public.profiles (user_id, agency_id, role, email, display_name)
select u.id, a.id, v.role, u.email, v.name
  from (values ('admin@example.com', 'Synthetic Test Agency', 'admin', 'Test Admin'),
               ('broker1@example.com', 'Synthetic Test Agency', 'agent', 'Test Broker One'),
               ('broker2@example.com', 'Synthetic Test Agency', 'agent', 'Test Broker Two'),
               ('outsider@example.com', 'Other Test Agency', 'admin', 'Other Agency Admin')) v(email, agency, role, name)
  join auth.users u on u.email = v.email
  join public.agencies a on a.name = v.agency;

-- Accounts: broker1 has three, broker2 one, the other agency one.
insert into public.submissions (id, user_id, organization_id, assigned_user_id, named_insured, state, status, stage, contacts, missing_items, follow_ups, market_quotes, created_at, updated_at)
select v.id, p.user_id, p.agency_id, p.user_id, v.name, v.st, 'documents_uploaded', v.stage,
       jsonb_build_array(jsonb_build_object('id', 'contact_' || v.id, 'name', 'Sample Contact', 'email', 'contact+' || v.id || '@example.com')),
       v.items, v.fus, v.quotes, now() - interval '30 days', now() - interval '2 days'
  from (values
    ('acct_seed_1', 'broker1@example.com', 'Synthetic Freight One LLC', 'TX', 'collecting_info',
     '[{"id":"item_seed_1a","type":"document","label":"Loss runs — 5 years","status":"requested","requestedAt":"2026-09-20T15:00:00Z","followUpDate":"2026-09-25","createdAt":"2026-09-18T15:00:00Z","updatedAt":"2026-09-20T15:00:00Z"},
       {"id":"item_seed_1b","type":"document","label":"IFTA — last 4 quarters","status":"missing","createdAt":"2026-09-18T15:00:00Z","updatedAt":"2026-09-18T15:00:00Z"},
       {"id":"item_seed_1c","type":"document","label":"Driver list","status":"received","createdAt":"2026-09-18T15:00:00Z","updatedAt":"2026-09-22T15:00:00Z"}]'::jsonb,
     '[{"id":"fu_seed_1","subject":"Call client about loss runs","dueDate":"2026-09-28","createdAt":"2026-09-20T15:00:00Z","updatedAt":"2026-09-20T15:00:00Z"},
       {"id":"fu_seed_2","subject":"Renewal check-in","dueDate":"2026-12-01","createdAt":"2026-09-20T15:00:00Z","updatedAt":"2026-09-20T15:00:00Z"}]'::jsonb,
     '[{"id":"quote_seed_1","marketName":"Sample Mutual","status":"submitted","submittedAt":"2026-09-26","followUpDate":"2026-10-03","notes":[],"createdAt":"2026-09-26T15:00:00Z","updatedAt":"2026-09-26T15:00:00Z"}]'::jsonb),
    ('acct_seed_2', 'broker1@example.com', 'Synthetic Haulers Inc', 'OK', 'submitted',
     '[{"id":"item_seed_2a","type":"document","label":"MVRs — all drivers","status":"requested","requestedAt":"2026-09-25T15:00:00Z","createdAt":"2026-09-25T15:00:00Z","updatedAt":"2026-09-25T15:00:00Z"}]'::jsonb,
     '[]'::jsonb, '[]'::jsonb),
    ('acct_seed_3', 'broker1@example.com', 'Synthetic Logistics Co', 'NJ', 'new', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb),
    ('acct_seed_4', 'broker2@example.com', 'Synthetic Carriers LLC', 'FL', 'quoted',
     '[{"id":"item_seed_4a","type":"document","label":"Vehicle schedule","status":"requested","requestedAt":"2026-09-29T15:00:00Z","createdAt":"2026-09-29T15:00:00Z","updatedAt":"2026-09-29T15:00:00Z"}]'::jsonb,
     '[{"id":"fu_seed_4","subject":"Quote follow-up","dueDate":"2026-10-05","createdAt":"2026-09-29T15:00:00Z","updatedAt":"2026-09-29T15:00:00Z"}]'::jsonb, '[]'::jsonb),
    ('acct_seed_x', 'outsider@example.com', 'Other Agency Trucking', 'GA', 'new', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
  ) v(id, email, name, st, stage, items, fus, quotes)
  join auth.users u on u.email = v.email
  join public.profiles p on p.user_id = u.id;

-- Documents with files (uploaded by test-env.mjs files): the usual types, plus a scanned .tif and a
-- forwarded .msg — older kinds of files that 0048 won't accept for NEW uploads but must keep serving.
insert into public.documents (id, submission_id, user_id, name, file_type, category, status, size_bytes, storage_path, uploaded_at, created_at)
select v.id, v.acct, s.user_id, v.name, v.ft, v.cat, 'processed', 0, s.user_id || '/' || v.acct || '/' || v.id || '/' || v.name, now() - interval '20 days', now() - interval '20 days'
  from (values
    ('doc_seed_1', 'acct_seed_1', 'ABC_Transportation_Loss_Runs.pdf', 'pdf', 'loss_runs'),
    ('doc_seed_2', 'acct_seed_1', 'ABC_Transportation_Driver_Schedule.xlsx', 'xlsx', 'driver_list'),
    ('doc_seed_3', 'acct_seed_2', 'ABC_Transportation_Vehicle_Schedule.xlsx', 'xlsx', 'vehicle_schedule'),
    ('doc_seed_4', 'acct_seed_2', 'Scanned_Fax_Loss_Run.tif', 'other', 'other'),
    ('doc_seed_5', 'acct_seed_4', 'Forwarded_Quote.msg', 'other', 'other'),
    ('doc_seed_x', 'acct_seed_x', 'ABC_Transportation_Loss_Runs.pdf', 'pdf', 'loss_runs')
  ) v(id, acct, name, ft, cat)
  join public.submissions s on s.id = v.acct;

insert into public.activity_events (id, submission_id, user_id, type, message, created_at)
select 'ev_seed_' || s.id, s.id, s.user_id, 'account_created', 'Submission created for ' || s.named_insured || '.', s.created_at from public.submissions s where s.id like 'acct_seed_%';

-- Client requests, created through the app's own function as the broker (as the current app does).
do $$
declare
  b1 uuid := (select id from auth.users where email = 'broker1@example.com');
  b2 uuid := (select id from auth.users where email = 'broker2@example.com');
begin
  perform set_config('request.jwt.claims', json_build_object('sub', b1, 'role', 'authenticated', 'email', 'broker1@example.com')::text, true);
  perform set_config('request.jwt.claim.sub', b1::text, true);
  -- overdue follow-up
  perform public.create_document_request('acct_seed_1', gen_random_uuid(), '{"id":"contact_acct_seed_1","name":"Sample Contact","email":"contact+acct_seed_1@example.com"}'::jsonb, 'email',
    '[{"missingItemId":"item_seed_1a","label":"Loss runs — 5 years"}]'::jsonb, current_date - 3, now() - interval '12 days');
  -- follow-up ahead
  perform public.create_document_request('acct_seed_2', gen_random_uuid(), '{"id":"contact_acct_seed_2","name":"Sample Contact","email":"contact+acct_seed_2@example.com"}'::jsonb, 'email',
    '[{"missingItemId":"item_seed_2a","label":"MVRs — all drivers"}]'::jsonb, current_date + 4, now() - interval '6 days');
  perform set_config('request.jwt.claims', json_build_object('sub', b2, 'role', 'authenticated', 'email', 'broker2@example.com')::text, true);
  perform set_config('request.jwt.claim.sub', b2::text, true);
  perform public.create_document_request('acct_seed_4', gen_random_uuid(), '{"id":"contact_acct_seed_4","name":"Sample Contact","email":"contact+acct_seed_4@example.com"}'::jsonb, 'email',
    '[{"missingItemId":"item_seed_4a","label":"Vehicle schedule"}]'::jsonb, current_date + 1, now() - interval '2 days');
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;
commit;

select 'seeded' as result, (select count(*) from public.submissions) as accounts, (select count(*) from public.documents) as documents,
       (select count(*) from public.document_requests) as requests;
