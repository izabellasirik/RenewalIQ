-- Who did each activity, for the Activity tab. The person is already recorded: activity_events.user_id
-- is the Supabase user who saved the event, and RLS (0011) only lets a user insert rows with their
-- own user_id — so that id can't be faked. This adds their display name alongside it, so the
-- timeline can say "by Roman" to anyone who can see the account (agents can't look up other
-- agents' profiles). The name is display-only; user_id stays the authoritative actor.
--
-- Purely additive, nullable (older events simply have no name), no RLS change. Safe to run more
-- than once. Must run after 0003. Until it's applied, the app saves activity without the name.

alter table public.activity_events add column if not exists actor_name text;
