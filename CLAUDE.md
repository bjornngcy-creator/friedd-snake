# CLAUDE.md — Equity Compass (FRIEDD SNAKE Evaluator)

Project brief for Claude sessions working in this repo. No secrets here — variable
names only. Real values live in `.env.local` (gitignored) or the owner's Supabase /
Finnhub dashboards.

## What this app is

A stock-evaluation web tool for ~150 Invest With Bjorn / BPC students. Core loop:
student signs up, unlocks the month with an access code, picks a ticker, and scores
it against the **FRIEDD SNAKE** framework (F.R.I.E.D.D financial health, Others,
SNAKE Risks, Moats — see `docs/framework-spec.md`). Phase 3 adds a valuation
module on top of a completed evaluation (see `docs/phase3-valuation-spec.md`);
it's built and live, pending owner feedback (see Phase status).

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
- **Phase 3 — Valuation: BUILT, VERIFIED, LIVE as of 2026-08-11.** Spec:
  `docs/phase3-valuation-spec.md`. Migrations `0006_valuation_columns.sql` and
  `0007_valuation_config.sql` applied to remote. Acceptance tests exact — GOOGL
  intrinsic value/share $258.34, margin of safety -27.08% — reproduced by
  `scripts/verify-valuation.mjs` (`npm run verify-valuation`), the Phase 3 golden
  test alongside `scripts/verify-scoring.mjs`. Locked decisions from the owner:
  - **No overall verdict.** Show per-model signals only, not a single blended
    pass/fail or buy/sell call.
  - **PEG is informational only** — displayed, never gates or scores anything.
  - **Dashboard valuation column** = a sortable margin-of-safety percentage (replaces
    the old `—` placeholder).

  **QA sweep: COMPLETE.** Adversarial QA sweep of Phase 3 (edge inputs, Gordon
  Growth guard, mobile, RLS). Fixes landed in commit `843a2b8` ("Phase 3 QA
  fixes: NaN/Infinity guards, empty-vs-negative FCF copy, source links").
  Verdict: production-safe.

  **Phase 3 flagged items (owner decisions pending):**
  1. OCF-per-share isn't published on stockanalysis.com — students will get
     stuck entering it. Recommended fix: help text teaching the derivation
     (share price ÷ current P/OCF).
  2. Dashboard `valuation_summary.margin_of_safety` goes stale when
     `share_price` refreshes — needs a recompute hook.
  3. Valuation is reachable from a zero-answer draft; the spec said it should
     only be visible once a score exists.
  4. Spec §2.1 soft range warnings (BVPS ≤ 0, negative PE, years 1-20,
     growth-decay hint) are unimplemented.
  5. The MarketWatch 10Y Treasury link is unverifiable by agents (bot-walled)
     — owner must eyeball it once.
  6. **LATENT, for Phase 5:** pages render the newest *published* framework
     version, but server actions use the evaluation's *pinned*
     `framework_version` — these will silently diverge once framework v2 is
     published. Must be resolved in Phase 5.

  **Owner checkpoint: superseded by Phase 3.1 below** — the owner's "ok, some
  changes" turned into the 15-item Phase 3.1 rework brief, which addresses
  flagged items 1-4 directly (2: gate relaxed; 3: gone, evaluation always has
  a score record now that scoring+valuation are one page; 4: soft warnings
  added). Items 5 (MarketWatch link) and 6 (framework-version divergence,
  deferred to Phase 5) are still open.
- **Phase 3.1 — valuation + evaluation-page rework: BUILT, QA'd (fix-first
  round applied), pending owner review and migration application.**
  Owner-approved 15-item brief covering:
  merged evaluation+valuation into one page per ticker (old
  `/evaluation/[ticker]/valuation` route now redirects there); valuation
  gate fully relaxed (reachable on a zero-answer draft or a FAIL, no
  scoring-status check anywhere); non-blocking negative-FCF teaching note
  (DCF inputs are never disabled/greyed, only the DCF output area swaps to
  the note); model-fit tooltips on every valuation-summary row; debt input
  split into 4 fields (short/long-term debt, short/long-term lease,
  auto-summed) with migrate-on-read for old single-total rows; Projected FCF
  table now collapsible (collapsed by default); Valuation Summary rebuilt as
  one fixed-order table (DCF, P/B, Dividend, P/E, P/OCF) with no headline DCF
  treatment and Margin of Safety removed from every display surface (still
  computed internally to band the DCF's own signal); dashboard Valuation
  column replaced with a live-recomputed "UV x/y" badge (dashboard reads are
  documented as sharing the published framework's `valuation_config` across
  every row — the framework-version-divergence issue below is unaffected
  since only framework v1 has ever existed); P/B, P/E and P/OCF became "5Y
  average multiple" models (5 yearly inputs -> average, vs. a derived current
  multiple) instead of the old avg-ratio-vs-share-price shape; P/OCF's
  `ocf_per_share` input replaced with total OCF ($M), OCF/share now derived
  from diluted shares (reused from the DCF section, resolving Phase 3 flagged
  item 1); CAGR helper input order flipped (latest/TTM FCF first) plus a
  "count the gaps" guideline and a years-out-of-range soft warning; SNAKE
  section split into two separately-rendered tables (Risks, Economic Moats)
  under a renamed "Qualitative Analysis" heading, FRIEDD+Others renamed
  "Quantitative Analysis" — original acronyms kept as small muted sub-labels,
  scoring criterion keys untouched; app-wide dark mode toggle (header,
  localStorage-persisted, no-flash init script in `src/app/layout.tsx`).
  Spec: `docs/phase3-valuation-spec.md` (Phase 3.1 addendum at the top, DCF
  math/GOOGL worked example unchanged).
  - **Migration `0008_generic_section_titles.sql`: APPLIED to remote
    2026-08-11** (verified in the DB: group titles "Quantitative Analysis" /
    "Qualitative Analysis", tables Risks + Economic Moats). Guarded the same
    way as 0004/0005. **Not a deploy-ordering hazard** —
    `src/lib/display-groups.ts` tolerates both the pre-3.1 and current
    `display.groups` shapes at runtime, so the migration can be applied
    before or after this code ships without breaking the evaluation page
    either way.
  - **`evaluations.valuation_summary` is now fully deprecated.** No code
    reads or writes it anymore — every valuation signal (the page, the
    dashboard badge) recomputes live from `valuation_inputs` +
    `share_price`. The column itself is still in the schema; dropping it is
    a deferred cleanup, not done in this migration.
  - `npm run verify-valuation` was updated for the new entry-model
    shapes (yearly-multiple arrays, `ocf_total` instead of
    `ocf_per_share`, 4-field debt) and to drop the removed
    `computeValuationSummary` assertions — the GOOGL DCF numbers
    (discount rate, Year 1 FCF/PV, sum of PV, net debt, intrinsic
    value/share $258.34) are byte-identical to the Phase 3 golden test.
  - **Owner-reviewed 2026-08-11:** tooltip copy (5 models) and all new
    student-facing microcopy approved as drafted at the Phase 3.1 checkpoint.
  - **Adversarial QA (2026-08-11): fix-first round applied.** Golden tests,
    engine math, migration 0008 guards, RLS, and pedagogy verified clean;
    6 issues required fixes before this is deployable:
    1. **CRITICAL — deploy-ordering deadlock, fixed.** The scoring page
       crashed (`TypeError`) if the DB still held the pre-3.1 `display.groups`
       shape, which production currently does — there was no migration
       order that avoided breaking either the old or new code. Fixed by
       `src/lib/display-groups.ts`, a runtime normalizer that tolerates
       both shapes; regression-checked in the new
       `npm run verify-display-groups`.
    2. **HIGH — dashboard badge staleness, fixed.** The badge only used
       each evaluation's stored `share_price` (last refreshed on that
       ticker's own page visit), so it couldn't reflect a market move with
       no student action, contradicting the owner's explicit requirement.
       The dashboard now refreshes every distinct ticker via `getTickerInfo`
       (concurrency-capped, `ticker_cache`'s 24h TTL still bounds Finnhub
       calls) and writes the fresh price back.
    3. **MEDIUM — mobile tooltip first-tap dead, fixed.** Switched
       `InfoTooltip` (valuation summary + model cards) from
       mouseenter/click to pointer events (`pointerType === "mouse"` gates
       hover-open) plus a document-level outside-pointerdown listener to
       close it, replacing the unreliable `onBlur`.
    4. **MEDIUM — dark-mode auth pages, fixed.** Login, signup, and the
       access-code form had hardcoded `text-slate-700`/`text-brand` classes
       with no dark counterpart (near-invisible on a dark card); swapped
       for the app's semantic tokens. Admin page intentionally left as-is.
    5. **LOW — negative entry price, fixed.** A negative/zero fundamental
       (e.g. BVPS -10) rendered a nonsense negative "entry price"
       (`multipleModelResult` in `src/lib/valuation.ts`); now nulls the
       price (dash in the UI) the same way it already nulled the signal.
    6. **LOW — lingering legacy-debt note, fixed.** The "migrated from your
       old total" note now clears as soon as the student edits any of the
       4 debt/lease fields, instead of persisting until the next reload.
    Negative-FCF behavior (inputs editable, DCF output refused with a
    teaching note) and the badge's count-based sort order were both
    confirmed by the owner at the checkpoint.
  **Phase 3.1 status: LIVE, owner-approved 2026-08-11** (commits `3d82791`,
  `e3231d8`, `c0d2bb7` pushed; migration 0008 applied; owner eyeballed live).
- **Phase 3.2 — 5Y-average UX round: LIVE, owner-approved 2026-08-11.**
  Commit `d0abcd1`: optional 6th year box per multiple (average divides by
  visible boxes, strict all-visible-filled-or-null rule extended),
  paste-to-fill on the year boxes (tab/comma/whitespace rows, strips
  `$`/`%`/`x`/thousands-commas, auto-expands the 6th box on a 6-value paste),
  and a consistent bordered `ImpliedPriceBox` on every model's implied entry
  price / DCF intrinsic value. Adversarial QA: ship-ready, no fix round
  needed. Known accepted quirks: single-value messy pastes (e.g. `$1,000`
  alone) fall to native paste and are rejected by the number input;
  European-style `12,5` decimals parse as two values.
- **Phase 3.3 — visual backlog (logged 2026-08-11, NOT started; owner wants
  these eventually, not urgent):**
  1. At narrow window widths the valuation summary disappears entirely —
     it should remain reachable at every viewport width.
  2. When the summary IS shown at narrow width, the 5-6 yearly-multiple
     boxes get so tight the numbers are unreadable — needs a responsive
     layout fix (wrap the boxes, or stack summary/inputs) so year values
     stay legible with the summary visible.
- **Phase 4** — Portfolio plan. Not started.
- **Phase 5** — Admin panel: framework editor (for `framework_versions`) + access-code
  rotation UI (replacing the current CLI/SQL-only flow). Not started.
- **Phase 6** — Polish + launch. Not started. **Critical launch blocker:** rotate
  the access code off the dev seed `WELCOME2026` (still the live code) before
  students get the link (see `scripts/set-access-code.mjs` in README).

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
- `scripts/` — `db-migrate.mjs`, `set-access-code.mjs`, `verify-scoring.mjs`,
  `verify-valuation.mjs`.
