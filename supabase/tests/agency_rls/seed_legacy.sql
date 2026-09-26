grant all on all tables in schema public to authenticated;
-- Pre-0011 data, written through the OLD owner-only policies by each broker.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into submissions (id, user_id, named_insured) values ('acct_r1','00000000-0000-0000-0000-00000000000a','Roman Trucking'),('acct_r2','00000000-0000-0000-0000-00000000000a','Roman Freight');
insert into field_values (id, submission_id, user_id, section, field_key, value) values ('acct_r1::business::state','acct_r1','00000000-0000-0000-0000-00000000000a','business','state','"TX"');
insert into field_alternates (id, field_value_id, user_id, value) values ('alt1','acct_r1::business::state','00000000-0000-0000-0000-00000000000a','"OK"');
insert into activity_events (id, submission_id, user_id, type, message) values ('ev_r1','acct_r1','00000000-0000-0000-0000-00000000000a','account_created','created');
insert into storage.objects (bucket_id, name) values ('submission-documents','00000000-0000-0000-0000-00000000000a/acct_r1/doc1/loss_runs.pdf');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into submissions (id, user_id, named_insured) values ('acct_b1','00000000-0000-0000-0000-00000000000b','B Logistics');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into submissions (id, user_id, named_insured) values ('acct_o1','00000000-0000-0000-0000-00000000000c','Other Agency Co');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
insert into submissions (id, user_id, named_insured) values ('acct_n1','00000000-0000-0000-0000-00000000000e','Newbie Legacy');
reset role;
