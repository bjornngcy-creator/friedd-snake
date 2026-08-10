# BPC Stock Evaluator — Phase 3 Build Spec: Valuation Module

Source of truth for the sheet's mechanics: `friedd-snake-framework-spec.md` (same scratchpad folder). This spec extends that document into a buildable Phase 3 feature — the valuation page that hangs off a FRIEDD SNAKE evaluation (Phase 2, in progress).

Owner-locked requirements (from Bjorn, restated for traceability):
1. Every valuation input autosaves with the evaluation record, same as the scoring form.
2. Negative FCF disables the DCF panel with a clear explanation; students fall back to the alternative models.
3. Add a Price/Operating-Cash-Flow (P/OCF) model alongside PB, dividend yield, PE — current vs 5-year average, computed comparison + implied entry price.
4. CAGR helper (first FCF, last FCF, years → CAGR %) precedes manual growth-rate entry, purely to seed thinking.
5. Pedagogy: students source and key in every underlying number themselves. The app only does derived math and auto-fills share price/company name (already wired in Phase 2 via Finnhub). No other auto-fetched fundamentals.

---

## 1. Formulas

### 1.1 CAPM discount rate

```
discount_rate = (beta × market_risk_premium) + risk_free_rate
```
Inputs: `beta` (decimal, stockanalysis.com Overview), `market_risk_premium` (%, market-risk-premia.com/us.html), `risk_free_rate` (%, 10Y Treasury via MarketWatch). Lifted verbatim from sheet `D72 = D71*D70 + D69`.

### 1.2 CAGR helper (new — owner requirement 4)

```
cagr = (fcf_last / fcf_first) ^ (1 / years) - 1
```
- Runs the moment all three inputs (`fcf_first`, `fcf_last`, `years`) are present.
- **Edge case:** if `fcf_first <= 0`, the exponentiation is undefined/meaningless (a negative or zero base can't be raised to a fractional power in a way that means "growth rate"). Display "Can't compute CAGR — starting FCF must be positive" instead of a number. Do not block the rest of the form; this helper is purely informational.
- **Not wired into any other formula.** Matches the sheet's own `D59` (5Y FCF CAGR) which is documented as "informational only, not used in any downstream formula." The student reads the CAGR, then manually types their own Yrs 1-5 / Yrs 6-10 growth assumptions below — the helper seeds judgment, it doesn't set the number.

### 1.3 Entry-price models (side by side, no blended average — sheet explicitly does not combine them)

**PB model** (unchanged from sheet):
```
pb_entry_price = book_value_per_share × avg_5y_pb
```

**Dividend yield model** (unchanged from sheet):
```
dividend_entry_price = annual_dividend / 0.05
```
The `0.05` is a hardcoded assumption in the sheet (comment: "assume 5% base"), not a cell. Recommendation: lift it into framework config (`valuation_config.dividend_yield_assumption`, default `0.05`) so a Phase 5 admin can tune it without a code change — see §5. Keep the displayed default at 5% unless the owner says otherwise.

**PE model** (unchanged from sheet):
```
pe_entry_price = eps × avg_5y_pe
```

**P/OCF model — NEW (owner requirement 3).** Same shape as the PE model (avg multiple × per-share fundamental), plus a current-vs-average comparison the sheet doesn't do for PB/PE:
```
pocf_entry_price = ocf_per_share × avg_5y_pocf

pocf_signal =
  "Undervalued" if current_pocf < avg_5y_pocf
  "Fair Value"  if current_pocf == avg_5y_pocf
  "Overvalued"  if current_pocf > avg_5y_pocf
```
Three raw inputs, all student-sourced from stockanalysis.com Statistics/Ratios page (which publishes P/OCF directly — no need to derive it from price ÷ OCF-per-share, keeping it consistent with the "student finds the number" rule): `ocf_per_share` (current), `current_pocf` (current P/OCF ratio), `avg_5y_pocf` (5-year average P/OCF ratio). The `pocf_signal` logic mirrors the sheet's own PEG `IF/IF` pattern (`E54`) — same three-way verdict shape, just built from current-vs-average instead of ratio-vs-1.

**PEG verdict** (unchanged from sheet):
```
peg_verdict =
  "Undervalued" if peg_ratio < 1
  "Fair Value"  if peg_ratio == 1
  "Overvalued"  if peg_ratio > 1
```

### 1.4 DCF chain (10-year, two-phase growth, Gordon Growth terminal value)

Verbatim from the framework spec §2d, all in USD millions until the final per-share step.

```
discount_rate = beta × market_risk_premium + risk_free_rate     // §1.1 above

fcf[0] = base_fcf                                                 // current/latest FCF, student input
for year in 1..5:  fcf[year] = fcf[year-1] * (1 + growth_1_5)
for year in 6..10: fcf[year] = fcf[year-1] * (1 + growth_6_10)

discount_factor[0] = 1
for year in 1..10: discount_factor[year] = discount_factor[year-1] / (1 + discount_rate)
  // equivalent to 1 / (1+discount_rate)^year

pv_fcf[year] = fcf[year] * discount_factor[year]                  // year 0..10, year 0 shown but NOT summed

terminal_value = fcf[10] * (1 + terminal_growth) / (discount_rate - terminal_growth)
pv_terminal_value = terminal_value * discount_factor[10]

sum_pv = sum(pv_fcf[1..10]) + pv_terminal_value                   // excludes pv_fcf[0] — see note below

net_debt = total_debt_and_leases - cash_and_st_investments
intrinsic_value_total = sum_pv - net_debt
intrinsic_value_per_share = intrinsic_value_total / diluted_shares_outstanding
margin_of_safety = (intrinsic_value_per_share - current_share_price) / current_share_price
```

**Deliberate quirk to preserve, not "fix":** Year 0's present value (`pv_fcf[0]`, the undiscounted base FCF) is displayed as a reference row but excluded from `sum_pv`. This is correct DCF practice — Year 0 is "today," not a future cash flow — but is easy to accidentally include if you sum the array mechanically. Build the sum as `pv_fcf[1..10] + pv_terminal_value`, never `pv_fcf[0..10]`.

**Margin of Safety — formula vs. comment disagreement, resolved.** The sheet's cell comment says "(Intrinsic Value - Share Price) / Intrinsic Value" but the actual formula divides by **share price**: `(D76-$D$7)/$D$7`. Verified against the GOOGL cross-check in the source spec (§5 there) — dividing by share price reproduces the cached `-27.08%` exactly; dividing by intrinsic value would not. **Reproduce the formula, ignore the comment.** Positive = undervalued (intrinsic > price), negative = overvalued.

**Guardrail (from source spec, carry forward):** if `discount_rate <= terminal_growth`, the terminal value formula divides by zero or flips negative. Validate `discount_rate > terminal_growth` before computing the DCF; if it fails, show an inline error on the terminal growth field ("terminal growth rate must be lower than the discount rate of X.XX%") rather than rendering `Infinity`/`NaN`.

### 1.5 Score inputs feeding this page

None. Phase 3 is self-contained — it does not read the FRIEDD SNAKE score to gate or alter valuation math. (The dashboard summary in §4 links the two pages, but the formulas don't cross-reference.)

### 1.6 Ambiguities flagged and resolved

| Ambiguity | Resolution |
|---|---|
| MoS formula vs. comment disagree | Use the formula (÷ share price). Documented above. |
| Dividend model's 5% assumption is hardcoded in-formula, not a cell | Move to framework config, default 5%, keep editable only by admin (Phase 5), not by students. |
| PB/PE models compare only "average" multiple to derive an entry price; no "current vs average" comparison exists for them | Left as-is — sheet doesn't do this for PB/PE and owner didn't ask for it there. Only P/OCF gets the current-vs-average treatment, per explicit requirement 3. Don't over-generalize this pattern back onto PB/PE. |
| FCF CAGR field (`D59` in sheet) location/purpose was ambiguous — decorative or functional? | Confirmed dead/informational in source spec. Rebuilt as the standalone CAGR helper (§1.2), still not wired into any downstream calculation — matches original intent, just made interactive instead of a static labeled cell. |
| Whether P/OCF's `ocf_per_share` should be computed (price ÷ current_pocf) rather than a third raw input | Kept as a raw input to satisfy pedagogy rule 5 — students already look up EPS and BVPS as raw per-share figures for the PE/PB models; OCF-per-share should follow the same convention rather than being silently derived, which would break the "app never sources data" rule. |

---

## 2. Input inventory

Beige-cell philosophy carried forward: every field below is either a **student input** (visually flagged, e.g. light tan background, matches Phase 2's beige-cell treatment) or a **computed/display** field (read-only, distinct styling). No computed field is ever editable.

### 2.1 Student inputs

| Field | Where used | Source (link shown in-app) | Validation |
|---|---|---|---|
| EPS | PE entry model | stockanalysis.com → Financials → Income Statement (EPS) | numeric, any sign (rare negative EPS possible) |
| Book Value Per Share | PB entry model | stockanalysis.com → Balance Sheet | numeric, typically > 0; warn if ≤ 0 |
| 5Y Average PB ratio | PB entry model | stockanalysis.com → Statistics | numeric, typically 0–50; warn outside range |
| Annual Dividend ($/share) | Dividend entry model | stockanalysis.com → Overview → Dividends | numeric ≥ 0 |
| 5Y Average PE ratio | PE entry model | stockanalysis.com → Statistics | numeric; warn if negative (implies negative earnings history) |
| OCF per Share (current) | P/OCF entry model | stockanalysis.com → Statistics/Ratios | numeric, any sign |
| Current P/OCF ratio | P/OCF entry model | stockanalysis.com → Statistics/Ratios | numeric; warn if negative (implies negative OCF) |
| 5Y Average P/OCF ratio | P/OCF entry model | stockanalysis.com → Statistics/Ratios | numeric |
| PEG Ratio | PEG verdict | stockanalysis.com → Statistics | numeric; warn if negative (not meaningful) |
| FCF (first year) | CAGR helper | student's own multi-year FCF lookup, stockanalysis.com → Financials → Cash Flow | numeric; must be > 0 for CAGR to compute |
| FCF (last year) | CAGR helper | same | numeric, any sign |
| Number of years | CAGR helper | student-determined (e.g. 5 or 10) | integer, 1–20 |
| Free Cash Flow (base/current, $M) | DCF | stockanalysis.com → Financials → Cash Flow Statement | numeric, any sign — **negative triggers the DCF-disable state, §3** |
| FCF Growth Rate Yrs 1-5 | DCF | manual forecast, informed by CAGR helper | numeric %, typically -20% to +40%; soft warning outside range |
| FCF Growth Rate Yrs 6-10 | DCF | manual forecast | numeric %; soft warning if ≥ Yrs 1-5 rate (should normally decay) |
| Terminal FCF Growth Rate (after Yr 10) | DCF | assumption, sheet guidance "typically 2-4%" | numeric %, hard validation: must be < discount rate (§1.4 guardrail); soft warning outside 0-5% |
| Outstanding Shares (Diluted, millions) | DCF | stockanalysis.com → Statistics | numeric > 0 |
| Cash & Short-Term Investments ($M) | DCF | stockanalysis.com → Balance Sheet | numeric ≥ 0 |
| Total Debt + Leases ($M) | DCF | stockanalysis.com → Balance Sheet, sum of debt/lease line items manually | numeric ≥ 0 |
| Risk-Free Rate | DCF (CAPM) | MarketWatch 10Y Treasury | numeric %, typically 2-6% |
| Market Risk Premium | DCF (CAPM) | market-risk-premia.com/us.html | numeric %, typically 3-8% |
| Beta | DCF (CAPM) | stockanalysis.com → Overview | numeric, typically 0-3 |

Every source link renders as an in-app hyperlink built the same way the sheet does — string-concatenated with the ticker, e.g. `https://stockanalysis.com/stocks/{TICKER}/financials/cash-flow-statement/`. Reuse the ticker already captured in Phase 2, don't re-ask for it.

### 2.2 Computed / display-only fields

| Field | Formula ref | Display format |
|---|---|---|
| CAGR % | §1.2 | percentage, 2dp, or "N/A" message |
| PB entry price | §1.3 | currency, 2dp |
| Dividend entry price | §1.3 | currency, 2dp |
| PE entry price | §1.3 | currency, 2dp |
| P/OCF entry price | §1.3 | currency, 2dp |
| P/OCF signal | §1.3 | badge: Undervalued / Fair Value / Overvalued |
| PEG verdict | §1.3 | badge: Undervalued / Fair Value / Overvalued |
| Discount rate (CAPM) | §1.1 | percentage, 2dp |
| Projected FCF table (Yr 0-10 + terminal) | §1.4 | table: Year, FCF, Growth Rate, Discount Factor, PV — matches sheet's C:G column layout |
| Sum of PV | §1.4 | currency ($M), matches sheet |
| Net debt | §1.4 | currency ($M); label flips to "Net Cash" when negative (as in the GOOGL case) |
| Intrinsic value (total) | §1.4 | currency ($M) |
| Intrinsic value per share | §1.4 | currency, 2dp |
| Margin of Safety | §1.4 | percentage, 2dp; green if positive, red if negative |
| Overall valuation verdict | §3 | badge, drives dashboard summary |

---

## 3. Negative-FCF behavior

**Trigger condition:** the DCF panel disables when the base/current Free Cash Flow input (§2.1, "Free Cash Flow (base/current, $M)") is **≤ 0**. (Zero is folded into the disable condition too — a $0 starting point produces an all-zero, non-informative DCF, not a genuine "negative" case, but it's equally useless pedagogically, so it's disabled rather than silently rendering a flat-zero table.)

**What happens on trigger:**
- The DCF input section remains visible but visually greyed/locked (don't hide it — the student should see what they'd need if the company turns FCF-positive later).
- A banner replaces the DCF output area:
  > "DCF valuation isn't available for [Company]. This model works by discounting future free cash flow back to today — a company with negative free cash flow doesn't have a meaningful starting point to project from. Use the entry-price models below (PB, Dividend Yield, PE, P/OCF) and the PEG verdict instead to judge whether [Company] looks attractively priced."
- The FCF field itself still autosaves (owner requirement 1) even while disabled, so the student doesn't lose it if the company's FCF later turns positive and they revisit.
- Re-enable automatically, live, the moment the student edits FCF back above 0 — no page reload, no separate "recheck" action.

**Overall verdict when DCF is unavailable:**
Falls back entirely to the four entry-price models + PEG, using the same signal logic each model already produces:

```
for each of {PB, Dividend, PE, P/OCF}:
  diff_pct = (model_entry_price - current_share_price) / current_share_price
  signal = "Undervalued" if diff_pct > 0
           "Overvalued"  if diff_pct < 0
           "Fair Value"  if diff_pct == 0

signals = [PB.signal, Dividend.signal, PE.signal, POCF.signal, PEG.signal]   // 5 signals total

overall_verdict =
  "Undervalued" if count(Undervalued) > count(Overvalued)
  "Overvalued"  if count(Overvalued) > count(Undervalued)
  "Mixed"       if tied
```
This is a **new synthesis the sheet never does** (the source spec is explicit: "No formula combines them"). It's needed here only because DCF — the sheet's one model that *would* have anchored a verdict — is off the table. Majority-vote across 5 signals is my proposed mechanism; flagged as open question §7.

**Overall verdict when DCF is available:** DCF's Margin of Safety becomes the primary signal, banded:
```
overall_verdict =
  "Undervalued" if margin_of_safety >= +15%
  "Overvalued"  if margin_of_safety <= -15%
  "Fair Value"  otherwise
```
The ±15% band is a reasonable default (matches common "margin of safety" convention Bjorn already teaches — buying with room for estimate error) but is my own choice, not sourced from the sheet. Also flagged in §7.

---

## 4. Page / UX structure

**Route:** `/evaluations/[evaluationId]/valuation` — nests under the existing evaluation record from Phase 2 (assumption: Phase 2's scoring page lives at something like `/evaluations/[evaluationId]` or `/evaluations/[evaluationId]/score`; confirm exact route with the Phase 2 builder before wiring the nav link — don't guess a URL that turns out to collide).

**Navigation:**
- From the scoring form: a "Valuation →" tab/button, visible once a score exists (doesn't have to wait for PASS — a FAIL company can still be valued for reference, or to show a student why even a cheap price doesn't fix a bad business).
- From the dashboard: a "Valuation" column per evaluation row showing the verdict badge (Undervalued / Fair Value / Overvalued / Mixed / "DCF N/A — see models"), clickable straight into the valuation page.
- Breadcrumb back to the scoring page and to the dashboard.

**Section order** (top to bottom):
1. **Company financial inputs** (EPS, Book Value/Share) — small, sets up the models below.
2. **CAGR helper** — compact, collapsible/dismissible once used, sits directly above the DCF growth-rate inputs so the causal link ("here's your CAGR, now go set Yr1-5 / Yr6-10 growth") is visually obvious.
3. **DCF inputs** grouped into three visual clusters: Cash Flow & Growth (base FCF, CAGR helper output nearby, growth rates, terminal growth), Balance Sheet (shares, cash, debt), CAPM (risk-free rate, market risk premium, beta).
4. **DCF output** — projected FCF table + intrinsic value + margin of safety, OR the disabled-state banner from §3.
5. **Alternative entry-price models**, side-by-side cards: PB, Dividend Yield, PE, P/OCF. Each card: inputs at top, computed entry price + signal badge at bottom, source link.
6. **PEG verdict** — small standalone card near the alt models.
7. **Overall valuation verdict** — sticky summary card/banner, always visible (e.g. sticky footer or top-of-page summary that updates live), showing the verdict badge plus the one-line reasoning ("Margin of Safety: -27.1%" or "3 of 5 models signal Undervalued").

**Live recalc:** every computed field (§2.2) recalculates client-side on input change/blur — pure arithmetic, no server round-trip needed for the math itself. Debounce ~500ms so typing doesn't recompute on every keystroke.

**Autosave (owner requirement 1):** debounced write to Supabase (~1-2s after last edit, same pattern as Phase 2's scoring autosave — confirm exact debounce/endpoint convention with that build so both forms feel identical). Persist raw inputs only (§5) — computed outputs are cheap to regenerate and don't need to round-trip through the DB on every keystroke.

**Mobile considerations:**
- Alt-model cards stack vertically instead of side-by-side grid.
- Projected FCF table (12 rows × 5 columns) becomes horizontally scrollable within its own container, or collapses to an accordion ("Show year-by-year projection") with just the summary (intrinsic value, MoS) visible by default.
- Sticky verdict banner shrinks to a single-line badge + tap-to-expand.

**Visual language:** light background, deep-green accent for positive/undervalued signals (consistent brand green), red/amber for overvalued, matches the existing app's clean aesthetic — no new component patterns, reuse whatever card/badge/input components Phase 2 already established for the scoring form.

---

## 5. Data model

Assumes Phase 2 already has an `evaluations` table (one row per student × company evaluation) with FRIEDD SNAKE scores in some `scores`/`score_inputs` jsonb column plus a `framework_version` reference. **Confirm actual Phase 2 column names before implementing** — the shape below is a proposal, not a guarantee of what Phase 2 landed on.

### 5.1 `evaluations` table additions

```sql
alter table evaluations
  add column valuation_inputs jsonb not null default '{}'::jsonb,
  add column valuation_summary jsonb;  -- denormalized, cheap dashboard read
```

Single jsonb column for raw inputs (source of truth), not a separate table — this is a 1:1 relationship with the evaluation row, same cardinality as the scoring inputs, no reason to split it out relationally.

**`valuation_inputs` shape:**
```json
{
  "company_financials": {
    "eps": 10.14,
    "book_value_per_share": 32.03
  },
  "cagr_helper": {
    "fcf_first": 100,
    "fcf_last": 200,
    "years": 5
  },
  "entry_models": {
    "pb": { "avg_5y_pb": 6.64 },
    "dividend": { "annual_dividend": 0.84 },
    "pe": { "avg_5y_pe": 24.9 },
    "pocf": { "ocf_per_share": 3.0, "current_pocf": 16.67, "avg_5y_pocf": 10.0 },
    "peg": { "peg_ratio": 1.84 }
  },
  "dcf": {
    "base_fcf": 73266,
    "growth_1_5": 0.10,
    "growth_6_10": 0.06,
    "terminal_growth": 0.03,
    "diluted_shares": 12230,
    "cash_and_st_investments": 126843,
    "total_debt_and_leases": 66996,
    "risk_free_rate": 0.03974,
    "market_risk_premium": 0.0237,
    "beta": 1.09
  },
  "last_edited_at": "2026-08-10T09:00:00Z"
}
```
(Values above are the GOOGL cross-check numbers from the source spec, shown as a worked example of the shape — not a schema requirement.)

**`valuation_summary` shape** (denormalized, recomputed and overwritten on every autosave — purely so the dashboard list view doesn't have to re-run the full DCF for every row):
```json
{
  "dcf_available": true,
  "margin_of_safety": -0.2708,
  "overall_verdict": "Overvalued",
  "updated_at": "2026-08-10T09:00:12Z"
}
```

**No separate outputs table/column for the full computed DCF table.** The projected FCF table, entry prices, etc. are cheap pure-function output of `valuation_inputs` — recompute on page load rather than persisting a second copy that can drift out of sync with the inputs.

### 5.2 Framework versioning

Valuation assumptions that a Phase 5 admin should be able to tune belong in the same framework-definition JSON that (presumably) already holds the FRIEDD SNAKE scoring criteria/weights — not hardcoded in the Phase 3 frontend. Proposed addition to that definition:

```json
{
  "valuation_config": {
    "dividend_yield_assumption": 0.05,
    "terminal_growth_guidance": { "min": 0.02, "max": 0.04 },
    "margin_of_safety_bands": { "undervalued": 0.15, "overvalued": -0.15 },
    "source_links": {
      "fcf": "financials/cash-flow-statement/",
      "roe": "financials/ratios/",
      "book_value": "financials/balance-sheet/",
      "pocf_stats": "statistics/"
    }
  }
}
```
Each evaluation stores which `framework_version` it was scored under (already true for Phase 2); the valuation page should read `valuation_config` from that same versioned definition, so historical evaluations keep computing against the assumptions that were live when the student did the work, even if the owner later tweaks the dividend-yield default or MoS bands.

---

## 6. Verification plan

### 6.1 GOOGL — full DCF + entry models (recompute from spec formulas)

Inputs (from source spec §5 cross-check, all confirmed against the sheet's cached values):

| Input | Value |
|---|---|
| EPS | 10.14 |
| Book Value/Share | 32.03 |
| Avg 5Y PB | 6.64 |
| Annual Dividend | 0.84 |
| Avg 5Y PE | 24.9 |
| PEG | 1.84 |
| Base FCF | 73,266 ($M) |
| Growth Yrs 1-5 | 10% |
| Growth Yrs 6-10 | assume matches sheet's implied path (see note below) |
| Terminal growth | 3% |
| Diluted shares | 12,230 (M) |
| Cash & ST Investments | 126,843 ($M) |
| Total Debt + Leases | 66,996 ($M) |
| Risk-free rate | 3.974% |
| Market risk premium | 2.37% |
| Beta | 1.09 |
| Current share price | 354.30 |

**Expected outputs (acceptance test values for the Phase 3 builder):**

```
discount_rate            = 1.09 × 0.0237 + 0.03974 = 0.065573        (6.5573%)
pb_entry_price           = 32.03 × 6.64             = 212.6792
dividend_entry_price     = 0.84 / 0.05               = 16.80
pe_entry_price            = 24.9 × 10.14             = 252.486
peg_verdict               = "Overvalued"              (1.84 > 1)

Year 1 FCF                = 73266 × 1.10             = 80,592.6
Year 1 discount factor    = 1 / 1.065573              = 0.938462
Year 1 PV                 = 80,592.6 × 0.938462       = 75,633.11
Terminal value (Yr 10)    = D91 × 1.03 / (0.065573 - 0.03)  ≈ 4,572,062  (Yr10 FCF per sheet cache = 157,904.7643)
Sum of PV (Yr1-10 + TV)   = 3,099,678.52
Net debt                  = 66,996 - 126,843          = -59,847         (net CASH position)
Intrinsic value (total)   = 3,099,678.52 - (-59,847)  = 3,159,525.52
Intrinsic value/share     = 3,159,525.52 / 12,230      = 258.34
Margin of Safety          = (258.34 - 354.30) / 354.30 = -27.08%
Overall verdict           = "Overvalued"  (MoS ≤ -15% band, §3)
```

**Note on Growth Yrs 6-10:** the source spec's cross-check section doesn't list the Yrs 6-10 rate explicitly (it validates Year 1 and the terminal value/final numbers, which are enough to confirm the chain works end-to-end, but the builder should re-derive Yrs 2-10 year-by-year using the same compounding pattern in §1.4 and confirm the running total lands on the sheet's cached `G93 = 3,099,678.516` before shipping — treat that number as the checksum for the full 10-year loop, not just the endpoints shown above).

### 6.2 Synthetic negative-FCF case (Company X) — DCF disabled, alt models + P/OCF drive verdict

```
Share price:              $50.00
Base FCF:                 -200 ($M)   → DCF DISABLED (FCF ≤ 0)
Book Value/Share:         $20.00,  Avg 5Y PB: 2.5   → pb_entry_price = 50.00
EPS:                      $2.00,   Avg 5Y PE: 15    → pe_entry_price = 30.00
Annual Dividend:          $1.00                      → dividend_entry_price = 20.00
OCF/Share:                $3.00
Current P/OCF:            16.67
Avg 5Y P/OCF:              10.00                      → pocf_entry_price = 30.00, pocf_signal = "Overvalued" (16.67 > 10.00)
PEG:                       1.5                         → peg_verdict = "Overvalued"
```

Signal tally vs. $50 share price:
```
PB:       diff% = (50.00 - 50.00)/50.00 =   0.0%  → "Fair Value"
Dividend: diff% = (20.00 - 50.00)/50.00 = -60.0%  → "Overvalued"
PE:       diff% = (30.00 - 50.00)/50.00 = -40.0%  → "Overvalued"
P/OCF:    diff% = (30.00 - 50.00)/50.00 = -40.0%  → "Overvalued"
PEG:                                                "Overvalued"
```
Tally: 4 Overvalued, 1 Fair Value, 0 Undervalued → **overall_verdict = "Overvalued"**. DCF panel shows the disabled banner from §3.

### 6.3 CAGR helper — standalone check

```
fcf_first = 100, fcf_last = 200, years = 5
cagr = (200/100)^(1/5) - 1 = 2^0.2 - 1 ≈ 1.148698 - 1 = 0.148698   → 14.87%
```
Edge case: `fcf_first = -50, fcf_last = 200, years = 5` → display "Can't compute CAGR — starting FCF must be positive", no numeric output, no crash.

---

## 7. Open questions for the owner

1. **Overall-verdict mechanism is new — the sheet never combines models.** I've proposed: majority-vote across 5 signals (PB/Dividend/PE/P-OCF/PEG) when DCF is off, and a ±15% Margin-of-Safety band when DCF is on. Is this the right shape, or would you rather the app just display each model's individual signal and leave "overall" entirely to the student's judgment (closer to how the sheet itself stays hands-off)?
2. **Does PEG count as a full voting signal in the majority vote**, same weight as the four entry-price models, or should it stay purely informational (as it effectively is in the sheet — shown, never combined with anything)?
3. **Dashboard "Valuation" column** — single verdict badge (Undervalued/Overvalued/Fair Value/Mixed/DCF N/A), the raw Margin of Safety %, or both? And should it be sortable/filterable the way the FRIEDD SNAKE score column presumably is?

---

**Patience builds wealth, Bjorn**
