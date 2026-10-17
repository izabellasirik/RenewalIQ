-- Driver experience precise to the month ("8 months", "1 year 6 months", "16+ years").
-- `drivers.years_experience` (0003) is an int and keeps holding whole years for anything that
-- reads it; the exact value now lives in `experience_months`, plus an "or more" flag. A NULL
-- experience_months means the row predates this migration — the app then reads years_experience
-- as years, exactly as before.
--
-- Purely additive, no new policies (the existing owner-only RLS on `drivers` covers the new
-- columns), safe to run more than once. Must run after 0003.

alter table drivers add column if not exists experience_months int;
alter table drivers add column if not exists experience_or_more boolean;

alter table drivers drop constraint if exists drivers_experience_months_nonneg;
alter table drivers add constraint drivers_experience_months_nonneg check (experience_months is null or experience_months >= 0);
