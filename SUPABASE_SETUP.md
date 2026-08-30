# Supabase Setup — Appetite Update Workflow

The "Request Appetite Update" broker form and the `/admin/appetite-updates` review page need a
Supabase project. Nothing else in Renewal IQ depends on Supabase — every other feature still works
entirely offline with zero configuration.

## 1. Create the project

If you don't already have one: [supabase.com](https://supabase.com) → New Project. Free tier is
sufficient for this workload.

## 2. Run the migration

`supabase/migrations/0001_appetite_update_workflow.sql` creates the tables, row-level security
policies, an `is_admin()` helper, and the `review_appetite_update_request()` function the admin
page uses to approve/reject/mark-needs-more-information. Run it via the Supabase SQL editor (paste
the file's contents and run), or via the Supabase CLI:

```
supabase db push
```

**Read the security model comment at the top of that file.** In short: an anonymous broker can
only insert a new request and read approved overrides — nothing else, on any table. Only a signed-in
user listed in `admin_users` can read the request queue or review anything, and only through
`review_appetite_update_request()`, which re-checks admin status itself server-side.

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

## 7. Managing broker appetite-update requests

Once you're an admin (§5), go to **`/admin`** on the running app (e.g. `https://your-production-domain.com/admin`
in production, or `http://localhost:5173/admin` locally). This is the Admin Dashboard: sign in there
with the same admin email/password, and you'll see request counts by status and the most recent
submissions. **"View all requests"** goes to `/admin/appetite-updates`, which is the full queue with
filters (Pending, Needs More Info, Approved, Rejected, All — Pending is the default) and the
Approve / Reject / Needs More Information actions.

There's a small "Admin" link at the bottom of the broker product's sidebar that goes to `/admin` —
deliberately understated (this is an internal tool for you, not a feature brokers are meant to
notice), but it's there if you'd rather click than type the URL. Both `/admin` and
`/admin/appetite-updates` require the same admin sign-in described in §5; there is no separate
broker-facing login anywhere in the app.

## 8. Where your data actually lives in Supabase

If you ever need to inspect or fix something by hand, go to the Supabase dashboard's **Table
Editor** (or the SQL Editor) for these three tables — this is the same data the Admin Dashboard
reads and writes, just the raw rows:

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

All three are written together in one transaction by `review_appetite_update_request()` (see §2) —
you should never need to hand-edit `appetite_update_requests.status` or insert into
`appetite_overrides` directly; use the Admin Dashboard so the audit trail stays accurate.

## What is and isn't covered

- **Covered**: broker submission (anonymous, insert-only) → `appetite_update_requests`; an Admin
  Dashboard at `/admin` (counts + recent requests) and a full filterable queue at
  `/admin/appetite-updates` (see §7); admin sign-in via Supabase Auth, gated by the `admin_users`
  allowlist and enforced by RLS + `review_appetite_update_request()` (not just hiding the route);
  approve/reject/needs-info → `appetite_update_history` (durable, admin-only, nothing ever deleted)
  + on approval only, `appetite_overrides` (the live-appetite override the public app actually
  reads at runtime, publicly readable but writable by admins only) — all three writes happen in one
  transaction; sign-out and "forgot password" (see §6 above for the one-time redirect-URL setup it
  needs).
- **Not covered**: email notifications (design leaves room to add a server-side function later; no
  email is sent today) and the market/MGA workbook import (a separate, later pass).
