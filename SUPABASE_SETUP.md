# Supabase Setup — Appetite Update Workflow

The "Request Appetite Update" broker form and the `/admin/appetite-updates` review page need a
Supabase project. Nothing else in Renewal IQ depends on Supabase — every other feature still works
entirely offline with zero configuration.

## 1. Create the project

If you don't already have one: [supabase.com](https://supabase.com) → New Project. Free tier is
sufficient for this workload.

## 2. Run the migration

`supabase/migrations/0001_appetite_update_workflow.sql` creates three tables (`appetite_update_requests`,
`appetite_update_history`, `appetite_overrides`) with row-level security enabled. Run it via the
Supabase SQL editor (paste the file's contents and run), or via the Supabase CLI:

```
supabase db push
```

**Read the security comment at the top of that file before running it.** This app has no
authentication yet, so the RLS policies are intentionally permissive (the `anon` role — i.e.
anyone holding the public key below — can read and write these tables). That's a known, documented
limitation, not an oversight; see the report for what it does and doesn't expose.

## 3. Get your API credentials

Project Settings → API in the Supabase dashboard:

- **Project URL** → `VITE_SUPABASE_URL`
- **`anon` `public` key** → `VITE_SUPABASE_ANON_KEY`

**Do not use the `service_role` key anywhere in this project.** It bypasses row-level security
entirely, and anything prefixed `VITE_` is bundled into the browser JavaScript and downloadable by
anyone who visits the site — putting the service-role key there would be equivalent to publishing
full database admin access. This codebase only ever reads the anon key
(`src/services/supabase/client.ts`).

## 4. Configure the app

```
cp .env.example .env.local
```

Fill in the two values. `.env.local` is git-ignored — never commit it. If deploying (e.g. Vercel),
set the same two variables in the platform's environment-variable settings instead of a file.

If these variables are absent, the app runs normally in every other respect: the appetite-update
form clearly reports that submission isn't available rather than silently failing or lying about
success, and `/admin/appetite-updates` shows a "Supabase not configured" state instead of an empty
or broken queue.

## What is and isn't covered

- **Covered**: broker submission → `appetite_update_requests`; admin approve/reject/needs-info →
  `appetite_update_history` (durable, nothing deleted) + on approval, `appetite_overrides` (the
  live-appetite override the app actually reads at runtime).
- **Not covered**: authentication for the admin page (see the report — the route is intentionally
  unlinked, not secured), email notifications (design leaves room to add a server-side function
  later; no email is sent today), and the market/MGA workbook import (a separate, later pass).
