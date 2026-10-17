-- ROLLBACK 0047 — for running the PREVIOUS app version again on a database that has 0047.
--
-- 0047 only adds things, and the previous app ignores them, so nothing has to be removed (removing
-- would lose which requests were marked sent). The one thing to change: a request the previous app
-- creates must not start as "Prepared" (it has no "Mark as sent" button), so new requests start as
-- "Sent (unconfirmed)" — the same as every request from before 0047.
--
-- When the new app is live again, run rollforward_0047.sql.

alter table public.document_requests alter column delivery_status set default 'unconfirmed';

select column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'document_requests' and column_name = 'delivery_status';
