# Supabase Setup — Appetite Update Workflow, Product Feedback & Broker Cloud Workspaces

The "Request Appetite Update" broker form, the "Feedback" button (general product feedback about
Renewal IQ itself — a deliberately separate concept from an appetite-update request, see §8), the
Admin Dashboard (`/admin`, `/admin/appetite-updates`, `/admin/feedback`), and — as of migration
0003 — **broker sign-up/sign-in and cross-device submission sync** (`/login`, `/signup`) all need a
Supabase project. Nothing else in Renewal IQ depends on Supabase: with no project configured, every
broker feature still works fully, entirely offline, in this browser only — sign-in just isn't
available, and the account/profile menu shows "Local only" instead.

## 1. Create the project

If you don't already have one: [supabase.com](https://supabase.com) → New Project. Free tier is
sufficient for this workload.

## 2. Run the migrations

Three migration files, run in order — all are required, and **none has been applied to any live
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

**Read the security model comment at the top of each file.** In short: an anonymous broker can
only insert a new appetite-update request or feedback entry, and read approved appetite overrides
— nothing else, on any table. Only a signed-in user listed in `admin_users` can read either queue.
Reviewing an appetite-update request happens exclusively through `review_appetite_update_request()`,
which re-checks admin status itself server-side; updating a feedback entry's status is a plain
RLS-gated `UPDATE`, gated the same way (`is_admin()`) but without a dedicated function, since it
doesn't need the multi-table atomic transaction the appetite-update review does.

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

## 6. Enable "Forgot password?" (optional, one-time dashboard step)

The admin sign-in page has a "Forgot password?" link. Sending the reset email works with zero
extra setup, but **completing** the reset (clicking the emailed link and landing back on a "set a
new password" form) requires the redirect URL to be allow-listed, or Supabase will reject it:

1. Supabase dashboard → **Authentication → URL Configuration**.
2. Under **Redirect URLs**, add every URL admins might sign in from, each ending in `/admin` — e.g.
   `https://your-production-domain.com/admin` and, for local development, `http://localhost:5173/admin`.
   (If you'd previously allow-listed a URL ending in `/admin/appetite-updates` from an earlier
   version of this app, update it to `/admin` — the Admin Dashboard at `/admin` is now the
   canonical sign-in/reset landing page.)

If this step is skipped, the "send reset email" step still works and shows its normal
confirmation (never revealing whether the address has an account), but the link in that email
will fail with a redirect error instead of opening the "set a new password" form. This is a
dashboard setting only — no code change is needed once it's configured, and there is no workaround
in the app that bypasses it (nor should there be).

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
- **"Forgot password?" on `/login`**: same one-time step as §6, except the redirect URL ends in
  `/login` instead of `/admin` — add both `https://your-production-domain.com/login` and
  `http://localhost:5173/login` under **Authentication → URL Configuration → Redirect URLs**.
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
- **Not covered**: email notifications beyond Supabase Auth's own (confirmation, password reset);
  the market/MGA workbook import (a separate, later pass); AI-driven account analytics (the next
  phase after this one); multi-user/agency organizations (the schema reserves `organization_id` for
  this — see the migration's comments — but nothing enforces or uses it yet); offline editing while
  disconnected (a network failure surfaces as "Failed to save," it doesn't queue for later); and a
  live, end-to-end browser test of sign-up/sign-in/cross-device sync against a real Supabase
  project, which requires credentials this development environment doesn't have — §10 above is the
  smoke test to run once you have those.
