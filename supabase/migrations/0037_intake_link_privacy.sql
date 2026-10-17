-- Intake links are no longer readable by every signed-in user.
--
-- 0004 let anyone (anon and authenticated) SELECT every row of intake_links so the public form could
-- check a token. That also let any signed-in user of any agency list every link and its code. Now:
--   * a signed-in user reads only the links they manage — their own, and for an agency admin every
--     member's (the same rule as 0036's list/pause/delete: can_manage_intake_link);
--   * the public form looks a link up by its code through get_public_intake_link(token), which
--     returns that one link (or nothing) — the code is still the secret, and nothing can be listed.
-- The anonymous "submit through an active link" insert policy (the pre-0029 path) checked the link
-- with a subquery that relied on the open read; it now uses a definer helper so it behaves as before.
--
-- Additive; safe to run more than once. Must run after 0036.

create or replace function public.get_public_intake_link(p_token text)
returns table (id text, user_id uuid, label text, organization_name text, token text, active boolean, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.user_id, l.label, l.organization_name, l.token, l.active, l.created_at
    from public.intake_links l
   where p_token is not null and length(p_token) between 1 and 200 and l.token = p_token
$$;
revoke all on function public.get_public_intake_link(text) from public;
grant execute on function public.get_public_intake_link(text) to anon, authenticated;

create or replace function public.intake_link_accepts(p_link_id text, p_user_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.intake_links l where l.id = p_link_id and l.active and l.user_id = p_user_id)
$$;
revoke all on function public.intake_link_accepts(text, uuid) from public;
grant execute on function public.intake_link_accepts(text, uuid) to anon, authenticated;

drop policy if exists "anyone can read an intake link to validate it" on public.intake_links;
drop policy if exists "members read the intake links they manage" on public.intake_links;
create policy "members read the intake links they manage" on public.intake_links for select to authenticated
  using (public.can_manage_intake_link(user_id));

drop policy if exists "anon can submit through an active intake link" on public.intake_submissions;
create policy "anon can submit through an active intake link" on public.intake_submissions for insert to anon, authenticated
  with check (status = 'pending' and public.intake_link_accepts(intake_link_id, user_id));
