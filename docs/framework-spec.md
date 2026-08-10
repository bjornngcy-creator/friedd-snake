# FRIEDD SNAKE Framework — Full Spec (extracted from sheet.xlsx)

Source workbook: `sheet.xlsx` (Google Sheet exported to xlsx). Extracted with `openpyxl`, both `data_only=False` (formulas) and `data_only=True` (last-cached computed values). Tabs covered: `Definitions`, `Portfolio Plan`, `FRIEDD SNAKE Framework (Templat` (canonical template), `EG. GOOGL` / `EG. META` / `EG. MSFT` (worked examples, used for cross-checks), `FS & DCF v2 (Template)_OLD` (superseded version, skimmed only).

All cell refs below are from the **template tab** unless stated otherwise. Column layout is consistent across the template and all three example tabs: `C` = label, `D` = input/value, `E` = points/output, `F` = source link/help text, `G` = secondary output (DCF table only).

---

## 0. Header block (rows 1–7)

| Cell | Content |
|---|---|
| B1 | "Click File>Make A Copy and save in your Google Drive" (Google Sheets boilerplate — irrelevant to a web app) |
| C4 / D4 | **Date Updated** — input, beige, date format `mmmm d, yyyy` |
| F4 | "Fill up biege cells only" — instruction label (their spelling, not a typo I introduced) |
| C5 / D5 | **Company Ticker** — input, beige, plain text (e.g. "GOOGL"). This is the single ticker driving every `stockanalysis.com` link on the sheet via string concatenation (`$D$5`). |
| C6 / D6 | **Company Name** — `=IFERROR(GOOGLEFINANCE(D5,"name"), "#N/A")`. **GOOGLEFINANCE — Google Sheets only, does not survive xlsx export** (formula literally became `__xludf.DUMMYFUNCTION(...)` placeholder text on export; value shown is whatever was last cached, or `#N/A` in the blank template). Web app replacement: manual input, or a market-data API (e.g. a ticker→name lookup). |
| F6 | "AI Prompt Guide" — hyperlink to an **external Google Doc**: `https://docs.google.com/spreadsheets/d/1iyw52WZhZBDukfkrQ7nhjS4kR5mz3bOEHYLQ-w74K_Q/edit?...&gid=1625102335`. This doc is outside the workbook and was not fetched — flag to Bjorn if its content should be pulled in separately (the label suggests it's a prompt for AI-assisted data lookup, but the destination is actually another spreadsheet tab, not a doc of prompt text — worth him double-checking that link still resolves to what he expects). |
| C7 / D7 | **Share Price** — `=IFERROR(GOOGLEFINANCE(D5,"price"), "#N/A")`. Same GOOGLEFINANCE caveat. This value, `$D$7`, is the current market price used later for Margin of Safety. Replacement: manual input or live quote API. |
| F12 | Hyperlink to `http://stockanalysis.com/` (general source attribution) |

**Beige cells = student inputs.** Fill color `FFFFF2CC` (light tan) marks every editable cell. Full beige-cell list on the template tab:
`D4, D5, E13:E18, E21:E23, E27:E30, E34:E38, D47, D48, D50, D51, D52, D54, D58, D59, D61, D62, D63, D65, D66, D67, D69, D70, D71`.
Everything else is a label, formula, or computed output — do not let users type into those cells in the web app.

---

## 1. STEP 1: COMPANY ANALYSIS (rows 10–42)

Section header at `C10` (merged `C10:G10`): **"STEP 1: COMPANY ANALYSIS"**.

### 1a. F.R.I.E.D.D (rows 12–19) — financial health, max 10 pts

Header row 12: `D12` = "Allocate +1/+2 points for each Pass:", `E12` = "Points", `F12` = "From stockanalysis.com".

| Row | Criterion (C) | Rule (D) | Points input (E, beige) | Source link (F) — `HYPERLINK` formula pattern | Comment on F cell (nav path on stockanalysis.com) |
|---|---|---|---|---|---|
| 13 | Free Cash Flow (Trend) | 1 pt if positive & consistent, 2 pts if increasing | student enters 0/1/2 | `=HYPERLINK("https://stockanalysis.com/stocks/"&$D$5&"/financials/cash-flow-statement/","Click here to find "&$D$5&" FCF")` | Financials>CashFlow>FreeCashFlow |
| 14 | ROE (TTM) | 1 pt if >15%, 2 pts if >25% | 0/1/2 | `.../financials/ratios/` | Financials>Ratios>ROE |
| 15 | Int Coverage (TTM) | 1 pt if >4, 2 pts if >10 | 0/1/2 | `.../statistics/` | Financials>Statistics>Interest Coverage |
| 16 | EPS (Trend) | 1 pt if positive & consistent, 2 pts if increasing | 0/1/2 | `.../financials/` | Financials>Income>EPS |
| 17 | Dividends (TTM) | 1 pt if dividend paid, 0 pts if none | 0/1 | `.../statistics/` | Overview>Dividends |
| 18 | Debt/Equity ratio (TTM) | 1 pt if <0.5, 0 pts if >0.5 | 0/1 | `.../financials/ratios/` | Financials>Ratios>DebtEquityRatio |
| 19 | **Sub-total** (`D19`) | `E19 = SUM(E12:E18)` — note range starts at the header row 12 (blank/text there so it doesn't affect the sum) through 18 | | | |

Max possible: 2+2+2+2+1+1 = **10**.

### 1b. Others (rows 20–24) — max 5 pts

Header row 20: `D20` = "Allocate +1 points for each Pass:" (label is imprecise — Revenue/Retained Earnings actually allow +2, see rule text), `E20` = "Points".

| Row | Criterion | Rule | Points (E, beige) | Source |
|---|---|---|---|---|
| 21 | Increasing Revenue (Trend) | 1 pt positive & consistent, 2 pts increasing | 0/1/2 | Financials>Income>Revenue |
| 22 | Retained earnings (Trend) | 1 pt positive & consistent, 2 pts increasing | 0/1/2 | BalanceSheet>RetainedEarnings |
| 23 | Share repurchase | 1 pt Yes, 0 pts No | 0/1 | Manual: Google `"<company name> share repurchase 2025"` (no direct stockanalysis.com link — text instruction only) |
| 24 | **Sub-total** (`D24`) | `E24 = SUM(E20:E23)` | | |

Max possible: 2+2+1 = **5**.

### 1c. S.N.A.K.E: Risks + Economic Moats (rows 26–39)

#### Risks (rows 26–31) — max 0, worst‑case −4

Header row 26: `D26` = "Allocate -1 points for each presence of Risk:", `E26` = "Points".

| Row | Risk | Definition (matches Definitions tab, D column is literally the question) | Points (E, beige) | Source |
|---|---|---|---|---|
| 27 | Science & Tech | "Does the company rely on significant R&D to drive innovation and maintain competitiveness?" | 0 or **-1** | Financials>Income>R&D |
| 28 | Inferior Net Margin | "Does the company have lower profit margins compared to competitors?" | 0 or -1 | stockanalysis.com Compare tool (`/stocks/compare/`) — add competitor tickers, compare Profit Margin |
| 29 | Authority | "Is the company influenced by regulations or government policies that can impact its operations?" | 0 or -1 | Annual Report, Ctrl+F "Regulations" / ChatGPT |
| 30 | Key Person(s) | "Does the company's success heavily depend on one or a few key individuals?" | 0 or -1 | "Use own understanding of company and industry" |
| 31 | **Sub-total** (`D31`) | `E31 = SUM(E26:E30)` | | |

Each risk present costs **-1**. Best case (no risks) = 0. Worst case = **-4**.

**Stray cells `I30, K30, L30, M30, N30, O30, P30`** on this row hold literal numbers `13, 15, 16, 17, 18, 19, 20` in every tab (template + all 3 examples + old tab, identical in every case). They are not referenced by any formula anywhere in the workbook — dead leftover data (possibly a scratch sequence from building the scoring scale). Safe to ignore / not port into the web app.

#### Economic Moats (rows 33–39) — max +5

Header row 33: `D33` = "Allocate +1 points for each presence of Moat:", `E33` = "Points".

| Row | Moat | Question (D) | Points (E, beige) | Source |
|---|---|---|---|---|
| 34 | Intangible Assets | "Does the company have strong intangible assets such as brands, copyright, patents etc?" | 0 or +1 | Annual Report → Ctrl+F "Trademark" / ChatGPT |
| 35 | Low Cost Advantage | "Does the company have higher gross margins than its competitors?" | 0 or +1 | stockanalysis.com Compare tool |
| 36 | High Switching Cost | "Does the company make it costly or inconvenient for customers to switch to competitors?" | 0 or +1 | "Use own understanding of company and industry" |
| 37 | Network Effect | "Does the product or service become more valuable as more people use it?" | 0 or +1 | "Use own understanding of company and industry" |
| 38 | Efficient Scale | "Does the company dominate a niche market with limited competition due to high entry barriers?" | 0 or +1 | "Use own understanding of company and industry" |
| 39 | **Sub-total** (`D39`) | `E39 = SUM(E33:E38)` | | |

Max possible: **+5**.

### 1d. Score rollup (rows 40–42)

```
Grand Total       E40 = E31 + E39 + E19 + E24     (SNAKE-risks + Moats + FRIEDD + Others)
TOTAL SCORE (/10)  E42 = (E40 / 20) * 10
Pass/Fail          F42 = IF(E42 >= 7, "PASS", "FAIL")
```

**Max theoretical Grand Total = 20** (FRIEDD 10 + Others 5 + Moats 5 + Risks 0 best-case), which is why the divisor is 20. Comment on `D42`: *">=7 : Pass. <7 : Fail"*.

Pseudocode:
```
friedd_subtotal  = sum(fcf, roe, int_coverage, eps, dividends, de_ratio)      // 0-10
others_subtotal  = sum(revenue, retained_earnings, share_repurchase)          // 0-5
risks_subtotal   = sum(sci_tech, net_margin, authority, key_person)           // -4-0 (each -1 or 0)
moats_subtotal   = sum(intangibles, low_cost, switch_cost, network, scale)    // 0-5

grand_total = risks_subtotal + moats_subtotal + friedd_subtotal + others_subtotal   // -4 to 20
total_score = (grand_total / 20) * 10                                                // -2.0 to 10.0
verdict = "PASS" if total_score >= 7 else "FAIL"
```

No intermediate rating bands (e.g. "watch") exist — it's a hard PASS/FAIL cliff at score 7.0. There is no explicit floor on a negative score in the formula (if risks alone dominate, `total_score` can go negative); the app should decide whether to clamp display at 0 or show the raw negative number as the template does.

---

## 2. STEP 2: VALUATIONS (rows 44–93)

Section header `C44` (merged `C44:G44`): **"STEP 2: VALUATIONS"**.

### 2a. Company financial inputs (rows 46–48)

Header `C46` (merged `C46:G46`): "VALUATION according to Company Financials".

| Row | Field | Cell | Source |
|---|---|---|---|
| 47 | Earnings Per Share | `D47` beige | stockanalysis.com Financials |
| 48 | Book Value Per Share | `D48` beige | stockanalysis.com Balance Sheet |

### 2b. Valuation Models (rows 49–52) — three independent "entry price" estimates

Header row 49: `D49` = "Stockanalysis.com", `E49` = "Entry prices".

| Row | Model | Multiple input (D, beige) | Entry price formula (E) | Comment |
|---|---|---|---|---|
| 50 | 1) 5 Year Average PB ratio | `D50` | `E50 = D48 * D50` (Book Value/Share × avg PB) | "More appropriate for asset-heavy companies (financials, real estate, mining)" |
| 51 | 2) Expected dividend | `D51` (annual dividend, formatted `$#,##0.00`) | `E51 = D51 / 0.05` (dividend ÷ assumed 5% yield) | "Makes sense if intention is to collect passive dividends, assume 5% base" — the 5% is a **hardcoded constant in the formula**, not an input cell |
| 52 | 3) 5 Year Average PE ratio | `D52` | `E52 = D52 * D47` (avg PE × EPS) | "More appropriate for companies with stable earnings (consumer goods, healthcare, established tech)" |

These three don't roll up into one number — they're three independent reference "fair entry prices" for the student to eyeball against share price. **No formula combines them** (e.g. no average-of-3). The web app should just present all three, not synthesize a blended figure the sheet doesn't produce.

### 2c. Indicators (rows 53–54)

| Row | Field | Formula | Comment |
|---|---|---|---|
| 54 | PEG Ratio | `D54` beige (manual input from stockanalysis.com) | — |
| | Verdict | `E54 = IF(D54<1,"Undervalued", IF(D54=1,"Fair Value","Overvalued"))` | Comment: "PEG < 1.0 → undervalued, PEG = 1.0 → fair value, PEG > 1.0 → overvalued" |

### 2d. DISCOUNTED CASH FLOW VALUATION (rows 56–93)

Header `C56` (merged `C56:G56`): "DISCOUNTED CASH FLOW VALUATION". `C57` note: "in USD millions".

**Inputs (all beige):**

| Row | Field | Cell | Format | Source |
|---|---|---|---|---|
| 58 | Free Cash Flow (FCF) | `D58` | `#,##0.00 "millions"` | stockanalysis.com Financials (current/latest FCF, USD millions) |
| 59 | Past 5Y (or 10Y in GOOGL's case — label varies by tab) Free Cash Flow CAGR | `D59` | `0.00%` | Reference only — student calculates via external CAGR calculator, this cell is informational and **not used in any downstream formula** (dead input in terms of the DCF math — it just documents the basis for the growth-rate assumptions below) |
| 61 | FCF Growth Rate in Yrs 1–5 | `D61` | `0.00%` | Manual forecast, "based on above FCF CAGR" |
| 62 | FCF Growth Rate in Yrs 6–10 | `D62` | `0.00%` | Manual forecast — should be lower than Yrs 1-5 growth |
| 63 | Terminal FCF Growth Rate % (After Y10) | `D63` | `0.00%` | Assumption, "typically 2–4% (inflation)" |
| 65 | Outstanding Shares (Diluted) | `D65` | millions | stockanalysis.com Statistics |
| 66 | Cash & Short-Term Investments | `D66` | millions | stockanalysis.com Balance Sheet |
| 67 | Total Debt + Leases | `D67` | millions | stockanalysis.com Balance Sheet — comment: "Sum up all Debts and Leases ONLY". In all 3 examples this is entered as an **explicit addition formula** summing individual debt/lease line items, e.g. GOOGL `=1996+3650+46547+14803`, META `=2213+58744+22940`, MSFT `=4837+35425+17345` — i.e. the student manually pulls each debt/lease line from the balance sheet and sums them in-cell. |
| 69 | Risk Free Rate | `D69` | `0.00%` | "Ref. from 10Y Treasury Rate" — linked to marketwatch.com 10Y treasury |
| 70 | Implied Market Risk Premium (IMRP) / "Average Market Risk Premium" | `D70` | `0.00%` | Linked to market-risk-premia.com/us.html |
| 71 | Beta | `D71` | decimal | stockanalysis.com Overview |

**Computed:**

```
Discount Rate           D72 = (Beta × Market_Risk_Premium) + Risk_Free_Rate
                             = D71*D70 + D69
```
(Comment on `C72`: "Discount Rate = (Beta x Market Risk Premium) + Risk Free Rate" — this is CAPM.)

**Projected FCF table (rows 79–93), columns C:G = Year / FCF / Growth Rate / Discount Factor / Present FCF Value:**

| Year row | Year (C) | FCF (D) | Growth rate used (E) | Discount factor (F) | Present Value (G) |
|---|---|---|---|---|---|
| 81 | 0 | `D81=D58` (base year FCF, unchanged) | `E81=$D$61` | `F81=1` (no discount) | `G81=F81*D81` |
| 82 | 1 | `D82=D81*(1+E82)` | `E82=$D$61` | `F82=1/(1+D72)` | `G82=F82*D82` |
| 83 | 2 | `D83=D82*(1+E83)` | `E83=$D$61` | `F83=F82/(1+$D$72)` | `G83=F83*D83` |
| 84 | 3 | `D84=D83*(1+E84)` | `E84=$D$61` | `F84=F83/(1+$D$72)` | `G84=F84*D84` |
| 85 | 4 | `D85=D84*(1+E85)` | `E85=$D$61` | `F85=F84/(1+$D$72)` | `G85=F85*D85` |
| 86 | 5 | `D86=D85*(1+E86)` | `E86=$D$61` | `F86=F85/(1+$D$72)` | `G86=F86*D86` |
| 87 | 6 | `D87=D86*(1+E87)` | `E87=$D$62` (switches to Yrs 6-10 rate) | `F87=F86/(1+$D$72)` | `G87=F87*D87` |
| 88 | 7 | `D88=D87*(1+E88)` | `E88=$D$62` | `F88=F87/(1+$D$72)` | `G88=F88*D88` |
| 89 | 8 | `D89=D88*(1+E89)` | `E89=$D$62` | `F89=F88/(1+$D$72)` | `G89=F89*D89` |
| 90 | 9 | `D90=D89*(1+E90)` | `E90=$D$62` | `F90=F89/(1+$D$72)` | `G90=F90*D90` |
| 91 | 10 | `D91=D90*(1+E91)` | `E91=$D$62` | `F91=F90/(1+$D$72)` | `G91=F91*D91` |
| 92 | Terminal Value | `D92=(D91*(1+D63))/(D72-D63)` (Gordon Growth on Year-10 FCF) | `E92=D63` | `F92=F91/(1+$D$72)` | `G92=D92*F92` |
| 93 | — | — | — | — | `G93 = SUM(G82:G92)` |

**Important — Year 0 is deliberately excluded from the sum.** `G93` sums `G82:G92`, not `G81:G92`. Year 0's present value (`G81`, equal to the un-grown, undiscounted base FCF) is a display/reference row only — it is not part of the DCF total. This is correct DCF practice (Year 0 FCF is "today," not a future cash flow to be discounted and added), not a bug — but it's easy to mis-port if you're translating the table mechanically, so call it out explicitly in the app's DCF engine.

**Final valuation:**
```
Projected Intrinsic Value (inc. Net Debt)   D74 = G93 - (D67 - D66)      // PV of FCFs - Net Debt (Net Debt = Total Debt - Cash)
Intrinsic Value per share                    D76 = D74 / D65              // ÷ diluted shares outstanding
Margin of Safety                             D77 = (D76 - $D$7) / $D$7    // (Intrinsic - Share Price) / Share Price
```
(Comment on `C77`: "(Intrinsic Value - Share Price) / Intrinsic Value" — **note this comment text disagrees with the actual formula**, which divides by share price `$D$7`, not by intrinsic value `D76`. The formula is the ground truth to replicate; the comment is stale/wrong. Positive margin of safety = undervalued (intrinsic > price); negative = overvalued.)

Pseudocode for the whole DCF:
```
discount_rate = beta * market_risk_premium + risk_free_rate

fcf[0] = base_fcf
for year in 1..5: fcf[year] = fcf[year-1] * (1 + growth_1_5)
for year in 6..10: fcf[year] = fcf[year-1] * (1 + growth_6_10)

discount_factor[0] = 1
for year in 1..10: discount_factor[year] = discount_factor[year-1] / (1 + discount_rate)
  // equivalent to discount_factor[year] = 1 / (1+discount_rate)^year

pv_fcf[year] = fcf[year] * discount_factor[year]   for year 0..10

terminal_value = fcf[10] * (1 + terminal_growth) / (discount_rate - terminal_growth)
pv_terminal_value = terminal_value * discount_factor[10]

sum_pv = sum(pv_fcf[1..10]) + pv_terminal_value     // excludes pv_fcf[0]

net_debt = total_debt_and_leases - cash_and_st_investments
intrinsic_value_total = sum_pv - net_debt
intrinsic_value_per_share = intrinsic_value_total / diluted_shares_outstanding
margin_of_safety = (intrinsic_value_per_share - current_share_price) / current_share_price
```

**Guardrail to flag in the web app:** if `discount_rate <= terminal_growth_rate`, the terminal value formula divides by zero or goes negative — the template itself shows `#DIV/0!` when blank. Validate `D72 > D63` before computing.

---

## 3. Definitions tab (full text, verbatim)

### Risks (A1:B5)

| Risk | Definition |
|---|---|
| Science & Tech | Companies with Science & Tech Risks have to spend money on R&D to remain competitive and does not guarantee success. |
| Inferior Net Margin | Net Margin = Net Income / Total Revenue. High Net Margin means that the company is able to either charge a premium, reduce expenses, or both. |
| Authority | Refers to government laws/rules that may affect the company negatively |
| Key Person(s) | Company is very dependant on 1 person or a small group of people. |

### Economic Moat (A7:B12)

| Moat | Definition |
|---|---|
| Intangible assets | Refers to brands, copyright, patents etc that gives the company an advantage over competitors |
| Low cost advantage | Refers to the company's ability to produce goods and services cheaply. Companies with LCA have high Gross Margins. |
| High Switch Cost | Refers to the high cost (time or effort) for a customer to switch to products or services of competitors. |
| Network Effect | Large number of a group of users attract more business, (merchants attract buyers, more buyers attract more merchants) |
| Efficient Scale | Industry is so small that it does not make sense to have so many companies. For eg, defence industry etc |

### F.R.I.E.D.D (A14:B20)

| Term | Definition |
|---|---|
| Free Cash Flow (Trend) | Free Cash Flow = Cash Flow from Operations - Capital Expenditures (CAPEX). Capex refers to one-time expenditures eg, building new factories, buying over a company etc |
| ROE (TTM) | ROE = Net income / Equity, Equity = Assets - Liabilities. More liabilties will cause Low Equity, but high ROE. |
| Int Coverage (TTM) | Refers to the company's ability to pay off interest from debt. Higher the better. |
| EPS (Trend) | EPS = Net income / No. of outstanding shares in the market |
| Dividends (TTM) | Young and/or fast growing companies usually do not give out dividends and use the money to expand instead. |
| DE ratio (TTM) | Compares Debt to Equity. Ratio of 0.5 means for every $1 debt, there is $2 equity. The lower the better. Equity = All Assets - All Liabilities |

### Others (A22:B25)

| Term | Definition |
|---|---|
| Increasing Revenue (Trend) | Revenue refers to the sales ($) of the company |
| Retained earnings (Trend) | Retained earnings refers to the unspent profits accumulated over the years. |
| Share repurchase | If the company have high debt, low cash flow/profits/retained earnings and still do share repurchase, WATCH OUT! |

This tab is pure reference text — no formulas, no inputs. In the web app this becomes static help/tooltip copy attached to each scoring criterion.

---

## 4. Portfolio Plan tab

This tab is **structurally a blank tracking template with no live formulas** — every cell is either a header label or an empty white/beige input cell. Nothing here is formula-driven; allocation % and capital-per-position are meant to be typed in by hand (or, if rebuilt as a web app, computed live rather than copying any sheet formula, since none exists).

**Layout:**

| Cell | Content |
|---|---|
| A1 | "Capital" (label) |
| B1 | Total capital amount — beige/yellow input, format `"$"#,##0` (this is the portfolio's total investable capital) |
| Row 2 (headers) | A2 "No.", B2 "Company Ticker", C2 "Current Price", D2 "FRIEDD SNAKE" (score), E2 "Valuation", F2 "Portfolio Allocation (%)\n[increase with conviction]", G2 "Capital based on Allocation (USD)", H2 "Strategy" |
| Row 3 | "Benchmark" row (cyan-highlighted `A3:H3`) — presumably for tracking an index benchmark alongside individual holdings |
| Rows 4–23 | Numbered 1–20 in column A, blank input cells (white fill) across B–G for up to 20 positions |
| F3, F4, F5 | Percent number formats (`0%`, `0.00%`, `0%`) hint that column F ("Portfolio Allocation %") is meant as a percentage even though no formula enforces it |

**Column meaning (inferred from header text, since there's no formula to confirm mechanically):**
- `D` FRIEDD SNAKE score — presumably the `E42` "TOTAL SCORE (Out of 10)" copied over from that ticker's analysis tab.
- `E` Valuation — presumably a verdict/number pulled from the Step 2 valuation (e.g. Margin of Safety % or "Undervalued/Overvalued").
- `F` Portfolio Allocation (%) — manually set by the student, guided by conviction (higher FRIEDD SNAKE score / better valuation → higher %).
- `G` Capital based on Allocation (USD) — logically `= B$1 (total capital) * F (allocation %)`, but **this formula does not exist in the sheet** — it would need to be added in the web app if you want it live-computed. That's the one reasonable formula to introduce since the header explicitly says "based on Allocation."
- `H` Strategy — free-text field, no constrained values in the workbook (no data validation found on this tab). Likely intended for notes like "DCA weekly," "buy on dip," "hold," etc. — entirely freeform in the source, so treat as a plain text field in the app, not an enum.

No data validation (dropdowns) exist anywhere on this tab.

---

## 5. Cross-checks against EG. GOOGL

Using GOOGL's actual input values to recompute formulas and confirm they match the sheet's cached output.

**Scoring roll-up:**
- FRIEDD: E13=1, E14=2, E15=2, E16=2, E17=1, E18=1 → sum = 9. Sheet shows `E19 = 9` ✓
- Others: E21=1, E22=2, E23=1 → sum = 4. Sheet shows `E24 = 4` ✓
- Risks: E27=-1, E28=0, E29=-1, E30=0 → sum = -2. Sheet shows `E31 = -2` ✓
- Moats: all five = 1 → sum = 5. Sheet shows `E39 = 5` ✓
- Grand Total = -2 + 5 + 9 + 4 = 16. Sheet shows `E40 = 16` ✓
- Total Score = (16/20)*10 = **8.0**. Sheet shows `E42 = 8` ✓ → PASS (≥7) ✓ matches `F42 = "PASS"`

**Valuation models:**
- 5Y Avg PB entry price: D48(32.03) × D50(6.64) = 212.6792 → sheet `E50 = 212.6792` ✓
- Expected dividend entry price: D51(0.84) / 0.05 = 16.8 → sheet `E51 = 16.8` ✓
- 5Y Avg PE entry price: D52(24.9) × D47(10.14) = 252.486 → sheet `E52 = 252.486` ✓
- PEG verdict: D54 = 1.84 > 1 → "Overvalued" ✓ matches `E54`

**DCF chain:**
- Discount Rate: D71(1.09) × D70(0.0237) + D69(0.03974) = 0.025833 + 0.03974 = 0.065573 → sheet `D72 = 0.065573` ✓ (exact match, CAPM formula confirmed)
- Year 1 FCF: D58(73266) × (1+0.10) = 80592.6 → sheet `D82 = 80592.6` ✓
- Year 1 discount factor: 1/(1.065573) = 0.938462 → sheet `F82 = 0.938462217` ✓
- Year 1 PV: 0.938462 × 80592.6 = 75633.1 → sheet `G82 = 75633.11007` ✓
- Terminal Value: D91(157904.7643) × (1.03) / (0.065573 - 0.03) = 162641.907 / 0.035573 = 4,572,062 (matches sheet's `D92 = 4572060.474` within rounding of intermediate decimals — confirms `(D91*(1+D63))/(D72-D63)`)
- Sum of PVs `G93 = 3,099,678.516` (from sheet, sum of G82:G92, excludes G81)
- Net Debt = D67(66996) - D66(126843) = -59,847 (net cash position, not net debt)
- Intrinsic value total: D74 = G93 - (D67-D66) = 3,099,678.516 - (-59,847) = 3,159,525.516 → sheet `D74 = 3159525.516` ✓
- Per share: 3,159,525.516 / 12,230 (diluted shares) = 258.34 → sheet `D76 = 258.3422335` ✓
- Margin of Safety: (258.3422 - 354.3) / 354.3 = -27.08% → sheet `D77 = -0.2708376136` ✓ (GOOGL modeled as overvalued at $354.30 vs $258.34 intrinsic value per this DCF)

All four spot-checks match the sheet's cached computed values exactly (within floating-point rounding), confirming the formula logic above is correctly transcribed.

**Dependencies that don't survive xlsx export:**
- `D6` (Company Name) and `D7` (Share Price) formulas use `GOOGLEFINANCE()`, which Excel/xlsx has no equivalent for. On export these became `__xludf.DUMMYFUNCTION("GOOGLEFINANCE(...)")` placeholder text; the *value* shown is whatever Google Sheets had last cached (e.g. GOOGL price $354.30, as of the sheet's "Updated as of" date `2025-08-01` per `H1`/`G1` on the example tabs — note this is a different, older date than the per-tab "Date Updated" `D4`, e.g. GOOGL's D4 = 2026-02-28, so the cached price may be stale relative to the tab's stated update date). **Web app must replace these with either manual entry fields or a market-data API call** (ticker → company name, ticker → live price).

---

## 6. Old vs. new tab — structural differences only

`FS & DCF v2 (Template)_OLD` shares the identical Step 1 scoring section (F.R.I.E.D.D / Others / SNAKE / Moats — same criteria, same point values, same row layout) but differs in two places:

1. **Score divisor bug (old) vs. fixed (new):** Old `E42 = (E40/18)*10`. New/current template: `E42 = (E40/20)*10`. Since max achievable Grand Total is 20 either way (10+5+5+0 best case), dividing by 18 in the old tab was mathematically wrong — it inflates the /10 score (e.g. a Grand Total of 16 would score 8.89/10 under the old formula vs 8.0/10 under the corrected one). The new template fixes this to the correct /20 divisor.

2. **DCF valuation is a different, more complex model in the old tab:**
   - Uses **Operating Cash Flow (OCF) minus Stock-Based Compensation** as "Real OCF" (`D66 = D64-D65`) as the base cash flow, instead of the new tab's direct **Free Cash Flow** input.
   - **20-year projection** (three growth phases: Yrs 1–5, 6–10, 11–20) instead of the new tab's 10-year projection + terminal value. The old tab has **no terminal value / Gordon Growth step at all** — it just discounts 20 explicit years and sums them (`G104=SUM(G84:G103)`).
   - Also tracks explicit calendar years (`D84=2025`, incrementing) alongside the year-index column, which the new tab drops.
   - Net-debt calculation uses **Total Liabilities** (`D63`) instead of the new tab's **Total Debt + Leases**, i.e. old tab nets against *all* liabilities, new tab nets against debt-like obligations only (a more standard, tighter DCF net-debt treatment).
   - Margin of Safety denominator differs: old `D80 = (D79-$D$7)/D79` (divides by **intrinsic value**), new `D77 = (D76-$D$7)/$D$7` (divides by **share price**) — these give meaningfully different percentages for the same over/undervaluation gap, and the new tab's version is the more conventional "upside relative to current price" framing.
   - Has an extra "EPS Growth %" derived cell (`D50 = D49/D56`, i.e. PE ÷ PEG, algebraically backing out the growth rate the PEG ratio implies) that the new tab removes.
   - Section header explicitly says "(20 Years)" in old tab (`C58`); new tab has no year count in the header since it's implicitly 10 + terminal.

Net effect: the new template is a **simpler, more standard 10-year explicit DCF + terminal value model**, replacing the old **20-year, no-terminal-value, OCF-based model**. When rebuilding, use the new (current template / EG. GOOGL/META/MSFT) version as the source of truth — the old tab should only be preserved for historical reference, not reproduced in the app.

---

## 7. Summary of what a web app needs to replicate

**Two computed engines:**
1. **FRIEDD SNAKE scorer** — 18 discrete criteria (6 FRIEDD + 3 Others + 4 Risks + 5 Moats) each taking a small integer input per its own rule, rolling up to a 0–20 raw total, rescaled to a 0–10 score, with a hard PASS/FAIL cutoff at 7.0.
2. **DCF valuer** — CAPM discount rate, 10-year two-phase FCF projection + Gordon Growth terminal value, net-debt adjustment, per-share intrinsic value, and margin of safety vs. current price. Plus three simple side-by-side "Valuation Model" entry-price estimates (PB, dividend yield, PE) and a PEG-based over/under verdict.

**External data dependencies to replace (no GOOGLEFINANCE equivalent):** company name lookup, live share price. Every other data point (FCF, ROE, EPS, dividends, D/E, revenue, retained earnings, shares outstanding, cash, debt, beta, risk-free rate, market risk premium, PB/PE/PEG ratios) is manually sourced by the student from stockanalysis.com (with specific nav-path hints preserved as tooltips/comments in the sheet) plus a couple of external references (10Y Treasury via MarketWatch, market risk premium via market-risk-premia.com, FCF CAGR via cagrcalculator.net or fiscal.ai) — none of these are pulled automatically even in the Google Sheets version, so a manual-input form is a faithful port, not a downgrade.
