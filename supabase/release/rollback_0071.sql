-- Rollback for 0071: back to 0068's disconnect (revokes the token, keeps thread details and links). Deleted data isn't restored.
create or replace function public.gmail_disconnect() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.gmail_tokens where user_id = auth.uid();
  update public.gmail_connections set status = 'disconnected', history_id = null, updated_at = now() where user_id = auth.uid();
end $$;
revoke all on function public.gmail_disconnect() from public, anon;
grant execute on function public.gmail_disconnect() to authenticated;
drop function if exists public.gmail_forget_mailbox(uuid);
