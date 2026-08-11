# Equity Compass — FRIEDD SNAKE Evaluator

Phase 1: scaffold, auth, and the monthly access-code gate. Phase 2: the
FRIEDD SNAKE evaluation tool itself (the app's name is Equity Compass,
subtitled "FRIEDD SNAKE Evaluator"; FRIEDD SNAKE is the name of the scoring
framework it implements). Phase 3: the valuation module, built, verified, and
live as of 2026-08-11 (owner feedback pending — see `CLAUDE.md` Phase status).
Built for ~150 Invest With Bjorn students. This README is written for the
owner, not a developer — follow it top to bottom the first time you set this
up.

Setting up on a brand-new computer? Use `docs/SETUP.md` for the short version.
This README covers the full picture, including Supabase setup and monthly
operations. `docs/framework-spec.md` is the full FRIEDD SNAKE scoring spec;
`docs/phase3-valuation-spec.md` is the build spec for the valuation module.
`CLAUDE.md` is the brief for Claude Code sessions working on this repo.

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
   - `FINNHUB_API_KEY` — used in Phase 2 for ticker price/name auto-fill.
     Get a free key at [finnhub.io](https://finnhub.io/register). Server-only
     — never exposed to the browser.
3. `.env.local` is gitignored and never committed.

## 3. Run the database migrations

**Option A — the migration runner (recommended):** add
`SUPABASE_DB_PASSWORD` (Project Settings -> Database -> Connection string)
to `.env.local`, run `npm install`, then:

```bash
node scripts/db-migrate.mjs
```

This connects directly to the database (via the session pooler) and applies
every file in `supabase/migrations/` that hasn't already run yet, tracked in
a `_migrations` table. Use `node scripts/db-migrate.mjs --status` to see
what's applied/pending without changing anything.

**Option B — the SQL Editor:** open each file in `supabase/migrations/` in
order (`0001_init.sql`, `0002_security.sql`, `0003_phase2_core.sql`), paste
into the Supabase SQL Editor, and run it. If you use this option, the
migrations won't be tracked in `_migrations` — keep a manual note of what
you've run.

This creates the `profiles`, `access_codes`, `user_access`,
`access_code_attempts`, `framework_versions`, `evaluations`, and
`ticker_cache` tables, the security rules on them, seeds a dev-only access
code (`WELCOME2026`) for the current month, and seeds framework version 1
(the full FRIEDD SNAKE scoring definition that drives the evaluation form).

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

Two things to know: the code is **case-insensitive** (it's normalized to
uppercase and trimmed before hashing and before checking, so `welcome2026`,
`WELCOME2026`, and `  Welcome2026  ` all work identically); and a new month
means a new lock — set the next month's code before the 1st (Singapore time)
or everyone is locked out until you do.

**Brute-force lockout:** 5 consecutive wrong attempts locks a student out of
further access-code attempts for 1 hour (tracked in
`access_code_attempts`). The counter resets automatically on a correct
attempt, and the lock clears itself after an hour — no admin action needed.

**Admins skip the code entirely.** Any user with `profiles.is_admin = true`
never sees the access-code screen — the monthly gate is bypassed for them.

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
  5 consecutive wrong attempts locks a student out for 1 hour. Admins
  (`profiles.is_admin = true`) bypass this gate entirely.
- `/admin` — placeholder, gated on `profiles.is_admin`; 404s for
  everyone else.

## What's in Phase 2

- `/dashboard` — greeting, ticker quick-input, Equity Scope link, stat
  cards (companies evaluated / passed / drafts), and a table of the
  student's evaluations (click a row to open it, delete with confirm).
- `/evaluation/[ticker]` — the FRIEDD SNAKE scoring form. Rendered
  entirely from the `framework_versions` definition in the database (no
  criteria hardcoded in components): F.R.I.E.D.D → Others → SNAKE Risks →
  Moats, each with its own definition/help text, source link, and the
  scale (0/1/2) or flag (present/absent) input the spec calls for. A
  sticky score panel shows the live running score and PASS/FAIL verdict
  (desktop sidebar / mobile collapsible bar). Inputs autosave a few
  hundred milliseconds after you stop typing.
- Ticker price + company name auto-fill via Finnhub (`src/lib/ticker.ts`),
  cached in `ticker_cache` for 24h. Server-only — the Finnhub key never
  reaches the browser.
- The scoring math (F.R.I.E.D.D / Others / Risks / Moats rollup, 0-20 raw
  score, rescale to /10, PASS at ≥7.0) lives in one shared module,
  `src/lib/scoring.ts`, used by both the live client-side preview and the
  server-side autosave. `npm run verify-scoring` reproduces the spec's
  worked GOOGL example (raw 16, final 8.0, PASS) through that module.
- **Not in Phase 2:** Step 2 Valuations (the three entry-price models, PEG
  verdict, and full DCF). The dashboard's "Valuation" column is a
  placeholder (`—`) until that's built.

## What's in Phase 3

- `/evaluation/[ticker]/valuation` — the valuation module, reached from a
  "Valuation →" button on the scoring page (always visible, not gated on
  PASS/complete — a FAIL company can still be valued for reference).
  Requires the evaluation row to already exist; doesn't create one.
- **No overall/blended verdict anywhere.** Every model — PB, Dividend
  Yield, PE, P/OCF, DCF — shows its own independent Undervalued/Fair
  Value/Overvalued signal. Nothing votes across them or averages them. PEG
  is informational only (shown small and separate, never a peer of the
  five real models).
- **CAGR helper** (first-year FCF, last-year FCF, years → CAGR%) sits
  directly above the DCF growth-rate inputs — purely to seed judgment, not
  wired into any downstream formula.
- **DCF** — CAPM discount rate, 10-year two-phase FCF projection + Gordon
  Growth terminal value, net-debt adjustment, margin of safety vs. share
  price. A base FCF ≤ 0 disables the panel (inputs stay visible but
  greyed, FCF itself keeps autosaving) with an explanatory banner, and it
  live re-enables the moment FCF is edited back above 0 — no reload. DCF's
  own signal comes from margin-of-safety bands (±15% by default, tunable
  via `framework_versions.definition.valuation_config`).
- **P/OCF model** (new alongside PB/Dividend/PE) — current P/OCF vs. a
  student-entered 5-year average, same three-way signal shape as PEG.
- All valuation inputs autosave the same way scoring inputs do (~800ms
  after you stop typing). Only share price/company name are auto-fetched
  (unchanged from Phase 2) — every other number is student-sourced, with
  the same stockanalysis.com nav-path hints as the sheet, plus MarketWatch
  (10Y Treasury) and market-risk-premia.com for the two CAPM inputs
  stockanalysis.com doesn't publish.
- The valuation math (CAGR, all four entry-price models + PEG, the full
  DCF chain) lives in one shared module, `src/lib/valuation.ts`, used by
  both the live client-side recalc and the server-side autosave.
  `npm run verify-valuation` reproduces the framework spec's worked GOOGL
  DCF example (discount rate 6.5573%, intrinsic value/share $258.34,
  margin of safety -27.08%, Overvalued), a synthetic negative-FCF case,
  and the CAGR helper's own worked example.
- **Dashboard "Valuation" column** is now live: the DCF margin-of-safety
  percentage, colored (green positive / red negative), sortable by
  clicking the column header (rows with no DCF — unavailable or valuation
  never started — always sort to the bottom). Replaces the Phase 2
  placeholder `—`.

## Notes for future development

- Deployment target is Cloudflare Pages (not set up yet).
- Route protection is layered: `src/proxy.ts` (Next.js 16's rename of
  `middleware.ts`) does a coarse "are you logged in" check on every
  request, and `src/app/(authed)/(gated)/layout.tsx` does the real
  monthly-access check (and the admin bypass). Don't rely on proxy alone
  for authorization — Next.js's own guidance is that a matcher change can
  silently stop covering a route.
- `scripts/db-migrate.mjs` connects directly to Postgres (session pooler)
  to apply migrations — see step 3 above. It tracks what's applied in a
  `_migrations` table so it's safe to re-run.
