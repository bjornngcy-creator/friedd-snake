-- Phase 3 — valuation columns on evaluations.
--
-- valuation_inputs: raw student-entered valuation numbers (source of truth),
-- same 1:1-with-the-evaluation-row cardinality as `inputs` for scoring.
-- valuation_summary: denormalized DCF headline, recomputed and overwritten
-- on every autosave, so the dashboard can render/sort the Valuation column
-- without recomputing a DCF for every row. Shape:
--   { dcf_available: boolean, margin_of_safety: number|null,
--     dcf_signal: "Undervalued"|"Fair Value"|"Overvalued"|null,
--     updated_at: iso-string }
-- No `overall_verdict` field — Phase 3 owner decision: every valuation model
-- gets its own independent signal, never blended into one verdict.
--
-- No new grants needed: `evaluations` already has `select, insert, update,
-- delete` granted to `authenticated` and `all` to `service_role` from
-- 0003_phase2_core.sql, and column additions to an already-granted table
-- don't need re-granting. Still need the schema-reload notify, though.

alter table public.evaluations
  add column if not exists valuation_inputs jsonb not null default '{}'::jsonb,
  add column if not exists valuation_summary jsonb;

notify pgrst, 'reload schema';
