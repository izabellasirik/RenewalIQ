-- Rollback of 0080: no more Admin Review flags. Review items and notifications already made are kept
-- (the 'admin_review' notification type stays allowed so they remain valid).
begin;
drop trigger if exists admin_review_on_account on public.submissions;
drop trigger if exists admin_review_on_number on public.field_values;
drop function if exists public.admin_review_on_account();
drop function if exists public.admin_review_on_number();
drop function if exists public.admin_review_check_duplicate(text, uuid);
drop function if exists public.admin_review_duplicates_of(text);
drop function if exists public.admin_review_items();
drop function if exists public.resolve_admin_review(uuid, text);
commit;
notify pgrst, 'reload schema';
