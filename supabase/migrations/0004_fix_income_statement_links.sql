-- Phase 2 QA fix — correct the "Financials > Income" source links.
--
-- Three criteria (sci_tech, eps_trend, revenue_trend) are labelled
-- "Financials > Income > ..." but pointed at
-- https://stockanalysis.com/stocks/{ticker}/financials/, which stockanalysis.com
-- now serves as a *Financials Overview* summary page, not the income statement.
-- Verified live 2026-08-10: that overview page does NOT contain the Research &
-- Development line item at all, so a student sent there for the Science & Tech
-- risk cannot find the data the criterion asks for. The income statement lives
-- at /financials/income-statement/ and does contain R&D, Revenue and EPS.
--
-- This only rewrites the three url_template values; every label, definition,
-- rule, option and point value is untouched.

update public.framework_versions
set definition = jsonb_set(
  jsonb_set(
    jsonb_set(
      definition,
      '{sections,0,criteria,3,source,url_template}',
      '"https://stockanalysis.com/stocks/{ticker}/financials/income-statement/"'::jsonb,
      false
    ),
    '{sections,1,criteria,0,source,url_template}',
    '"https://stockanalysis.com/stocks/{ticker}/financials/income-statement/"'::jsonb,
    false
  ),
  '{sections,2,criteria,0,source,url_template}',
  '"https://stockanalysis.com/stocks/{ticker}/financials/income-statement/"'::jsonb,
  false
)
where version = 1
  -- Guard the positional paths: only apply if the criteria really are the ones
  -- we think they are, so this is a no-op rather than a corruption if the
  -- definition JSON is ever reordered.
  and definition #>> '{sections,0,criteria,3,key}' = 'eps_trend'
  and definition #>> '{sections,1,criteria,0,key}' = 'revenue_trend'
  and definition #>> '{sections,2,criteria,0,key}' = 'sci_tech';

notify pgrst, 'reload schema';
