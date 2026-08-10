# FRIEDD SNAKE — Stock Evaluator

Phase 1: scaffold, auth, and the monthly access-code gate. Built for ~150
Invest With Bjorn students. This README is written for the owner, not a
developer — follow it top to bottom the first time you set this up.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), create a new project.
2. In the dashboard, go to **Project Settings -> API**. You'll need three
   values from that page.

## 2. Fill in your keys

1. Copy `.env.local.example` to `.env.local` if you haven't already (a
   `.env.local` with placeholder values already exists so the app can run
   before you've done this).
2. Paste in the real values:
   - `NEXT_PUBLIC_SUPABASE_URL` — "Project URL" on the API settings page.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the `anon` `public` key.
   - `SUPABASE_SERVICE_ROLE_KEY` — the `service_role` key. **Keep this
     secret** — it bypasses all database security rules. Never put it in
     anything that ships to the browser.
   - `FINNHUB_API_KEY` — not used yet in Phase 1, leave the placeholder.
3. `.env.local` is gitignored and never committed.

## 3. Run the database migration

1. In the Supabase dashboard, open **SQL Editor**.
2. Open `supabase/migrations/0001_init.sql` in this project, copy the whole
   file, paste it into the SQL Editor, and run it.
3. This creates the `profiles`, `access_codes`, and `user_access` tables,
   the security rules on them, and seeds a dev-only access code
   (`WELCOME2026`) for the current month.

## 4. Turn off email confirmation

Supabase's free-tier email sending is rate-limited to about 2 emails/hour,
which will break signups for a class of 150. This project has no
email-confirmation flow — students can log in immediately after signing up.

In the dashboard: **Authentication -> Sign In / Providers -> Email**, turn
**off** "Confirm email".

## 5. Make yourself an admin

After you've signed up once through the app (`/signup`), run this in the
SQL Editor, swapping in your own email:

```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```

## 6. Set the monthly access code

Students enter this code once per calendar month (Asia/Singapore time) to
keep using the app. There are two ways to set or rotate it — pick whichever
is easier for you each month.

**Option A — the Node script (recommended):**

Run `npm install` once first (step 7) so the script has what it needs.

```bash
node scripts/set-access-code.mjs YOUR-NEW-CODE
```

This reads your Supabase keys from `.env.local`, hashes the code, and
upserts it for the current month. To set a specific month:

```bash
node scripts/set-access-code.mjs YOUR-NEW-CODE 2026-09
```

**Option B — the SQL Editor:**

Open `supabase/set-access-code.sql`, edit the month and code, paste into
the SQL Editor, and run it.

The dev seed code from the migration (`WELCOME2026`) only exists for local
testing — rotate it with one of the options above before real students get
access.

Two things to know: the code is **case-sensitive**, so send students the
exact characters; and a new month means a new lock — set the next month's
code before the 1st (Singapore time) or everyone is locked out until you do.

## 7. Run it locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). New students go
`/signup` -> `/access-code` -> `/dashboard`.

## What's in Phase 1

- Email + password signup/login/logout (`/signup`, `/login`).
- Monthly access-code gate (`/access-code`) — once unlocked for a
  calendar month, a student stays unlocked until the month changes.
- `/dashboard` — placeholder, real evaluation tools come in Phase 2.
- `/admin` — placeholder, gated on `profiles.is_admin`; 404s for
  everyone else.

## Notes for future development

- Deployment target is Cloudflare Pages (not set up yet in Phase 1).
- Route protection is layered: `src/proxy.ts` (Next.js 16's rename of
  `middleware.ts`) does a coarse "are you logged in" check on every
  request, and `src/app/(authed)/(gated)/layout.tsx` does the real
  monthly-access check. Don't rely on proxy alone for authorization —
  Next.js's own guidance is that a matcher change can silently stop
  covering a route.
