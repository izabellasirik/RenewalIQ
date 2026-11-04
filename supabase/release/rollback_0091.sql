-- Rollback of 0091: removes partner payments (the record of what was paid to partners is deleted).
begin;
drop function if exists public.undo_partner_payment(uuid, text);
drop function if exists public.record_partner_payments(date, jsonb);
drop table if exists public.partner_payments;
notify pgrst, 'reload schema';
commit;
