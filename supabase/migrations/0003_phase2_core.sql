-- FRIEDD SNAKE — Phase 2 core schema (Part C1)
-- framework_versions, evaluations, ticker_cache.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- framework_versions
-- Versioned FRIEDD SNAKE scoring framework definitions. The evaluation form
-- and scoring engine (src/lib/scoring.ts) are both driven entirely by the
-- `definition` JSON here — no criteria are hardcoded in components.
-- ---------------------------------------------------------------------------
create table if not exists public.framework_versions (
  id serial primary key,
  version integer not null unique,
  definition jsonb not null,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.framework_versions enable row level security;

drop policy if exists "Authenticated can read published framework versions" on public.framework_versions;

create policy "Authenticated can read published framework versions"
  on public.framework_versions for select
  to authenticated
  using (published = true);

-- ---------------------------------------------------------------------------
-- evaluations
-- One row per (user, ticker). inputs holds the raw per-criterion answers
-- keyed by the framework definition's stable criterion keys; raw_score,
-- final_score, and verdict are computed by src/lib/scoring.ts and persisted
-- alongside on every autosave so the dashboard can list/sort without
-- recomputing.
-- ---------------------------------------------------------------------------
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  company_name text,
  share_price numeric,
  framework_version integer not null references public.framework_versions (version),
  status text not null default 'draft',
  inputs jsonb not null default '{}'::jsonb,
  raw_score numeric,
  final_score numeric,
  verdict text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ticker)
);

alter table public.evaluations enable row level security;

drop policy if exists "Owners can select own evaluations" on public.evaluations;
drop policy if exists "Owners can insert own evaluations" on public.evaluations;
drop policy if exists "Owners can update own evaluations" on public.evaluations;
drop policy if exists "Owners can delete own evaluations" on public.evaluations;

create policy "Owners can select own evaluations"
  on public.evaluations for select
  using (auth.uid() = user_id);

create policy "Owners can insert own evaluations"
  on public.evaluations for insert
  with check (auth.uid() = user_id);

create policy "Owners can update own evaluations"
  on public.evaluations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Owners can delete own evaluations"
  on public.evaluations for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- ticker_cache
-- Server-only price/name lookup cache (Finnhub), keyed by ticker. No client
-- access at all — RLS enabled with zero policies, service role only, same
-- pattern as access_codes / access_code_attempts.
-- ---------------------------------------------------------------------------
create table if not exists public.ticker_cache (
  ticker text primary key,
  company_name text,
  price numeric,
  fetched_at timestamptz not null default now()
);

alter table public.ticker_cache enable row level security;
-- Intentionally no policies here — service-role only.

-- ---------------------------------------------------------------------------
-- Grants. Tables created in this project get no API-role grants by default
-- (see Phase 1 lesson in 0001_init.sql) — every migration must be explicit.
-- ---------------------------------------------------------------------------
grant select on public.framework_versions to authenticated;
grant all on public.framework_versions to service_role;

grant select, insert, update, delete on public.evaluations to authenticated;
grant all on public.evaluations to service_role;

grant all on public.ticker_cache to service_role;

-- ---------------------------------------------------------------------------
-- Seed: framework v1, built from the FRIEDD SNAKE spec (sheet.xlsx).
-- ---------------------------------------------------------------------------
insert into public.framework_versions (version, definition, published)
values (
  1,
  $framework_json${
  "equity_scope_url": "https://chatgpt.com/g/g-68be5757c520819183e78e4c279ce583-bpc-ai-powered-stock-research-tool",
  "scoring": {
    "max_raw": 20,
    "scale_to": 10,
    "pass_threshold": 7.0
  },
  "sections": [
    {
      "key": "friedd",
      "title": "F.R.I.E.D.D",
      "subtitle": "Financial health",
      "instructions": "Allocate +1/+2 points for each pass, based on stockanalysis.com.",
      "max_points": 10,
      "criteria": [
        {
          "key": "fcf_trend",
          "label": "Free Cash Flow (Trend)",
          "definition": "Free Cash Flow = Cash Flow from Operations - Capital Expenditures (CAPEX). Capex refers to one-time expenditures eg, building new factories, buying over a company etc",
          "rule": "1 pt if positive & consistent, 2 pts if increasing.",
          "input_type": "scale",
          "options": [
            { "value": 0, "label": "Neither positive nor consistent" },
            { "value": 1, "label": "Positive & consistent (+1)" },
            { "value": 2, "label": "Increasing (+2)" }
          ],
          "source": {
            "label": "stockanalysis.com — Financials > Cash Flow > Free Cash Flow",
            "url_template": "https://stockanalysis.com/stocks/{ticker}/financials/cash-flow-statement/"
          }
        },
        {
          "key": "roe",
          "label": "ROE (TTM)",
          "definition": "ROE = Net income / Equity, Equity = Assets - Liabilities. More liabilities will cause Low Equity, but high ROE.",
          "rule": "1 pt if >15%, 2 pts if >25%.",
          "input_type": "scale",
          "options": [
            { "value": 0, "label": "15% or below" },
            { "value": 1, "label": "Above 15% (+1)" },
            { "value": 2, "label": "Above 25% (+2)" }
          ],
          "source": {
            "label": "stockanalysis.com — Financials > Ratios > ROE",
            "url_template": "https://stockanalysis.com/stocks/{ticker}/financials/ratios/"
          }
        },
        {
          "key": "int_coverage",
          "label": "Int Coverage (TTM)",
          "definition": "Refers to the company's ability to pay off interest from debt. Higher the better.",
          "rule": "1 pt if >4, 2 pts if >10.",
          "input_type": "scale",
          "options": [
            { "value": 0, "label": "4 or below" },
            { "value": 1, "label": "Above 4 (+1)" },
            { "value": 2, "label": "Above 10 (+2)" }
          ],
          "source": {
            "label": "stockanalysis.com — Financials > Statistics > Interest Coverage",
            "url_template": "https://stockanalysis.com/stocks/{ticker}/statistics/"
          }
        },
        {
          "key": "eps_trend",
          "label": "EPS (Trend)",
          "definition": "EPS = Net income / No. of outstanding shares in the market",
          "rule": "1 pt if positive & consistent, 2 pts if increasing.",
          "input_type": "scale",
          "options": [
            { "value": 0, "label": "Neither positive nor consistent" },
            { "value": 1, "label": "Positive & consistent (+1)" },
            { "value": 2, "label": "Increasing (+2)" }
          ],
          "source": {
            "label": "stockanalysis.com — Financials > Income > EPS",
            "url_template": "https://stockanalysis.com/stocks/{ticker}/financials/"
          }
        },
        {
          "key": "dividends",
          "label": "Dividends (TTM)",
          "definition": "Young and/or fast growing companies usually do not give out dividends and use the money to expand instead.",
          "rule": "1 pt if dividend paid, 0 pts if none.",
          "input_type": "scale",
          "options": [
            { "value": 0, "label": "No dividend" },
            { "value": 1, "label": "Dividend paid (+1)" }
          ],
          "source": {
            "label": "stockanalysis.com — Overview > Dividends",
            "url_template": "https://stockanalysis.com/stocks/{ticker}/statistics/"
          }
        },
        {
          "key": "de_ratio",
          "label": "Debt/Equity ratio (TTM)",
          "definition": "Compares Debt to Equity. Ratio of 0.5 means for every $1 debt, there is $2 equity. The lower the better. Equity = All Assets - All Liabilities",
          "rule": "1 pt if <0.5, 0 pts if >0.5.",
          "input_type": "scale",
          "options": [
            { "value": 0, "label": "0.5 or above" },
            { "value": 1, "label": "Below 0.5 (+1)" }
          ],
          "source": {
            "label": "stockanalysis.com — Financials > Ratios > Debt/Equity ratio",
            "url_template": "https://stockanalysis.com/stocks/{ticker}/financials/ratios/"
          }
        }
      ]
    },
    {
      "key": "others",
      "title": "Others",
      "subtitle": null,
      "instructions": "Allocate points for each pass, based on stockanalysis.com.",
      "max_points": 5,
      "criteria": [
        {
          "key": "revenue_trend",
          "label": "Increasing Revenue (Trend)",
          "definition": "Revenue refers to the sales ($) of the company",
          "rule": "1 pt if positive & consistent, 2 pts if increasing.",
          "input_type": "scale",
          "options": [
            { "value": 0, "label": "Neither positive nor consistent" },
            { "value": 1, "label": "Positive & consistent (+1)" },
            { "value": 2, "label": "Increasing (+2)" }
          ],
          "source": {
            "label": "stockanalysis.com — Financials > Income > Revenue",
            "url_template": "https://stockanalysis.com/stocks/{ticker}/financials/"
          }
        },
        {
          "key": "retained_earnings_trend",
          "label": "Retained earnings (Trend)",
          "definition": "Retained earnings refers to the unspent profits accumulated over the years.",
          "rule": "1 pt if positive & consistent, 2 pts if increasing.",
          "input_type": "scale",
          "options": [
            { "value": 0, "label": "Neither positive nor consistent" },
            { "value": 1, "label": "Positive & consistent (+1)" },
            { "value": 2, "label": "Increasing (+2)" }
          ],
          "source": {
            "label": "stockanalysis.com — Balance Sheet > Retained Earnings",
            "url_template": "https://stockanalysis.com/stocks/{ticker}/financials/balance-sheet/"
          }
        },
        {
          "key": "share_repurchase",
          "label": "Share repurchase",
          "definition": "If the company have high debt, low cash flow/profits/retained earnings and still do share repurchase, WATCH OUT!",
          "rule": "1 pt Yes, 0 pts No.",
          "input_type": "scale",
          "options": [
            { "value": 0, "label": "No" },
            { "value": 1, "label": "Yes (+1)" }
          ],
          "source": {
            "label": "Search: \"<company name> share repurchase\" (no direct stockanalysis.com page)",
            "url": null
          }
        }
      ]
    },
    {
      "key": "snake_risks",
      "title": "SNAKE Risks",
      "subtitle": "Each risk present costs -1",
      "instructions": "Allocate -1 points for each presence of risk.",
      "max_points": 0,
      "criteria": [
        {
          "key": "sci_tech",
          "label": "Science & Tech",
          "definition": "Companies with Science & Tech Risks have to spend money on R&D to remain competitive and does not guarantee success.",
          "rule": "Does the company rely on significant R&D to drive innovation and maintain competitiveness? If yes, -1.",
          "input_type": "flag",
          "flag_effect": -1,
          "source": {
            "label": "stockanalysis.com — Financials > Income > R&D",
            "url_template": "https://stockanalysis.com/stocks/{ticker}/financials/"
          }
        },
        {
          "key": "inferior_net_margin",
          "label": "Inferior Net Margin",
          "definition": "Net Margin = Net Income / Total Revenue. High Net Margin means that the company is able to either charge a premium, reduce expenses, or both.",
          "rule": "Does the company have lower profit margins compared to competitors? If yes, -1.",
          "input_type": "flag",
          "flag_effect": -1,
          "source": {
            "label": "stockanalysis.com — Compare tool (add competitor tickers, compare Profit Margin)",
            "url_template": "https://stockanalysis.com/stocks/compare/"
          }
        },
        {
          "key": "authority",
          "label": "Authority",
          "definition": "Refers to government laws/rules that may affect the company negatively",
          "rule": "Is the company influenced by regulations or government policies that can impact its operations? If yes, -1.",
          "input_type": "flag",
          "flag_effect": -1,
          "source": {
            "label": "Annual Report — Ctrl+F \"Regulations\", or ask an AI research assistant",
            "url": null
          }
        },
        {
          "key": "key_person",
          "label": "Key Person(s)",
          "definition": "Company is very dependant on 1 person or a small group of people.",
          "rule": "Does the company's success heavily depend on one or a few key individuals? If yes, -1.",
          "input_type": "flag",
          "flag_effect": -1,
          "source": {
            "label": "Use your own understanding of the company and industry",
            "url": null
          }
        }
      ]
    },
    {
      "key": "moats",
      "title": "Economic Moats",
      "subtitle": "Each moat present adds +1",
      "instructions": "Allocate +1 points for each presence of moat.",
      "max_points": 5,
      "criteria": [
        {
          "key": "intangible_assets",
          "label": "Intangible Assets",
          "definition": "Refers to brands, copyright, patents etc that gives the company an advantage over competitors",
          "rule": "Does the company have strong intangible assets such as brands, copyright, patents etc? If yes, +1.",
          "input_type": "flag",
          "flag_effect": 1,
          "source": {
            "label": "Annual Report — Ctrl+F \"Trademark\", or ask an AI research assistant",
            "url": null
          }
        },
        {
          "key": "low_cost_advantage",
          "label": "Low Cost Advantage",
          "definition": "Refers to the company's ability to produce goods and services cheaply. Companies with LCA have high Gross Margins.",
          "rule": "Does the company have higher gross margins than its competitors? If yes, +1.",
          "input_type": "flag",
          "flag_effect": 1,
          "source": {
            "label": "stockanalysis.com — Compare tool (add competitor tickers, compare Gross Margin)",
            "url_template": "https://stockanalysis.com/stocks/compare/"
          }
        },
        {
          "key": "high_switching_cost",
          "label": "High Switching Cost",
          "definition": "Refers to the high cost (time or effort) for a customer to switch to products or services of competitors.",
          "rule": "Does the company make it costly or inconvenient for customers to switch to competitors? If yes, +1.",
          "input_type": "flag",
          "flag_effect": 1,
          "source": {
            "label": "Use your own understanding of the company and industry",
            "url": null
          }
        },
        {
          "key": "network_effect",
          "label": "Network Effect",
          "definition": "Large number of a group of users attract more business, (merchants attract buyers, more buyers attract more merchants)",
          "rule": "Does the product or service become more valuable as more people use it? If yes, +1.",
          "input_type": "flag",
          "flag_effect": 1,
          "source": {
            "label": "Use your own understanding of the company and industry",
            "url": null
          }
        },
        {
          "key": "efficient_scale",
          "label": "Efficient Scale",
          "definition": "Industry is so small that it does not make sense to have so many companies. For eg, defence industry etc",
          "rule": "Does the company dominate a niche market with limited competition due to high entry barriers? If yes, +1.",
          "input_type": "flag",
          "flag_effect": 1,
          "source": {
            "label": "Use your own understanding of the company and industry",
            "url": null
          }
        }
      ]
    }
  ]
}
$framework_json$::jsonb,
  true
)
on conflict (version) do update set definition = excluded.definition;

notify pgrst, 'reload schema';
