-- Professional profile: work phone and job title on the agency member profile, and a way for each
-- user to save their OWN name / phone / title (the "Set up your profile" screen after first sign-in).
--
-- Reuses public.profiles from 0011 — display_name is the user's full name, email stays as it is.
-- An agency admin can already read every profile in their agency (0011's select policy), so a future
-- Team page needs nothing more than these columns.
--
-- profiles still has NO insert/update/delete policy for app users (that's what stops anyone changing
-- their own role or agency). save_my_profile() below is the only write path, and it can only change
-- display_name / phone / job_title on the caller's own row. Users who aren't in an agency have no
-- profiles row; their name/phone/title live in their Supabase Auth user metadata (set by the app).
--
-- Purely additive and safe to run more than once. Must run after 0011. RLS on every table is unchanged.

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists job_title text;

create or replace function public.save_my_profile(p_full_name text, p_phone text, p_job_title text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  updated integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if nullif(btrim(coalesce(p_full_name, '')), '') is null then
    raise exception 'Full name is required';
  end if;
  update public.profiles
     set display_name = left(btrim(p_full_name), 200),
         phone = left(nullif(btrim(coalesce(p_phone, '')), ''), 50),
         job_title = left(nullif(btrim(coalesce(p_job_title, '')), ''), 200)
   where user_id = auth.uid();
  get diagnostics updated = row_count;
  -- false = not in an agency (no profiles row); the app keeps the profile in auth metadata only.
  return updated > 0;
end;
$$;

revoke all on function public.save_my_profile(text, text, text) from public;
revoke all on function public.save_my_profile(text, text, text) from anon;
grant execute on function public.save_my_profile(text, text, text) to authenticated;
