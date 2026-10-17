-- After rollback_0047.sql, once the new app is live again: new requests start as "Prepared" until
-- the broker marks them sent. Requests created while rolled back keep "Sent (unconfirmed)".

alter table public.document_requests alter column delivery_status set default 'prepared';

select column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'document_requests' and column_name = 'delivery_status';
