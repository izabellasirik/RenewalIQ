# Supabase Setup — Appetite Update Workflow, Product Feedback & Broker Cloud Workspaces

The "Request Appetite Update" broker form, the "Feedback" button (general product feedback about
Renewal IQ itself — a deliberately separate concept from an appetite-update request, see §8), the
Admin Dashboard (`/admin`, `/admin/appetite-updates`, `/admin/feedback`), — as of migration
0003 — **broker sign-up/sign-in and cross-device submission sync** (`/login`, `/signup`), and — as
of migrations 0004/0005 — **Submission Intake** (`/intake-links`, the public, no-login
`/intake/:token` form) all need a Supabase project. Nothing else in Renewal IQ depends on Supabase:
with no project configured, every broker feature still works fully, entirely offline, in this
browser only — sign-in just isn't available, the account/profile menu shows "Local only", and
Submission Intake shows a "Cloud sign-in isn't configured" message instead of the link manager.

## 1. Create the project

If you don't already have one: [supabase.com](https://supabase.com) → New Project. Free tier is
sufficient for this workload.

## 2. Run the migrations

Nine migration files, run in order — all are required, and **none has been applied to any live
Supabase project by this repo automatically**. Run each one yourself, once, via the Supabase SQL
editor (paste the file's contents and run) or the Supabase CLI (`supabase db push`):

- **`supabase/migrations/0001_appetite_update_workflow.sql`** — creates the appetite-update-request
  tables, row-level security policies, the `is_admin()` helper, and the
  `review_appetite_update_request()` function the admin page uses to approve/reject/
  mark-needs-more-information.
- **`supabase/migrations/0002_product_feedback.sql`** — creates the separate `product_feedback`
  table (general feedback about Renewal IQ itself — bugs, ideas, comments; distinct from an
  appetite-update request) and its own RLS policies. Reuses the `is_admin()` helper created in
  0001, so **0001 must run first**.
- **`supabase/migrations/0003_broker_workspaces.sql`** — creates the broker cloud-workspace schema:
  `submissions`, `field_values`, `field_alternates`, `coverage_lines`, `vehicles`, `drivers`,
  `losses`, `documents`, `activity_events` — one row-level-security policy set per table, entirely
  separate from `admin_users`/`is_admin()` (a broker signing up here can **never** become an admin,
  and an admin gets **no** special access to broker data). Also creates the private
  `submission-documents` Storage bucket and its access policies. **Read the security-model comment
  at the top of the file before applying it** — this is the migration that makes cross-device
  broker accounts possible, and its RLS is what keeps one broker's submissions private from every
  other broker.

  This migration's design (schema + Row Level Security + Storage policies) was verified against a
  real local Postgres instance with a stubbed `auth`/`storage` schema standing in for the parts of
  the Supabase platform that RLS policies depend on — two synthetic users, full CRUD as each,
  cross-user read/write/delete attempts, anonymous access attempts, and cascade-on-delete were all
  exercised directly in SQL and behaved exactly as the security model describes. It was **not**
  possible to run a full end-to-end browser test against a live Supabase Auth + PostgREST + Storage
  API in this environment (no Docker/local Supabase stack, no live project credentials) — do a
  quick manual smoke test after applying it (§9 below covers exactly that).

  **Storage bucket**: the migration attempts to create the `submission-documents` bucket itself
  (`insert into storage.buckets ...`), which works on most Supabase projects, but bucket creation
  permissions vary by plan/version. If the migration errors on that one statement, or if the bucket
  doesn't appear afterward, create it manually: **Storage → New bucket** → name it exactly
  `submission-documents` → **leave "Public bucket" OFF**. The migration's Storage policies apply to
  the bucket by name regardless of how it was created.
- **`supabase/migrations/0004_intake_submissions.sql`** — creates the **Submission Intake**
  schema: `intake_links` (a broker's shareable, unauthenticated links), `intake_submissions` (an
  applicant's raw answers, staged — never written directly into a broker's live `submissions`
  table), and `intake_documents` (metadata for files an applicant uploaded), plus the private
  `intake-uploads` Storage bucket. This is deliberately a **staging** design: an anonymous visitor
  can only ever `INSERT` into these tables (never read anything back), and a signed-in broker's own
  "Import" click (`/intake-links`) is what turns a submission into a real account — no service-role
  key or server-side function is used anywhere in this flow. **Read the security-model comment at
  the top of the file before applying it.** Same bucket-creation caveat as 0003: if
  `insert into storage.buckets ...` errors, create the `intake-uploads` bucket manually (**Storage →
  New bucket** → name it exactly `intake-uploads` → **leave "Public bucket" OFF**) — the migration's
  Storage policies apply by name regardless of how the bucket was created.
- **`supabase/migrations/0005_submission_contact_fields.sql`** — adds three nullable columns
  (`contact_name`, `contact_email`, `contact_phone`) to the existing `submissions` table from 0003,
  so an account created by importing an intake submission keeps the applicant's contact info after
  a reload. Must run after 0003.
- **`supabase/migrations/0006_widen_coverage_type_check.sql`** — widens the `coverage_lines`
  coverage-type check to include Trailer Interchange and Non-Trucking Liability. Must run after 0003.
- **`supabase/migrations/0007_account_workflow.sql`** — adds the account-workflow columns to
  `submissions`: `contacts`, `assigned_broker`, `missing_items` (the submission checklist, including
  carrier-requested items), and `market_quotes` (Markets & Quotes with dated notes). Purely additive
  jsonb columns, covered by the existing owner-only RLS on `submissions` — no new policies. Must run
  after 0003. Until it's applied, cloud-backed accounts still sync their Risk Profile, but the
  workspace shows "Failed to save to your account" and contacts/checklist/quotes stay in this
  browser only.
- **`supabase/migrations/0008_account_stage.sql`** — adds a nullable `stage` column to
  `submissions` for the broker-set client status (New, Collecting info, Out to market, Quoted,
  Bound, On hold, …) used by the Accounts list filters. NULL means "automatic". Additive, no new
  policies, safe to re-run. Must run after 0003. Until it's applied, a manually-set status stays in
  this browser only and the app shows "Failed to save to your account".
- **`supabase/migrations/0009_account_follow_ups.sql`** — adds a `follow_ups` jsonb column to
  `submissions` for follow-ups scheduled by hand on an account (who, date, notes), shown on Today's
  Plate. Additive, no new policies, safe to re-run. Must run after 0003.
- **`supabase/migrations/0010_driver_experience_months.sql`** — adds `experience_months` and
  `experience_or_more` to `drivers` so driver experience keeps month precision ("8 months",
  "1 year 6 months", "16+ years"). Additive, no new policies, safe to re-run. Must run after 0003.
  Until it's applied, driver experience syncs as whole years only and the app says so.
- **`supabase/migrations/0011_agency_roles.sql`** — agency permissions (Agent vs Admin), enforced
  by RLS. Adds `agencies`, `profiles` (user → agency + role), and `submissions.assigned_user_id`;
  reuses `submissions.organization_id` as the agency. Replaces 0003's owner-only policies on every
  broker table and on the `submission-documents` bucket with one rule: an **agent** reaches only
  accounts assigned to them, an **admin** reaches every account in their agency, nobody reaches
  another agency. Accounts not yet in an agency keep 0003's owner-only access, so nothing moves or
  disappears until you run the agency setup below. Safe to re-run. Must run after 0003.
- **`supabase/migrations/0012_widen_extraction_method_check.sql`** — lets fields read from a photo
  (`vision_extraction`) or filled in by a client on a submission link (`applicant_provided`) be
  saved; without it those saves fail with "Failed to save to your account". Same change as
  eloquent-planck's `0006_widen_extraction_method_check.sql` — harmless if that was already run.
- **`supabase/migrations/0013_intake_link_organization_name.sql`** — the agency name clients see on a
  submission link. Same column as eloquent-planck's `0007_intake_link_organization_name.sql` —
  does nothing if that was already run.
- **`supabase/migrations/0014_activity_actor_name.sql`** — saves the person's name with each
  activity entry so the Activity tab can show who did it to everyone on the account (agents can't
  look up other members' profiles). The person's user id was already recorded. Additive, safe to
  re-run. Until it's applied, activity still saves; agents just see no name on others' entries.
- **`supabase/migrations/0015_document_source_url.sql`** — keeps the link a document came from when
  it arrived as a URL instead of a file (opened and read when possible; otherwise shown as
  "Document could not be accessed — upload the file directly."). Additive, safe to re-run. Until
  it's applied, those documents still save, just without the link.
- **`supabase/migrations/0016_account_done_actions.sql`** — remembers tasks a broker marked **Done**
  on the Overview / Today's Plate (tasks are derived, so "done" is stored on the account). Additive,
  safe to re-run. Until it's applied, a task marked done stays done only in that browser and the app
  says it couldn't be saved.
- **`supabase/migrations/0017_profile_contact_fields.sql`** — work phone and job title on the agency
  member profile, and `save_my_profile()`, the only way a user can edit their own name / phone /
  title (never their role or agency). Additive, safe to re-run, RLS unchanged. Until it's applied,
  the "Set up your profile" screen still works (saved on the login), but agency admins keep seeing
  the name from the setup script.
- **`supabase/migrations/0018_agency_invitations.sql`** — Team invitations. An agency admin invites a
  work email with a role (Agent / Admin) from the **Team** page; the person opens the link, signs up
  or signs in with that email, and joins that agency with that role. Only admins can invite; the
  agency is always the admin's own; accepting requires the signed-in, confirmed login email to match
  the invitation; someone already in another agency is refused. Existing tables, policies and
  account permissions are unchanged. Additive, safe to re-run; run after 0017. Invitation sign-up
  emails need the Redirect URLs from §6.

**Read the security model comment at the top of each file.** In short: an anonymous broker can
only insert a new appetite-update request or feedback entry, and read approved appetite overrides
— nothing else, on any table. Only a signed-in user listed in `admin_users` can read either queue.
Reviewing an appetite-update request happens exclusively through `review_appetite_update_request()`,
which re-checks admin status itself server-side; updating a feedback entry's status is a plain
RLS-gated `UPDATE`, gated the same way (`is_admin()`) but without a dedicated function, since it
doesn't need the multi-table atomic transaction the appetite-update review does.

### Agency setup (Agent vs Admin) — after 0011

Roles live in the database (`profiles.role`), never in frontend code, and there is no in-app way to
grant them — only the SQL editor. Open `supabase/setup/agency_setup.sql`, replace the placeholder
agency name and emails, and run its steps one at a time:

1. **Preview (read-only)** — every login and how many accounts each created, and every account not
   yet in an agency with its creator.
2. **Create the agency.**
3. **Add people** — 3a makes the owner an `admin`; repeat 3b for each broker as an `agent`. A person
   must have signed up first (exist under Authentication → Users). To also give the owner the
   existing `/admin/feedback` and appetite-update review, they must be in `admin_users` too (the
   optional statement in step 3) — that list is separate and unchanged.
4. **Move existing accounts into the agency** — each account is assigned to the broker who created
   it, so agents keep seeing exactly what they see today and the admin sees them all.
5. **Check** — counts of accounts per agent.

Reassigning later: the admin picks the agent in the account's **Assigned agent** dropdown (or step 6
of the script). Removing someone: reassign their accounts, then delete their `profiles` row. Don't
delete their auth user — 0003's foreign keys cascade and would delete every account they created.

To re-run the database permission tests locally (needs `psql` + a throwaway Postgres):
`PGHOST=localhost PGUSER=postgres ./supabase/tests/agency_rls/run.sh`.

### Checking which migrations are applied

Not sure what's already been run on a project? Paste this read-only query into the SQL editor —
any row showing `MISSING` is a migration you still need to apply (in number order). A
"Could not find the table 'public.<name>' in the schema cache" error in the app almost always
means the migration that creates that table was never run (e.g. `product_feedback` → 0002).

```sql
-- RenewalIQ: which migrations are applied? (read-only)
select m.migration, case when m.applied then 'applied' else 'MISSING' end as status
from (values
  ('0001_appetite_update_workflow',   to_regclass('public.appetite_update_requests') is not null and to_regprocedure('public.is_admin()') is not null),
  ('0002_product_feedback',           to_regclass('public.product_feedback') is not null),
  ('0003_broker_workspaces',          to_regclass('public.submissions') is not null),
  ('0004_intake_submissions',         to_regclass('public.intake_links') is not null),
  ('0005_submission_contact_fields',  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'submissions' and column_name = 'contact_name')),
  ('0006_widen_coverage_type_check',  exists (select 1 from pg_constraint where conrelid = to_regclass('public.coverage_lines') and pg_get_constraintdef(oid) like '%trailer_interchange%')),
  ('0007_account_workflow',           exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'submissions' and column_name = 'missing_items')),
  ('0008_account_stage',              exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'submissions' and column_name = 'stage')),
  ('0009_account_follow_ups',         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'submissions' and column_name = 'follow_ups')),
  ('0010_driver_experience_months',   exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drivers' and column_name = 'experience_months')),
  ('0011_agency_roles',               to_regclass('public.profiles') is not null),
  ('0012_widen_extraction_method',    exists (select 1 from pg_constraint where conrelid = to_regclass('public.field_values') and pg_get_constraintdef(oid) like '%applicant_provided%')),
  ('0013_intake_link_org_name',       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'intake_links' and column_name = 'organization_name')),
  ('0014_activity_actor_name',        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activity_events' and column_name = 'actor_name')),
  ('0015_document_source_url',        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'source_url')),
  ('0016_account_done_actions',       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'submissions' and column_name = 'done_actions')),
  ('0017_profile_contact_fields',     to_regprocedure('public.save_my_profile(text,text,text)') is not null),
  ('0018_agency_invitations',         to_regclass('public.agency_invitations') is not null),
  ('bucket: submission-documents',    exists (select 1 from storage.buckets where id = 'submission-documents')),
  ('bucket: intake-uploads',          exists (select 1 from storage.buckets where id = 'intake-uploads'))
) as m(migration, applied);
```

If a table was just created and the app still reports the schema-cache error, run
`notify pgrst, 'reload schema';` once in the SQL editor.

## 3. Get your API credentials

Project Settings → API in the Supabase dashboard:

- **Project URL** → `VITE_SUPABASE_URL`
- **`anon` `public` key** → `VITE_SUPABASE_ANON_KEY`

**Do not use the `service_role` key anywhere in this project.** It bypasses row-level security
entirely, and anything prefixed `VITE_` is bundled into the browser JavaScript and downloadable by
anyone who visits the site — putting the service-role key there would be equivalent to publishing
full database admin access. This codebase only ever reads the anon key
(`src/services/supabase/client.ts`); it doesn't need the service-role key anywhere, since admin
writes go through `review_appetite_update_request()`, a `SECURITY DEFINER` database function that
re-verifies the caller is an admin before doing anything.

## 4. Configure the app

```
cp .env.example .env.local
```

Fill in the two values. `.env.local` is git-ignored — never commit it. If deploying (e.g. Vercel),
set the same two variables in the platform's environment-variable settings instead of a file.

If these variables are absent, the app runs normally in every other respect: the appetite-update
form clearly reports that submission isn't available rather than silently failing or lying about
success, and `/admin/appetite-updates` shows a "Supabase not configured" state instead of a login
form or an empty/broken queue.

## 5. Make yourself an admin

There is deliberately no self-service sign-up in the app — creating the first (or any) admin
account happens directly in the Supabase dashboard, never through a public form:

1. In the Supabase dashboard: **Authentication → Users → Add user**. Enter your email and a
   password, and check **Auto Confirm User** (so you don't need to click an email confirmation
   link). Click Create.
2. Copy the new user's **User UID** (shown in the users list, or on the user's detail page).
3. In the **SQL Editor**, run:
   ```sql
   insert into admin_users (user_id, email) values ('<paste-the-uid-here>', 'your@email.com');
   ```
4. Go to `/admin/appetite-updates` in the running app and sign in with that email/password.

To add a second admin later, repeat the same three steps for that person — there's no in-app "add
admin" button by design, so this stays entirely under your control in the Supabase dashboard.

## 6. Auth email links — Site URL and Redirect URLs (required, one-time dashboard step)

Every email Supabase sends for Renewal IQ has a link back into the app: **sign-up confirmation**,
**forgot password** (brokers → `/login`, admins → `/admin`) and **team invitations** (`/invite/…`).
The app always asks Supabase to send people back to the site they're using right now — production
on production, a Vercel preview on that preview, localhost in development (`src/services/supabase/authRedirect.ts`).
Supabase only honours that address if it's on the allow-list; **anything else silently falls back
to the Site URL**, which is `http://localhost:3000` on a new project. That is why a link can open
`localhost:3000`.

In the Supabase dashboard → **Authentication → URL Configuration**:

1. **Site URL** → your production Renewal IQ address, e.g. `https://your-production-domain.com`
   (no path). This is the fallback, so it must never be localhost.
2. **Redirect URLs** → add:
   - `https://your-production-domain.com/**`
   - your Vercel preview URLs: `https://*-your-vercel-team.vercel.app/**` (the part after the last
     `-` in any preview URL is your team slug)
   - `http://localhost:5173/**` for local development

The `/**` covers `/login`, `/admin` and `/invite/…`. After a reset link opens the app, the person
sees **Set a new password**, saves it, and continues signed in; next time they sign in with the new
password. An expired or already-used link shows "That email link has expired or was already used".

## 7. Managing broker appetite-update requests and product feedback

Once you're an admin (§5), go to **`/admin`** on the running app (e.g. `https://your-production-domain.com/admin`
in production, or `http://localhost:5173/admin` locally). This is the Admin Dashboard: sign in there
with the same admin email/password, and you'll see counts and recent activity for both queues:

- **Appetite Update Requests** — "View all requests" goes to `/admin/appetite-updates`, the full
  queue with filters (Pending, Needs More Info, Approved, Rejected, All — Pending is the default)
  and the Approve / Reject / Needs More Information actions.
- **Product Feedback** — general feedback about Renewal IQ itself (bugs, ideas, comments), submitted
  from the "Feedback" button anywhere in the broker product. **Deliberately a separate concept from
  an appetite-update request** — it's not a correction to carrier/MGA data, just feedback about the
  product. "View all feedback" goes to **`/admin/feedback`**, filterable by New (the default),
  Reviewed, Resolved, or All, with Mark Reviewed / Mark Resolved actions. Entries are never deleted,
  only their status changes, so nothing submitted is ever lost.

There's a small "Admin" link at the bottom of the broker product's sidebar that goes to `/admin` —
deliberately understated (this is an internal tool for you, not a feature brokers are meant to
notice), but it's there if you'd rather click than type the URL. Every `/admin*` page requires the
same admin sign-in described in §5 — **completely separate** from the broker sign-in at `/login`
(see §9). Signing up as a broker never adds anyone to `admin_users`, and being an admin never
grants access to any broker's submission data.

## 8. Where your data actually lives in Supabase

If you ever need to inspect or fix something by hand, go to the Supabase dashboard's **Table
Editor** (or the SQL Editor) for these tables — this is the same data the Admin Dashboard reads and
writes, just the raw rows:

- **`appetite_update_requests`** — every broker submission, one row per request, in whatever state
  it's currently in (`pending`, `needs_more_information`, `approved`, or `rejected`). This is the
  table the Admin Dashboard's counts and "Recent Requests"/request queue are drawn from.
- **`appetite_overrides`** — the live, effective override for a given market + field, written only
  when a request is **approved**. This is what the public app (Market Finder, Carrier Appetite)
  actually reads at runtime and layers on top of the static base appetite data — publicly readable,
  admin-write-only.
- **`appetite_update_history`** — a durable, append-only audit trail: one row per review decision
  ever made (approve, reject, or needs-more-info), including the before/after value and who decided
  it. Nothing is ever deleted from this table, including for rejections, so it's the place to look
  for "what happened to this request over time."
- **`product_feedback`** — every general feedback submission, one row per entry, with its current
  `status` (`new`, `reviewed`, or `resolved`). Completely separate from the three tables above —
  this is what `/admin/feedback` reads and writes. Never deleted, only its status changes.

The first three are written together in one transaction by `review_appetite_update_request()` (see
§2) — you should never need to hand-edit `appetite_update_requests.status` or insert into
`appetite_overrides` directly. `product_feedback.status` is a plain admin-only `UPDATE`, no RPC
needed. Use the Admin Dashboard for both so nothing gets out of sync.

## 9. Broker accounts & cross-device sync

Once migration 0003 is applied (§2) and the two env vars are set (§4), `/signup` and `/login`
become live. **There is no invite step or approval needed** — anyone who signs up is a broker with
their own private workspace; this is the intended self-service flow (unlike admin accounts, §5).

- **Email confirmation**: by default, a new Supabase project requires clicking a confirmation email
  before the account can sign in — `/signup` already handles this (it shows "check your email"
  rather than silently doing nothing). If you'd rather brokers get in immediately, turn it off in
  **Authentication → Providers → Email → Confirm email**; either setting works with this app as-is.
- **"Forgot password?" on `/login`** and the sign-up confirmation email: covered by §6 (Site URL +
  Redirect URLs).
- **What syncs**: business/transportation fields (with full provenance and conflict history),
  vehicles, drivers, loss history, coverage, document metadata + the original uploaded file, and
  activity history — everything the local-only experience already tracked. A submission created
  (or explicitly imported) while signed in is mirrored to Supabase after every edit; the account
  menu / top bar shows Saving…/Saved/"Failed to save" so a broker always knows whether a change
  actually reached their account, never just this browser.
- **Local-only submissions and signing in for the first time**: a broker's existing local
  submissions are never uploaded automatically. Signing in shows a "Local submissions found" prompt
  on the Dashboard with an explicit **Import to account** / **Not now** choice per batch of local
  submissions — nothing leaves the browser until that button is clicked. One caveat worth knowing:
  the original bytes of a document processed *before* this feature existed (or before the broker
  signed in) were never retained locally in the first place — only its extracted fields and, for an
  image, a small preview — so importing such a submission brings over everything **except** the
  original file for documents uploaded before cloud sync was active. A document uploaded while
  signed in always brings its original file along.
- **Test-account note**: don't use production customer emails for testing this flow — create
  disposable test accounts (any working inbox, or a plus-addressed alias like
  `you+test1@example.com`) the same way you'd test any other signup form.

## 10. Verifying migration 0003 after you apply it (recommended smoke test)

This migration's logic was verified in this repository against a local Postgres instance standing
in for Supabase (§2's note) — but that isn't the same as your live project, which is the one that
actually matters. A five-minute check after applying it:

1. Sign up two throwaway test accounts at `/signup` (e.g. `test-a@yourdomain.com` and
   `test-b@yourdomain.com`) — two different browser profiles or one normal + one incognito window
   works well for this.
2. As test-a: create a submission, upload a document, edit a field, add a driver.
3. As test-b (a **separate** signed-in session): go to the Dashboard — you should see **no**
   submissions from test-a. Create a submission of your own.
4. Back as test-a: refresh — your submission and edits are still there; test-b's submission never
   appears anywhere in your account.
5. In the Supabase dashboard's **Table Editor**, open `submissions` — you should see one row per
   account owned by the correct `user_id`, and the RLS padlock icon should read "Enabled" on every
   table this migration created.
6. Delete test-a's submission from the app — confirm its rows disappear from `field_values`,
   `vehicles`, `drivers`, `losses`, `coverage_lines`, `documents`, and `activity_events` in the
   Table Editor, and that its uploaded file is gone from **Storage → submission-documents**.

If step 3 ever shows test-b able to see test-a's data, stop and re-check that RLS is enabled on
every table (`alter table ... enable row level security` — all nine tables in 0003) before doing
anything else with real broker data.

## 11. Vision-based image extraction (optional — not required for the app to work)

By default, an uploaded photo/screenshot (JPG/PNG/WEBP) is read with on-device OCR (Tesseract.js,
runs entirely in the browser, no setup needed) and the OCR'd text is pattern-matched the same way a
PDF/DOCX's text is. This works well for a clean, well-lit photo but struggles with skew, glare, and
the abbreviated card-style labels a driver's license or registration uses.

Turning on vision-based extraction sends the image itself to a Claude vision model, which reads the
layout directly instead of relying on OCR text + regex — meaningfully more robust across the
phone-photo-quality images a real submission pipeline (Telegram, SMS, email forwards) actually
receives. OCR keeps running alongside it as a fallback/second opinion (see `reconcileImageExtraction`
in the app code) — nothing is removed by turning this on, and nothing breaks if you don't.

**This step requires an Anthropic API key and is not automatically enabled.** Skip this section
entirely if you don't want to turn it on yet — the app is fully functional without it.

1. **Get an Anthropic API key.** Create one at [console.anthropic.com](https://console.anthropic.com)
   (Settings → API Keys). This is a paid, metered API — you are billed per image processed. There is
   no free tier baked into this app; review Anthropic's current pricing before enabling this for a
   real broker workload.
2. **Install the Supabase CLI** if you haven't already (`npm install -g supabase`, or see
   [supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli)), then link it to your
   project: `supabase link --project-ref <your-project-ref>` (the project ref is in your project's
   Settings → General).
3. **Deploy the Edge Function** (already in this repo at `supabase/functions/extract-document-vision`):
   ```
   supabase functions deploy extract-document-vision
   ```
   Do **not** pass `--no-verify-jwt` — the function relies on Supabase's default JWT verification so
   only a signed-in broker's browser can call it (never an anonymous visitor, and never something
   that runs up your Anthropic bill for free).
4. **Set the API key as a function secret** (never as a `VITE_` variable — those are bundled into the
   browser JS and would leak the key to every visitor):
   ```
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```
5. **(Optional) Choose the model.** Defaults to `claude-sonnet-5` if unset. To use a different model
   (e.g. a cheaper one for cost, or a stronger one for accuracy) without redeploying code:
   ```
   supabase secrets set ANTHROPIC_VISION_MODEL=claude-haiku-4-5-20251001
   ```
6. **That's it — no frontend rebuild or `VITE_` variable needed.** The next image a signed-in broker
   uploads will attempt vision extraction automatically; local-only (not signed in) sessions and any
   Supabase project without this function deployed keep using OCR exactly as before.

**Smoke test after deploying:** sign in, upload a clear photo of a driver's license or vehicle
registration to a submission, and open the Documents tab. If vision is working, the field count and
the field-level "Source" column should reflect an AI-vision read (`extractionMethod:
'vision_extraction'`, visible via each field's source label in the Risk Profile). If it's still
using OCR only, check the function's logs (`supabase functions logs extract-document-vision`) for a
missing-secret or provider-error message — the app degrades silently to OCR on any failure, so this
is the way to actually confirm which path ran.

## What is and isn't covered

- **Covered**: broker submission (anonymous, insert-only) → `appetite_update_requests`; general
  product feedback (anonymous, insert-only, a separate concept — see §7-8) →
  `product_feedback`; an Admin Dashboard at `/admin` (counts + recent activity for both) and full
  filterable queues at `/admin/appetite-updates` and `/admin/feedback` (see §7); admin sign-in via
  Supabase Auth, gated by the `admin_users` allowlist and enforced by RLS (not just hiding the
  route) — appetite-update reviews go through `review_appetite_update_request()`, feedback status
  updates through a plain admin-gated `UPDATE`; approve/reject/needs-info →
  `appetite_update_history` (durable, admin-only, nothing ever deleted) + on approval only,
  `appetite_overrides` (the live-appetite override the public app actually reads at runtime,
  publicly readable but writable by admins only) — all three writes happen in one transaction;
  sign-out and "forgot password" (see §6 above for the one-time redirect-URL setup it needs).
  **Broker cloud workspaces** (migration 0003, see §9-10): self-service sign-up/sign-in at
  `/signup`/`/login`, fully separate from admin auth; a normalized per-broker schema (submissions,
  field values + conflict/provenance history, vehicles, drivers, losses, coverage, documents,
  activity) with owner-only RLS on every table, verified with two synthetic users directly against
  Postgres; a private `submission-documents` Storage bucket with per-owner-folder access policies;
  a "Local submissions found" import prompt that never uploads anything without an explicit broker
  action; and a Saving…/Saved/Failed-to-save indicator so a sync failure is never silently hidden.
  **Vision-based image extraction** (see §11): an Edge Function that sends an uploaded photo to a
  Claude vision model for layout-aware structured extraction, reconciled against the existing
  on-device OCR read (agreement boosts confidence, disagreement is recorded as a visible conflict,
  never silently resolved) — opt-in, requires an Anthropic API key you provide, and the app is
  fully functional without it (OCR-only, exactly as before).
  **Submission Intake** (migrations 0004/0005): a broker creates a shareable, unauthenticated link
  at `/intake-links`; an agency, safety company, or client opens `/intake/:token`, answers basic
  questions, and uploads documents/photos with no Renewal IQ login. The submission lands in a
  staging table only the broker can read; clicking "Import" creates a real account (the applicant's
  typed answers become `extractionMethod: 'applicant_provided'` fields, tagged "Applicant Provided"
  distinctly from "AI Extracted"/"Broker Confirmed"/"Broker Edited"/"Needs Review"/"Conflict" — see
  utils/dataStatus.ts) and runs the exact same OCR/vision extraction pipeline on the uploaded
  documents as any other upload, so a document that disagrees with what the applicant typed shows
  up as a normal, visible conflict rather than a silent overwrite.
- **Not covered**: email notifications beyond Supabase Auth's own (confirmation, password reset);
  the market/MGA workbook import (a separate, later pass); AI-driven account analytics (the next
  phase after this one); multi-user/agency organizations (the schema reserves `organization_id` for
  this — see the migration's comments — but nothing enforces or uses it yet); offline editing while
  disconnected (a network failure surfaces as "Failed to save," it doesn't queue for later); a
  live, end-to-end browser test of sign-up/sign-in/cross-device sync against a real Supabase
  project, which requires credentials this development environment doesn't have — §10 above is the
  smoke test to run once you have those; and a live call to the vision Edge Function against a real
  Anthropic API key, for the same reason — §11 is the smoke test to run once you've deployed it.
