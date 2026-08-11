-- Phase 3 — add `valuation_config` to the framework definition JSON.
--
-- Valuation assumptions a future Phase 5 admin should be able to tune
-- without a code deploy: the dividend-yield-model's hardcoded 5% assumption
-- (sheet comment: "assume 5% base" — a hardcoded constant in the sheet
-- formula, not a cell; lifted into config per phase3-valuation-spec.md
-- §1.3/§1.6), the terminal-growth-rate guidance band shown as UI copy, and
-- the DCF's own margin-of-safety signal bands (owner-locked: no blended/
-- overall verdict anywhere — DCF gets its own Undervalued/Fair/Overvalued
-- signal from these bands, same shape the spec proposed for an "overall"
-- verdict, just scoped to DCF alone; src/lib/valuation.ts reads these from
-- framework config rather than hardcoding 0.15).
--
-- Unlike 0004/0005, this is an ADDITIVE top-level key, not a positional-path
-- rewrite inside `sections`/`display` — so the guard shape is different:
-- confirm the key doesn't already exist (idempotent — safe to re-run) AND
-- sanity-check two stable, already-migrated markers (the first FRIEDD
-- section's key, and the display-groups key added in 0005) really are what
-- we expect before writing, same "no-op instead of corruption" spirit as
-- the guarded updates in 0004/0005.

update public.framework_versions
set definition = jsonb_set(
  definition,
  '{valuation_config}',
  '{
    "dividend_yield_assumption": 0.05,
    "terminal_growth_guidance": { "min": 0.02, "max": 0.04 },
    "margin_of_safety_bands": { "undervalued": 0.15, "overvalued": -0.15 }
  }'::jsonb,
  true
)
where version = 1
  and not (definition ? 'valuation_config')
  and definition #>> '{sections,0,key}' = 'friedd'
  and definition #>> '{display,groups,0,key}' = 'friedd_group';

notify pgrst, 'reload schema';
