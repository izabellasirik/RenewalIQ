-- 0045_request_link_up_front.sql
-- "Request a document" shows the real secure upload link in the email as soon as the dialog opens,
-- instead of a placeholder. The app makes the link's random token (crypto.randomUUID — a v4 UUID,
-- as random as the database's own) when the dialog opens, and the request is created with that token
-- only when the broker copies the email, opens it in Gmail, or marks it sent — so a dialog that is
-- closed creates nothing.
--
-- create_document_request (0030) gets one optional parameter, p_token. Without it, the database
-- makes the token as before. Same checks, same security; the token column stays unique, so a token
-- can never be reused or point at another request. The old signature is dropped (a second overload
-- would make the API call ambiguous) and the same grants are given to the new one.
-- Additive in behaviour; safe to re-run. Needs 0030 first.

drop function if exists public.create_document_request(text, uuid, jsonb, text, jsonb, date, timestamptz);

create or replace function public.create_document_request(
  p_submission_id text,
  p_client_key uuid,
  p_contact jsonb,
  p_channel text,
  p_items jsonb,
  p_next_follow_up date,
  p_requested_at timestamptz default null,
  p_token uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.document_requests;
  v_actor text;
  e jsonb;
  n integer := 0;
begin
  if auth.uid() is null or not public.can_access_submission(p_submission_id) then
    raise exception 'You don''t have access to this account.' using errcode = '42501';
  end if;
  if p_client_key is not null then
    select * into r from public.document_requests where client_key = p_client_key;
    if found then
      if r.submission_id <> p_submission_id then
        raise exception 'Request key already used.' using errcode = '42501';
      end if;
      return jsonb_build_object('id', r.id, 'token', r.token, 'status', r.status);
    end if;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'Choose between 1 and 50 items to request.' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), u.email) into v_actor
    from auth.users u left join public.profiles p on p.user_id = u.id where u.id = auth.uid();

  insert into public.document_requests (id, submission_id, client_key, contact_id, contact_name, contact_email, channel, created_by, created_by_name, requested_at, next_follow_up, token)
  values ('dreq_' || replace(gen_random_uuid()::text, '-', ''), p_submission_id, p_client_key,
          left(p_contact->>'id', 80), left(nullif(btrim(coalesce(p_contact->>'name', '')), ''), 200), left(nullif(btrim(coalesce(p_contact->>'email', '')), ''), 320),
          coalesce(nullif(p_channel, ''), 'email'), auth.uid(), v_actor, coalesce(p_requested_at, now()), p_next_follow_up,
          coalesce(p_token, gen_random_uuid()))
  returning * into r;

  for e in select * from jsonb_array_elements(p_items) loop
    if coalesce(btrim(e->>'missingItemId'), '') = '' or coalesce(btrim(e->>'label'), '') = '' then
      raise exception 'Every requested item needs its checklist item and label.' using errcode = '22023';
    end if;
    insert into public.document_request_items (id, request_id, missing_item_id, label, instructions, position)
    values ('dri_' || replace(gen_random_uuid()::text, '-', ''), r.id, left(e->>'missingItemId', 120), left(btrim(e->>'label'), 300), left(nullif(btrim(coalesce(e->>'instructions', '')), ''), 1000), n)
    on conflict (request_id, missing_item_id) do nothing;
    n := n + 1;
  end loop;
  return jsonb_build_object('id', r.id, 'token', r.token, 'status', r.status);
end;
$$;

revoke all on function public.create_document_request(text, uuid, jsonb, text, jsonb, date, timestamptz, uuid) from public, anon;
grant execute on function public.create_document_request(text, uuid, jsonb, text, jsonb, date, timestamptz, uuid) to authenticated;
