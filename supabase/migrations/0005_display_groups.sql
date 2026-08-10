-- Phase 2 owner feedback — two-group visual restructure + risks copy cleanup.
--
-- Adds `display` metadata to the framework definition describing how the
-- Phase 2 form (and the future Phase 5 admin editor) should visually group
-- the four scoring sections into two top-level groups:
--   FRIEDD group ("Understand the financials") = friedd + others sections,
--     merged into one flat criteria list (no separate "Others" subheading).
--   SNAKE group ("Understand the quality")     = snake_risks + moats
--     sections, kept as two titled subsections ("Risks" / "Economic Moats").
--
-- This is pure presentation metadata. src/lib/scoring.ts keeps iterating
-- `definition.sections` exactly as it did before this migration — no
-- section, criterion, option, or point value changes here, so raw/final
-- scores for every existing evaluation are untouched.
--
-- Also, per owner feedback on the same checkpoint:
--   (a) renames the `snake_risks` section title from "SNAKE Risks" to
--       "Risks" now that "SNAKE" is the group-level header a level up.
--   (b) removes the "Use your own understanding of the company and
--       industry" helper copy from the Key Person risk criterion (the
--       owner explicitly wants it gone from the SNAKE/risks segment). The
--       three moat criteria that use the same sentence are untouched.
--
-- Guarded the same way as 0004: every positional path is checked against
-- the criterion/section key we expect to find there first, so this is a
-- no-op rather than a corruption if the definition JSON is ever reordered.

update public.framework_versions
set definition = jsonb_set(
  jsonb_set(
    jsonb_set(
      definition,
      '{display}',
      '{
        "groups": [
          {
            "key": "friedd_group",
            "title": "FRIEDD",
            "subtitle": "Understand the financials",
            "section_keys": ["friedd", "others"],
            "merge_sections": true
          },
          {
            "key": "snake_group",
            "title": "SNAKE",
            "subtitle": "Understand the quality",
            "section_keys": ["snake_risks", "moats"],
            "merge_sections": false,
            "equity_scope_note": "Use Equity Scope to help you"
          }
        ]
      }'::jsonb,
      true
    ),
    '{sections,2,title}',
    '"Risks"'::jsonb,
    false
  ),
  '{sections,2,criteria,3,source,label}',
  '""'::jsonb,
  false
)
where version = 1
  and definition #>> '{sections,0,criteria,3,key}' = 'eps_trend'
  and definition #>> '{sections,1,criteria,0,key}' = 'revenue_trend'
  and definition #>> '{sections,2,criteria,0,key}' = 'sci_tech'
  and definition #>> '{sections,2,criteria,3,key}' = 'key_person'
  and definition #>> '{sections,2,title}' = 'SNAKE Risks'
  and definition #>> '{sections,3,criteria,0,key}' = 'intangible_assets';

notify pgrst, 'reload schema';
