-- 0061 / 0062 Email Assistant: who can record and see email reviews, that a review can't be
-- rewritten, that the audit is append-only, the "seen before?" lookup, document fingerprints and
-- the AI operation. Run against a disposable copy of a database with 0061 and 0062 applied
-- (agencies and test users as in the agency RLS tests: one agency with an admin and two agents
-- (…0d, …0a, …0b); another agency with its admin (…12)). Fictional data. One transaction, rolled back. Prints one PASS/FAIL
-- line per check.
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

-- Fixture (as the SQL editor): a fictional account of Roman's and one of Agent B's in Adriatic Agency.
insert into submissions (id, user_id, organization_id, named_insured, assigned_user_id)
select 'acct_emt_roman', p.user_id, p.agency_id, 'Sample Haulers (email test)', p.user_id from profiles p where p.user_id = '00000000-0000-0000-0000-00000000000a';
insert into submissions (id, user_id, organization_id, named_insured, assigned_user_id)
select 'acct_emt_b', p.user_id, p.agency_id, 'Sample Freight (email test)', p.user_id from profiles p where p.user_id = '00000000-0000-0000-0000-00000000000b';
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;
grant usage on schema public to authenticated;
set local role authenticated;

\echo '== the agent records a review of their own account'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
with x as (
  insert into email_reviews (submission_id, created_by, agency_id, status, source_kind, fingerprint, sender_address, subject, attachment_count, category, confidence, intent, read_method, match_status, findings)
  values ('acct_emt_roman', '00000000-0000-0000-0000-00000000000b', null, 'applied', 'eml_upload', '0123456789abcdef', 'underwriter@carrier.example', 'Items needed to quote', 2, 'carrier_request', 0.9, 'document_request', 'rules', 'matched',
          '{"documents":[{"label":"Loss Runs","stance":"requested","evidence":"Please send 5 years of loss runs."}]}')
  returning id)
insert into ids select 'r1', id from x;
select pg_temp.check('R1 the agent records a review on their account', (select count(*) = 1 from ids where name = 'r1'));
select pg_temp.check('R2 … stamped with the agent, the account''s agency and status open (not what was sent)',
  (select created_by = '00000000-0000-0000-0000-00000000000a' and agency_id = (select organization_id from submissions where id = 'acct_emt_roman') and status = 'open' from email_reviews where id = (select id from ids where name = 'r1')));
select pg_temp.check('R3 not on an account the agent can''t open', pg_temp.refused($$insert into email_reviews (submission_id, source_kind, fingerprint, category, confidence, intent, read_method, match_status) values ('acct_emt_b', 'paste', '0123456789abcdef', 'unrelated', 0.9, 'other', 'rules', 'none')$$));
select pg_temp.check('R4 not on an account that doesn''t exist', pg_temp.refused($$insert into email_reviews (submission_id, source_kind, fingerprint, category, confidence, intent, read_method, match_status) values ('no_such_account', 'paste', '0123456789abcdef', 'unrelated', 0.9, 'other', 'rules', 'none')$$));
select pg_temp.check('R5 findings can''t hold a whole email (16 KB cap)', pg_temp.refused($$insert into email_reviews (submission_id, source_kind, fingerprint, category, confidence, intent, read_method, match_status, findings) values ('acct_emt_roman', 'paste', '0123456789abcdef', 'unrelated', 0.9, 'other', 'rules', 'none', jsonb_build_object('body', repeat(md5(random()::text), 2000)))$$));
select pg_temp.check('R6 a malformed fingerprint, category or confidence is refused',
  pg_temp.refused($$insert into email_reviews (submission_id, source_kind, fingerprint, category, confidence, intent, read_method, match_status) values ('acct_emt_roman', 'paste', 'not-a-hash', 'unrelated', 0.9, 'other', 'rules', 'none')$$)
  and pg_temp.refused($$insert into email_reviews (submission_id, source_kind, fingerprint, category, confidence, intent, read_method, match_status) values ('acct_emt_roman', 'paste', '0123456789abcdef', 'spam', 0.9, 'other', 'rules', 'none')$$)
  and pg_temp.refused($$insert into email_reviews (submission_id, source_kind, fingerprint, category, confidence, intent, read_method, match_status) values ('acct_emt_roman', 'paste', '0123456789abcdef', 'unrelated', 1.5, 'other', 'rules', 'none')$$));
select pg_temp.check('R7 a source the app doesn''t know is refused', pg_temp.refused($$insert into email_reviews (submission_id, source_kind, fingerprint, category, confidence, intent, read_method, match_status) values ('acct_emt_roman', 'imap', '0123456789abcdef', 'unrelated', 0.9, 'other', 'rules', 'none')$$));

\echo '== attachments: fingerprints only'
select pg_temp.check('T1 the agent records the attachments (name, size, SHA-256, kinds)', not pg_temp.refused(format($$insert into email_review_attachments (review_id, position, name, content_type, size_bytes, sha256, kinds, status) values (%L, 0, 'loss-runs.pdf', 'application/pdf', 52100, repeat('a', 64), '{loss_runs}', 'new'), (%L, 1, 'loss-runs copy.pdf', 'application/pdf', 52100, repeat('a', 64), '{loss_runs}', 'repeated_in_email')$$, (select id from ids where name = 'r1'), (select id from ids where name = 'r1'))));
select pg_temp.check('T2 a malformed SHA-256 or status is refused', pg_temp.refused(format($$insert into email_review_attachments (review_id, position, name, sha256, status) values (%L, 2, 'x.pdf', 'abc', 'new')$$, (select id from ids where name = 'r1'))) and pg_temp.refused(format($$insert into email_review_attachments (review_id, position, name, status) values (%L, 2, 'x.pdf', 'imported')$$, (select id from ids where name = 'r1'))));
select pg_temp.check('T3 attachments can''t be changed or removed', pg_temp.refused($$update email_review_attachments set name = 'other.pdf'$$) and pg_temp.refused($$delete from email_review_attachments$$));

\echo '== the review itself: only its status changes'
select pg_temp.check('U1 the agent can''t rewrite what was found', pg_temp.refused($$update email_reviews set subject = 'Something else'$$) and pg_temp.refused($$update email_reviews set findings = '{}'$$) and pg_temp.refused($$update email_reviews set category = 'unrelated'$$));
select pg_temp.check('U2 the agent marks it applied', not pg_temp.refused($$update email_reviews set status = 'applied' where submission_id = 'acct_emt_roman'$$));
select pg_temp.check('U2b … and it is', (select status = 'applied' from email_reviews where id = (select id from ids where name = 'r1')));
select pg_temp.check('U3 … and can''t reopen it', pg_temp.refused($$update email_reviews set status = 'open' where submission_id = 'acct_emt_roman'$$));
select pg_temp.check('U4 reviews can''t be deleted', pg_temp.refused($$delete from email_reviews$$));
select pg_temp.check('U5 no new attachments once it is applied', pg_temp.refused(format($$insert into email_review_attachments (review_id, position, name, status) values (%L, 5, 'late.pdf', 'new')$$, (select id from ids where name = 'r1'))));

\echo '== the audit: append-only, stamped'
select pg_temp.check('A1 the agent records approvals and imports', not pg_temp.refused(format($$insert into email_review_actions (review_id, submission_id, actor_id, action, suggestion_kind, detail, document_ids) values (%L, 'acct_emt_b', '00000000-0000-0000-0000-00000000000d', 'approved', 'add_to_checklist', 'Checklist updated: Loss Runs.', '{}'), (%L, 'x', null, 'imported', 'import_attachments', 'Imported loss-runs.pdf', '{doc_1}')$$, (select id from ids where name = 'r1'), (select id from ids where name = 'r1'))));
select pg_temp.check('A2 … stamped with the agent and the review''s account (not what was sent)', (select bool_and(actor_id = '00000000-0000-0000-0000-00000000000a' and submission_id = 'acct_emt_roman') and count(*) = 2 from email_review_actions where review_id = (select id from ids where name = 'r1')));
select pg_temp.check('A3 audit entries can''t be changed or deleted', pg_temp.refused($$update email_review_actions set detail = 'x'$$) and pg_temp.refused($$delete from email_review_actions$$));
select pg_temp.check('A4 an action the app doesn''t know is refused (nothing is ever "sent")', pg_temp.refused(format($$insert into email_review_actions (review_id, submission_id, action) values (%L, 'acct_emt_roman', 'sent')$$, (select id from ids where name = 'r1'))));

\echo '== seen before?'
select pg_temp.check('S1 the same email: when it was reviewed on this account', (select (public.email_review_seen('acct_emt_roman', '0123456789abcdef', '{}')) ->> 'reviewed_at' is not null));
select pg_temp.check('S2 the same file: which earlier email it came with', (select jsonb_array_length(public.email_review_seen('acct_emt_roman', 'ffffffffffffffff', array[repeat('a', 64), repeat('b', 64)]) -> 'attachments') = 1));
select pg_temp.check('S3 a different email on the account: not seen', (select (public.email_review_seen('acct_emt_roman', 'ffffffffffffffff', '{}')) ->> 'reviewed_at' is null));
select pg_temp.check('S4 not for an account the agent can''t open', pg_temp.refused($$select public.email_review_seen('acct_emt_b', '0123456789abcdef', '{}')$$));

\echo '== other agents, admins, other agencies'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('V1 another agent doesn''t see the review, its attachments or its audit', (select count(*) = 0 from email_reviews where submission_id = 'acct_emt_roman') and (select count(*) = 0 from email_review_attachments where review_id = (select id from ids where name = 'r1')) and (select count(*) = 0 from email_review_actions where review_id = (select id from ids where name = 'r1')));
select pg_temp.check('V2 … can''t add to its audit or attachments', pg_temp.refused(format($$insert into email_review_actions (review_id, submission_id, action) values (%L, 'acct_emt_roman', 'dismissed')$$, (select id from ids where name = 'r1'))) and pg_temp.refused(format($$insert into email_review_attachments (review_id, position, name, status) values (%L, 9, 'x.pdf', 'new')$$, (select id from ids where name = 'r1'))));
update email_reviews set status = 'dismissed';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check('V3 … and can''t change its status (it is unchanged)', (select status = 'applied' from email_reviews where id = (select id from ids where name = 'r1')));
select pg_temp.check('V5 the agency admin sees the review, its attachments and its audit', (select count(*) = 1 from email_reviews where submission_id = 'acct_emt_roman') and (select count(*) = 2 from email_review_attachments where review_id = (select id from ids where name = 'r1')) and (select count(*) = 2 from email_review_actions where review_id = (select id from ids where name = 'r1')));
select pg_temp.check('V6 … and can add to its audit', not pg_temp.refused(format($$insert into email_review_actions (review_id, submission_id, action, detail) values (%L, 'acct_emt_roman', 'draft_copied', 'Reply draft copied')$$, (select id from ids where name = 'r1'))));
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check('V7 another agency''s admin sees nothing of this agency''s', (select count(*) = 0 from email_reviews where agency_id is distinct from (select agency_id from profiles where user_id = '00000000-0000-0000-0000-000000000012')) and (select count(*) = 0 from email_review_attachments a where not exists (select 1 from email_reviews r where r.id = a.review_id)) and (select count(*) = 0 from email_review_actions where submission_id = 'acct_emt_roman'));
select pg_temp.check('V8 … can''t record a review on, add to, or look up this agency''s account',
  pg_temp.refused($$insert into email_reviews (submission_id, source_kind, fingerprint, category, confidence, intent, read_method, match_status) values ('acct_emt_roman', 'paste', '0123456789abcdef', 'unrelated', 0.9, 'other', 'rules', 'none')$$)
  and pg_temp.refused(format($$insert into email_review_actions (review_id, submission_id, action) values (%L, 'acct_emt_roman', 'dismissed')$$, (select id from ids where name = 'r1')))
  and pg_temp.refused($$select public.email_review_seen('acct_emt_roman', '0123456789abcdef', '{}')$$));

\echo '== losing access to the account hides its reviews'
reset role;
update submissions set assigned_user_id = '00000000-0000-0000-0000-00000000000b' where id = 'acct_emt_roman';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('L1 reassigned away: the creator no longer sees the review', (select count(*) = 0 from email_reviews where submission_id = 'acct_emt_roman') and (select count(*) = 0 from email_review_actions where review_id = (select id from ids where name = 'r1')));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('L2 the new agent sees that it was reviewed (seen before?), not the review', (select (public.email_review_seen('acct_emt_roman', '0123456789abcdef', '{}')) ->> 'reviewed_at' is not null) and (select count(*) = 0 from email_reviews where submission_id = 'acct_emt_roman'));

\echo '== document fingerprints'
reset role;
select pg_temp.check('D1 a document''s SHA-256 must be 64 hex characters', pg_temp.refused($$insert into documents (id, submission_id, user_id, name, file_type, content_sha256) values ('doc_em_bad', 'acct_emt_roman', '00000000-0000-0000-0000-00000000000a', 'x.pdf', 'pdf', 'ABC')$$));
select pg_temp.check('D2 … a valid one is kept', not pg_temp.refused($$insert into documents (id, submission_id, user_id, name, file_type, content_sha256) values ('doc_em_ok', 'acct_emt_roman', '00000000-0000-0000-0000-00000000000a', 'x.pdf', 'pdf', repeat('c', 64))$$));
select pg_temp.check('D3 documents without one still save (older apps)', not pg_temp.refused($$insert into documents (id, submission_id, user_id, name, file_type) values ('doc_em_old', 'acct_emt_roman', '00000000-0000-0000-0000-00000000000a', 'y.pdf', 'pdf')$$));

\echo '== 0062: the AI email operation'
select pg_temp.check('G1 usage can be logged for email reads', not pg_temp.refused($$insert into ai_usage_events (operation, succeeded) values ('email_extraction', true)$$));
select pg_temp.check('G2 … and cached', not pg_temp.refused($$insert into ai_read_cache (cache_key, scope, operation, status) values ('k_em', 's', 'email_extraction', 'pending')$$));
select pg_temp.check('G3 an unknown operation is still refused', pg_temp.refused($$insert into ai_usage_events (operation, succeeded) values ('anything', true)$$));
select pg_temp.check('G4 the existing operations still work', not pg_temp.refused($$insert into ai_usage_events (operation, succeeded) values ('structured_extraction', true), ('transcription', true)$$));

\echo '== anonymous'
set local role anon;
select pg_temp.check('E1 anonymous: can''t read reviews, attachments or the audit', pg_temp.refused($$select 1 from public.email_reviews$$) and pg_temp.refused($$select 1 from public.email_review_attachments$$) and pg_temp.refused($$select 1 from public.email_review_actions$$));
select pg_temp.check('E2 anonymous: can''t look anything up', pg_temp.refused($$select public.email_review_seen('acct_emt_roman', '0123456789abcdef', '{}')$$));
reset role;
rollback;
