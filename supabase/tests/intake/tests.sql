-- Intake reliability (0029). Q-prefixed lines are compared with expected.txt.
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
insert into intake_links (id, user_id, label, token, active) values
  ('link1', '00000000-0000-0000-0000-00000000000d', 'Main', 'tok-active', true),
  ('link2', '00000000-0000-0000-0000-00000000000d', 'Old', 'tok-off', false);

set role anon;
select pg_temp.as_user('');
do $$ begin perform start_intake_submission('tok-off', gen_random_uuid(), '{}', 0); raise notice 'Q1 inactive link: ALLOWED (BAD)'; exception when others then raise notice 'Q1 inactive link denied: %', sqlerrm; end $$;

-- A client starts a submission with two files.
select submission_id as sid, reference as ref, status from start_intake_submission('tok-active', '11111111-1111-1111-1111-111111111111',
  '{"namedInsured":"Blue Ridge LLC","dotNumber":"123456","contactName":"Ann","contactEmail":"ann@x.com","yearsInBusiness":"7","powerUnits":"12x","coverageRequested":["auto_liability"]}', 2) \gset
select 'Q2 started: status=' || :'status' || ' ref=' || (:'ref' ~ '^RIQ-\d{6}$') || ' id=' || (:'sid' like 'isub\_%');
select 'Q3 same key again returns the same submission: ' || (submission_id = :'sid') from start_intake_submission('tok-active', '11111111-1111-1111-1111-111111111111',
  '{"namedInsured":"Blue Ridge LLC","dotNumber":"123456","contactName":"Ann","contactEmail":"ann@x.com","yearsInBusiness":"7","powerUnits":"12x","coverageRequested":["auto_liability"]}', 2);
do $$ begin perform start_intake_submission('tok-other', '11111111-1111-1111-1111-111111111111', '{}', 0); raise notice 'Q4 same key other link: ALLOWED (BAD)'; exception when others then raise notice 'Q4 same key other link denied: %', sqlerrm; end $$;

-- Storage: only into an open submission's folder.
insert into storage.objects (bucket_id, name) values ('intake-uploads', :'sid' || '/key-aaaa-1111/loss run.pdf');
select 'Q5 upload into the open submission: ok';
do $$ begin insert into storage.objects (bucket_id, name) values ('intake-uploads', 'random/other/file.pdf'); raise notice 'Q5 upload anywhere: ALLOWED (BAD)'; exception when others then raise notice 'Q5 upload outside a submission denied'; end $$;

-- Attaching a file.
do $$ begin perform attach_intake_document(current_setting('my.sid', true), '22222222-2222-2222-2222-222222222222', 'key-aaaa-1111', 'x', 'x', 1); raise notice 'Q6 wrong key: ALLOWED (BAD)'; exception when others then raise notice 'Q6 wrong browser key denied: %', sqlerrm; end $$;
select set_config('my.sid', :'sid', false) is not null as _set \gset
do $$ begin perform attach_intake_document(current_setting('my.sid'), '22222222-2222-2222-2222-222222222222', 'key-aaaa-1111', 'x', 'x', 1); raise notice 'Q6 wrong key: ALLOWED (BAD)'; exception when others then raise notice 'Q6 wrong browser key denied: %', sqlerrm; end $$;
do $$ begin perform attach_intake_document(current_setting('my.sid'), '11111111-1111-1111-1111-111111111111', 'key-bbbb-2222', 'drivers.xlsx', current_setting('my.sid') || '/key-bbbb-2222/drivers.xlsx', 10); raise notice 'Q6 attach without file: ALLOWED (BAD)'; exception when others then raise notice 'Q6 attach a file not in storage denied: %', sqlerrm; end $$;
do $$ begin perform attach_intake_document(current_setting('my.sid'), '11111111-1111-1111-1111-111111111111', 'key-bbbb-2222', 'drivers.xlsx', 'isub_other/key-bbbb-2222/drivers.xlsx', 10); raise notice 'Q6 foreign path: ALLOWED (BAD)'; exception when others then raise notice 'Q6 path of another submission denied: %', sqlerrm; end $$;
select 'Q6 attach: ' || (attach_intake_document(:'sid', '11111111-1111-1111-1111-111111111111', 'key-aaaa-1111', 'loss run.pdf', :'sid' || '/key-aaaa-1111/loss run.pdf', 2048) like 'idoc\_%');
select 'Q6 attach again (a retry) keeps one row: ' || (attach_intake_document(:'sid', '11111111-1111-1111-1111-111111111111', 'key-aaaa-1111', 'loss run.pdf', :'sid' || '/key-aaaa-1111/loss run.pdf', 2048) like 'idoc\_%');
reset role;
select 'Q6 rows for the file: ' || count(*) from intake_documents where intake_submission_id = :'sid';
set role anon;

-- Finishing with a file still missing.
select 'Q7 finalize with a missing file: ' || finalize_intake_submission(:'sid', '11111111-1111-1111-1111-111111111111', array['key-aaaa-1111', 'key-bbbb-2222'])::text;
reset role;
select 'Q7 still uploading: ' || status from intake_submissions where id = :'sid';

-- The broker can't import it yet.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$ begin update intake_submissions set status = 'imported' where id = current_setting('my.sid'); raise notice 'Q8 import while uploading: ALLOWED (BAD)'; exception when others then raise notice 'Q8 import while uploading denied: %', sqlerrm; end $$;
select 'Q8 broker sees it as: ' || status || ' ' || coalesce(expected_files::text, '-') || ' expected' from intake_submissions where id = :'sid';

-- The second file arrives; now it verifies.
set role anon;
select pg_temp.as_user('');
insert into storage.objects (bucket_id, name) values ('intake-uploads', :'sid' || '/key-bbbb-2222/drivers.xlsx');
select 'Q9 attach second: ' || (attach_intake_document(:'sid', '11111111-1111-1111-1111-111111111111', 'key-bbbb-2222', 'drivers.xlsx', :'sid' || '/key-bbbb-2222/drivers.xlsx', 10) like 'idoc\_%');
select 'Q9 finalize: ok=' || (r->>'ok') || ' files=' || (r->>'files') || ' ref matches=' || ((r->>'reference') = :'ref') from finalize_intake_submission(:'sid', '11111111-1111-1111-1111-111111111111', array['key-aaaa-1111', 'key-bbbb-2222']) r;
select 'Q10 finalize again: ok=' || (r->>'ok') || ' alreadyComplete=' || (r->>'alreadyComplete') from finalize_intake_submission(:'sid', '11111111-1111-1111-1111-111111111111', array['key-aaaa-1111', 'key-bbbb-2222']) r;
do $$ begin perform attach_intake_document(current_setting('my.sid'), '11111111-1111-1111-1111-111111111111', 'key-bbbb-2222', 'drivers.xlsx', current_setting('my.sid') || '/key-bbbb-2222/drivers.xlsx', 10); raise notice 'Q11 attach after completion: ALLOWED (BAD)'; exception when others then raise notice 'Q11 attach after completion denied: %', sqlerrm; end $$;
do $$ begin insert into storage.objects (bucket_id, name) values ('intake-uploads', current_setting('my.sid') || '/late/file.pdf'); raise notice 'Q11 upload after completion: ALLOWED (BAD)'; exception when others then raise notice 'Q11 upload after completion denied'; end $$;
reset role;
select 'Q9 status=' || status || ' completed=' || (completed_at is not null) || ' answers: ' || concat_ws('|', named_insured, dot_number, coalesce(years_in_business::text, 'null'), coalesce(power_units::text, 'null'), array_to_string(coverage_requested, ',')) from intake_submissions where id = :'sid';

-- Required answers missing on the server → not verified.
set role anon;
select submission_id as sid2 from start_intake_submission('tok-active', '33333333-3333-3333-3333-333333333333', '{"namedInsured":"No Email Co","dotNumber":"9","contactName":"Bo"}', 0) \gset
select 'Q12 finalize without email: ' || finalize_intake_submission(:'sid2', '33333333-3333-3333-3333-333333333333', '{}')::text;

-- A removed file isn't part of the submission.
select submission_id as sid3 from start_intake_submission('tok-active', '44444444-4444-4444-4444-444444444444', '{"namedInsured":"R Co","dotNumber":"9","contactName":"Bo","contactEmail":"b@x.com"}', 2) \gset
insert into storage.objects (bucket_id, name) values ('intake-uploads', :'sid3' || '/key-keep-0001/a.pdf'), ('intake-uploads', :'sid3' || '/key-drop-0002/b.pdf');
select attach_intake_document(:'sid3', '44444444-4444-4444-4444-444444444444', 'key-keep-0001', 'a.pdf', :'sid3' || '/key-keep-0001/a.pdf', 1) is not null as _a \gset
select attach_intake_document(:'sid3', '44444444-4444-4444-4444-444444444444', 'key-drop-0002', 'b.pdf', :'sid3' || '/key-drop-0002/b.pdf', 1) is not null as _b \gset
select log_intake_event(:'sid3', '44444444-4444-4444-4444-444444444444', 'file_failed', '{"file":"c.pdf","error":"timeout"}') is null as _c \gset
do $$ begin perform log_intake_event(current_setting('my.sid'), '44444444-4444-4444-4444-444444444444', 'completed', '{}'); raise notice 'Q13 forged event: ALLOWED (BAD)'; exception when others then raise notice 'Q13 forged or foreign event denied'; end $$;
select 'Q13 finalize with only a.pdf: ok=' || (r->>'ok') from finalize_intake_submission(:'sid3', '44444444-4444-4444-4444-444444444444', array['key-keep-0001']) r;
reset role;
select 'Q13 documents kept: ' || string_agg(file_name, ',') from intake_documents where intake_submission_id = :'sid3';

-- Abandoned: no activity for 3 hours → incomplete; the same browser can resume.
set role anon;
select submission_id as sid4 from start_intake_submission('tok-active', '55555555-5555-5555-5555-555555555555', '{"namedInsured":"Gone Co"}', 3) \gset
reset role;
update intake_submissions set last_activity_at = now() - interval '3 hours' where id = :'sid4';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'Q14 another broker marks stale: ' || mark_stale_intake_submissions();
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'Q14 owner marks stale: ' || mark_stale_intake_submissions();
select 'Q14 status: ' || status from intake_submissions where id = :'sid4';
set role anon;
select pg_temp.as_user('');
select 'Q15 resumed: ' || status from start_intake_submission('tok-active', '55555555-5555-5555-5555-555555555555', '{"namedInsured":"Gone Co","dotNumber":"1","contactName":"C","contactEmail":"c@x.com"}', 0);
select 'Q15 finalize after resume: ok=' || (r->>'ok') from finalize_intake_submission(:'sid4', '55555555-5555-5555-5555-555555555555', '{}') r;

-- Who can see what.
select 'Q16 anon reads submissions: ' || count(*) from intake_submissions;
do $$ begin perform count(*) from intake_events; raise notice 'Q16 anon reads events: ALLOWED (BAD)'; exception when others then raise notice 'Q16 anon reads events denied'; end $$;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select 'Q16 owner events for the first submission: ' || string_agg(event, ',' order by id) from intake_events where intake_submission_id = :'sid';
select 'Q16 owner events for the resumed one: ' || string_agg(event, ',' order by id) from intake_events where intake_submission_id = :'sid4';
update intake_submissions set status = 'imported', imported_account_id = 'acct_1' where id = :'sid';
select 'Q16 import recorded: ' || event from intake_events where intake_submission_id = :'sid' order by id desc limit 1;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'Q16 another broker reads events: ' || count(*) from intake_events;

-- A client from before 0029 (direct insert as 'pending', then upload) still works for a day.
set role anon;
select pg_temp.as_user('');
insert into intake_submissions (id, intake_link_id, user_id, status, named_insured) values ('isub_legacy', 'link1', '00000000-0000-0000-0000-00000000000d', 'pending', 'Legacy Co');
insert into storage.objects (bucket_id, name) values ('intake-uploads', 'isub_legacy/idoc_1/a.pdf');
insert into intake_documents (id, intake_submission_id, user_id, file_name, storage_path) values ('idoc_legacy', 'isub_legacy', '00000000-0000-0000-0000-00000000000d', 'a.pdf', 'isub_legacy/idoc_1/a.pdf');
select 'Q17 legacy client upload + attach: ok';
reset role;
