-- 0071: Disconnecting Gmail deletes that user's mailbox data in RenewalIQ.
--
-- Removed for the disconnecting user only: their Gmail connection, encrypted token, pending (unfinished)
-- connections, stored thread details, email-to-account links and the links' review history. Deleting the
-- connection row removes the rest through the existing ON DELETE CASCADE keys (0068); pending connections
-- are deleted explicitly. Client accounts, documents, contacts and everything else are untouched — nothing
-- here references them except as the target of a link, and only the link is removed.
--
-- gmail_forget_mailbox(user) is for the gmail function (service role), which first revokes access at Google.
-- gmail_disconnect() (signed-in user, own data only) now does the same deletion.
-- Needs 0068. Re-runnable. Rollback: supabase/release/rollback_0071.sql (restores 0068's gmail_disconnect).

create or replace function public.gmail_forget_mailbox(p_user uuid) returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_user is null then return; end if;
  delete from public.gmail_oauth_pending where user_id = p_user;
  -- Cascades: gmail_tokens, email_threads → email_account_links → email_link_events.
  delete from public.gmail_connections where user_id = p_user;
end;
$$;
revoke all on function public.gmail_forget_mailbox(uuid) from public, anon, authenticated;
grant execute on function public.gmail_forget_mailbox(uuid) to service_role;

create or replace function public.gmail_disconnect() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  perform public.gmail_forget_mailbox(auth.uid());
end $$;
revoke all on function public.gmail_disconnect() from public, anon;
grant execute on function public.gmail_disconnect() to authenticated;
