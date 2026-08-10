# CLAUDE.md — BPC Stock Evaluator

Project brief for Claude sessions working in this repo. No secrets here — variable
names only. Real values live in `.env.local` (gitignored) or the owner's Supabase /
Finnhub dashboards.

## What this app is

A stock-evaluation web tool for ~150 Invest With Bjorn / BPC students. Core loop:
student signs up, unlocks the month with an access code, picks a ticker, and scores
it against the **FRIEDD SNAKE** framework (F.R.I.E.D.D financial health, Others,
SNAKE Risks, Moats — see `docs/framework-spec.md`). Phase 3 (in progress) adds a
valuation module on top of a completed evaluation (see `docs/phase3-valuation-spec.md`).

The scoring framework itself is not hardcoded in components — it's versioned data in
the `framework_versions` table, and the evaluation form renders from that JSON
definition. This lets the framework be edited without a code deploy (see Phase 5).

Deployed at https://friedd-snake.vercel.app, auto-deployed from `main` on GitHub via
Vercel. No manual deploy step.

## Working conventions

- **Claude acts as ORCHESTRATOR ONLY.** Plan, write a brief, and delegate the actual
  build to a subagent. Then delegate review to an independent QA subagent before
  calling anything done. Never build directly in the main thread.
- **Scope changes with the owner before editing.** Lay out the exact change list and
  wait for an explicit go-ahead. One step/phase at a time — never a big batch of
  workstreams at once.
- **Checkpoint with the owner after each phase.** Don't roll straight into the next
  phase without the owner reviewing and approving the current one live.

## Phase status

- **Phase 1 — Auth + monthly access-code gate: DONE, live, owner-approved.**
- **Phase 2 — FRIEDD SNAKE scoring + dashboard: DONE, live, owner-approved.**
- **Phase 3 — Valuation (next up).** Spec: `docs/phase3-valuation-spec.md`. Locked
  decisions from the owner:
  - **No overall verdict.** Show per-model signals only, not a single blended
    pass/fail or buy/sell call.
  - **PEG is informational only** — displayed, never gates or scores anything.
  - **Dashboard valuation column** = a sortable margin-of-safety percentage (replaces
    the current `—` placeholder).
- **Phase 4** — Portfolio plan.
- **Phase 5** — Admin panel: framework editor (for `framework_versions`) + access-code
  rotation UI (replacing the current CLI/SQL-only flow).
- **Phase 6** — Polish + launch. **Critical launch blocker:** rotate the access code
  off the dev seed `WELCOME2026` before students get the link (see
  `scripts/set-access-code.mjs` in README).

## Technical facts worth knowing before touching anything

- **Scoring correctness is pinned to the spec's worked example.** Scoring logic
  lives in `src/lib/scoring.ts` (shared by client-side live preview and server-side
  autosave). It must keep reproducing the GOOGL example in
  `docs/framework-spec.md` exactly: raw score 16, final 8.0/10, PASS.
  `scripts/verify-scoring.mjs` (`npm run verify-scoring`) is the golden test — run it
  after any change to scoring math.
- **Migrations:** `supabase/migrations/*.sql`, applied via
  `node scripts/db-migrate.mjs` (direct Postgres connection, session pooler; tracked
  in a `_migrations` table so it's safe to re-run). `--status` shows
  applied/pending without changing anything.
- **Supabase project ref:** `opivuugndhoeebfozglh`.
- **Direct DB connection** (used by `db-migrate.mjs` and any ad-hoc scripts): session
  pooler host `aws-0-ap-northeast-2.pooler.supabase.com:5432`, user
  `postgres.opivuugndhoeebfozglh`. That's a Seoul pooler even though the Supabase
  project itself is Singapore-region — this is correct, not a misconfiguration, don't
  "fix" it.
- **CRITICAL — new tables get NO API-role grants by default.** Every migration that
  creates or alters a table needs explicit `grant` statements for the API roles plus
  a trailing `notify pgrst, 'reload schema';`, or the table will be invisible to
  PostgREST/the app even though it exists in Postgres.
- **Framework JSON edits must use the guarded-update pattern.** See
  `supabase/migrations/0004_fix_income_statement_links.sql` and
  `0005_display_groups.sql` — use `jsonb_set` on `framework_versions.definition`
  with a `where` clause that checks the positional path really is the field you
  think it is (e.g. `definition #>> '{sections,0,criteria,3,key}' = 'eps_trend'`)
  before writing. This makes a reordered/changed definition JSON a no-op instead of
  silent corruption. Never hand-edit the JSON blob without this guard.
- **Finnhub** (`src/lib/ticker.ts`): free tier, ticker price/name auto-fill, used
  server-side only (key never reaches the browser), 24h cache in `ticker_cache`.
  Phase 3's pedagogy rule: no other fundamentals get auto-fetched — students source
  and key in every valuation input themselves; the app only does derived math.
- **Route protection is layered**, don't rely on one layer alone: `src/proxy.ts`
  (Next.js 16's rename of `middleware.ts`) does a coarse logged-in check on every
  request; `src/app/(authed)/(gated)/layout.tsx` does the real monthly-access check
  and the admin bypass.

## Environment

`.env.local` (gitignored, never committed) is required. Variable names only —
real values come from the owner or the Supabase / Finnhub dashboards:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses all database security rules, server-only,
  never ships to the browser.
- `FINNHUB_API_KEY` — server-only.
- `SUPABASE_DB_PASSWORD` — needed only for `scripts/db-migrate.mjs` and
  `scripts/set-access-code.mjs` (direct Postgres connection).

`.env.local.example` in the repo root lists the same names as a template.

## Where things live

- `docs/framework-spec.md` — full FRIEDD SNAKE scoring spec, extracted from the
  owner's source spreadsheet. Canonical reference for what every criterion means.
- `docs/phase3-valuation-spec.md` — buildable spec for the Phase 3 valuation module.
- `docs/SETUP.md` — new-machine setup instructions for the owner (non-developer).
- `README.md` — human-facing setup + operations doc (Supabase setup, running
  migrations, setting the monthly access code, running locally).
- `scripts/` — `db-migrate.mjs`, `set-access-code.mjs`, `verify-scoring.mjs`.
