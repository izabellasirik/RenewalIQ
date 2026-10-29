-- Rollback of 0081: removes the partner / broker fee functions. The data is kept (partners, shares, each
-- account's referral source) so re-running 0081 restores everything; broker fees stay on the policies.
begin;
drop function if exists public.broker_fee_splits(date, date);
drop function if exists public.set_agent_broker_fee_share(uuid, text, numeric);
drop function if exists public.save_referral_source(uuid, text, bigint, boolean);
drop function if exists public.referral_source_names();
commit;
notify pgrst, 'reload schema';
