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

## What is and isn't covered

- **Covered**: broker submission (anonymous, insert-only) → `appetite_update_requests`; admin
  sign-in via Supabase Auth, gated by the `admin_users` allowlist and enforced by RLS +
  `review_appetite_update_request()` (not just hiding the route); approve/reject/needs-info →
  `appetite_update_history` (durable, admin-only, nothing ever deleted) + on approval only,
  `appetite_overrides` (the live-appetite override the public app actually reads at runtime,
  publicly readable but writable by admins only) — all three writes happen in one transaction.
- **Not covered**: email notifications (design leaves room to add a server-side function later; no
  email is sent today) and the market/MGA workbook import (a separate, later pass).
