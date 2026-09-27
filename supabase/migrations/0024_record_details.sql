-- Fix: driver (and vehicle) edits disappearing after a refresh or on another device.
--
-- The drivers table (0003) only had columns for name, date of birth, license state, experience and
-- violations. Everything else a broker sees and edits on a driver — address, license number, class,
-- CDL, issue and expiration dates, restrictions, endorsements — was never saved to the cloud, so the
-- next load from the database dropped it. Vehicles lost their plate the same way.
--
-- One additive `details` jsonb column per record table holds every field without its own column.
-- New per-record fields (driver date of hire, license issue date, driver notes, MVR report date,
-- claim details on a loss) go there too, so they need no further migrations. The app writes and
-- reads it; nothing here changes who can see or edit a row (0011's policies apply unchanged).
--
-- submissions.loss_runs holds the account's loss-run reports (carrier, policy number, report date,
-- coverage period, totals); each claim in `losses` points at its report through details.lossRunId.
--
-- Additive; safe to run more than once. Must run after 0003.

alter table public.drivers add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.vehicles add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.losses add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.submissions add column if not exists loss_runs jsonb not null default '[]'::jsonb;

alter table public.drivers drop constraint if exists drivers_details_object;
alter table public.drivers add constraint drivers_details_object check (jsonb_typeof(details) = 'object');
alter table public.vehicles drop constraint if exists vehicles_details_object;
alter table public.vehicles add constraint vehicles_details_object check (jsonb_typeof(details) = 'object');
alter table public.losses drop constraint if exists losses_details_object;
alter table public.losses add constraint losses_details_object check (jsonb_typeof(details) = 'object');
alter table public.submissions drop constraint if exists submissions_loss_runs_array;
alter table public.submissions add constraint submissions_loss_runs_array check (jsonb_typeof(loss_runs) = 'array');
