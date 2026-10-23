-- Rollback of 0072 (account duplicate check). Read-only functions only: no data to restore.
-- The app falls back to checking the accounts on the device when the function is missing.
begin;
drop function if exists public.find_account_duplicates(text, text, text);
drop function if exists public.account_name_similarity(text, text);
drop function if exists public.account_name_key(text);
drop function if exists public.normalize_account_name(text);
commit;
