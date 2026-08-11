-- Phase 3.1 — generic section titles + split SNAKE into two tables.
--
-- Two owner-approved rendering changes (items 13/14 of the Phase 3.1 brief),
-- both display-metadata only:
--
--   (a) The two top-level groups get generic labels: "FRIEDD" -> "Quantitative
--       Analysis", "SNAKE" -> "Qualitative Analysis". The original acronyms
--       are kept as small, muted sub-labels (the `subtitle` field, already
--       rendered as small muted text under the group heading — see
--       src/components/evaluation-form.tsx) instead of being dropped.
--   (b) The SNAKE group's two sections (Risks, Economic Moats) — previously
--       rendered as two subsections sharing ONE card under the "SNAKE"
--       heading — now render as TWO separately-boxed tables under the
--       shared "Qualitative Analysis" heading. This is a structural change
--       to `display.groups`: the old flat `section_keys`/`merge_sections`
--       fields on a group become a `tables` array (one table per rendered
--       box), matching the new FrameworkDisplayGroup/FrameworkDisplayTable
--       shape in src/lib/scoring.ts.
--
-- Scoring criterion KEYS are untouched — src/lib/scoring.ts keeps iterating
-- `definition.sections` by key exactly as before, and every stored
-- evaluation's `inputs` JSON still matches. This migration only rewrites
-- `definition.display`, nothing in `definition.sections`. Raw/final scores
-- for every existing evaluation are unaffected.
--
-- Guard: unlike 0004/0005 (positional-path rewrites inside `sections`) or
-- 0007 (additive top-level key), this is a full replacement of the
-- `{display}` subtree — same shape as 0005's original `{display}` write.
-- The guard here confirms the CURRENT `display.groups` really is the
-- pre-3.1 shape 0005 produced (both group keys, in order) before
-- overwriting, plus the same stable `sections` markers 0005/0007 already
-- checked — so a `display` block that's already been hand-edited or
-- reordered makes this a no-op instead of a silent corruption.

update public.framework_versions
set definition = jsonb_set(
  definition,
  '{display}',
  '{
    "groups": [
      {
        "key": "friedd_group",
        "title": "Quantitative Analysis",
        "subtitle": "F.R.I.E.D.D",
        "tables": [
          {
            "key": "friedd_others_table",
            "title": null,
            "section_keys": ["friedd", "others"],
            "merge_sections": true
          }
        ]
      },
      {
        "key": "snake_group",
        "title": "Qualitative Analysis",
        "subtitle": "SNAKE",
        "equity_scope_note": "Use Equity Scope to help you",
        "tables": [
          {
            "key": "risks_table",
            "title": "Risks",
            "section_keys": ["snake_risks"],
            "merge_sections": true
          },
          {
            "key": "moats_table",
            "title": "Economic Moats",
            "section_keys": ["moats"],
            "merge_sections": true
          }
        ]
      }
    ]
  }'::jsonb,
  true
)
where version = 1
  and definition #>> '{display,groups,0,key}' = 'friedd_group'
  and definition #>> '{display,groups,0,title}' = 'FRIEDD'
  and definition #>> '{display,groups,1,key}' = 'snake_group'
  and definition #>> '{display,groups,1,title}' = 'SNAKE'
  and definition #>> '{sections,0,key}' = 'friedd'
  and definition #>> '{sections,2,key}' = 'snake_risks'
  and definition #>> '{sections,3,key}' = 'moats';

notify pgrst, 'reload schema';
