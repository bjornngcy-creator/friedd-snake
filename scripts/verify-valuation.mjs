#!/usr/bin/env node
// Reproduces the FRIEDD SNAKE framework spec's worked GOOGL valuation example
// (docs/framework-spec.md §5 "Cross-checks against EG. GOOGL") plus the two
// synthetic acceptance cases from docs/phase3-valuation-spec.md (§6.2 negative
// FCF, §6.3 CAGR) through the real valuation engine (src/lib/valuation.ts)
// and asserts the numbers match exactly (within floating-point rounding).
//
// Phase 3.1: DCF math is untouched — every DCF/discount-rate/net-debt/
// intrinsic-value assertion below is byte-identical to the Phase 3 golden
// test. What changed is the entry-model input shape (5 yearly values instead
// of one avg-ratio input; P/OCF takes total OCF + diluted shares instead of
// OCF-per-share; debt is 4 fields instead of 1) and the removal of
// `computeValuationSummary` (valuation_summary is deprecated — nothing
// persists it anymore, so there's nothing summary-shaped left to assert).

import {
  computeCagr,
  computeEntryModels,
  computeDcf,
  DEFAULT_VALUATION_CONFIG,
} from "../src/lib/valuation.ts";

function assertClose(actual, expected, label, tolerance = 0.01) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    console.error(`FAIL: ${label} — expected ${expected}, got ${actual} (diff ${diff})`);
    process.exitCode = 1;
    return false;
  }
  console.log(`  ok: ${label} = ${actual} (expected ${expected})`);
  return true;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    console.error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`  ok: ${label} = ${actual}`);
  return true;
}

let ok = true;

// ---------------------------------------------------------------------------
// Case 1: GOOGL — full DCF + entry models
// ---------------------------------------------------------------------------
console.log("=== GOOGL — entry models + DCF ===");

const googlCompanyFinancials = { eps: 10.14, book_value_per_share: 32.03 };
const googlSharePrice = 354.3;
const googlDilutedShares = 12230;

// 5 yearly inputs whose average reproduces the spec's single "avg 5Y ratio"
// figures exactly (all 5 slots = the spec value), so the entry-price
// assertions below stay identical to the Phase 3 golden test.
const googlEntryInputs = {
  pb: { yearly: [6.64, 6.64, 6.64, 6.64, 6.64] },
  dividend: { annual_dividend: 0.84 },
  pe: { yearly: [24.9, 24.9, 24.9, 24.9, 24.9] },
  pocf: { ocf_total: undefined, yearly: [undefined, undefined, undefined, undefined, undefined] },
  peg: { peg_ratio: 1.84 },
};

const googlEntry = computeEntryModels(
  googlEntryInputs,
  googlCompanyFinancials,
  googlSharePrice,
  googlDilutedShares,
  DEFAULT_VALUATION_CONFIG
);

ok = assertClose(googlEntry.pb.avg5y, 6.64, "PB 5Y average") && ok;
ok = assertClose(googlEntry.pb.entryPrice, 212.6792, "PB entry price") && ok;
ok = assertClose(googlEntry.dividend.entryPrice, 16.8, "Dividend entry price") && ok;
ok = assertClose(googlEntry.pe.avg5y, 24.9, "PE 5Y average") && ok;
ok = assertClose(googlEntry.pe.entryPrice, 252.486, "PE entry price") && ok;
ok = assertEqual(googlEntry.pegVerdict, "Overvalued", "PEG verdict") && ok;

// Current P/B = 354.30 / 32.03 = 11.06x > 6.64x avg -> Overvalued.
// Current P/E = 354.30 / 10.14 = 34.94x > 24.9x avg -> Overvalued.
// (Same "Overvalued" outcome as the pre-3.1 entry-price-vs-share-price
// comparison — GOOGL trades well above both its book value and earnings
// multiples either way — but derived from the new current-multiple-vs-5Y-
// average logic per Phase 3.1 item 9.)
ok = assertClose(googlEntry.pb.currentMultiple, 11.0615, "PB current multiple (price / BVPS)", 0.001) && ok;
ok = assertEqual(googlEntry.pb.signal, "Overvalued", "PB signal (current multiple > 5Y avg)") && ok;
ok = assertClose(googlEntry.pe.currentMultiple, 34.9408, "PE current multiple (price / EPS)", 0.001) && ok;
ok = assertEqual(googlEntry.pe.signal, "Overvalued", "PE signal (current multiple > 5Y avg)") && ok;
ok = assertEqual(googlEntry.dividend.signal, "Overvalued", "Dividend signal") && ok;

const googlDcfInputs = {
  base_fcf: 73266,
  growth_1_5: 0.1,
  growth_6_10: 0.06,
  terminal_growth: 0.03,
  diluted_shares: googlDilutedShares,
  cash_and_st_investments: 126843,
  // Phase 3.1: debt is 4 fields, auto-summed — put the spec's single total
  // entirely in long-term debt so the sum (and therefore net debt and every
  // downstream number) is identical to the Phase 3 golden test.
  short_term_debt: undefined,
  long_term_debt: 66996,
  short_term_lease: undefined,
  long_term_lease: undefined,
  risk_free_rate: 0.03974,
  market_risk_premium: 0.0237,
  beta: 1.09,
};

const googlDcf = computeDcf(googlDcfInputs, googlSharePrice, DEFAULT_VALUATION_CONFIG);

if (!googlDcf.available) {
  console.error(`FAIL: GOOGL DCF reported unavailable (${googlDcf.reason}: ${googlDcf.message})`);
  process.exitCode = 1;
  ok = false;
} else {
  ok = assertClose(googlDcf.discountRate, 0.065573, "Discount rate", 0.000001) && ok;

  const year1 = googlDcf.years.find((y) => y.year === 1);
  ok = assertClose(year1.fcf, 80592.6, "Year 1 FCF") && ok;
  ok = assertClose(year1.discountFactor, 0.938462, "Year 1 discount factor", 0.000001) && ok;
  ok = assertClose(year1.presentValue, 75633.11, "Year 1 PV") && ok;

  // Checksum for the full 10-year loop + terminal value.
  ok = assertClose(googlDcf.sumPv, 3099678.52, "Sum of PV (Yr1-10 + terminal)", 1) && ok;

  ok = assertClose(googlDcf.totalDebtAndLeases, 66996, "Total debt + leases (auto-summed from 4 fields)") && ok;
  ok = assertClose(googlDcf.netDebt, -59847, "Net debt (net cash)") && ok;
  ok = assertClose(googlDcf.intrinsicValueTotal, 3159525.52, "Intrinsic value (total)", 1) && ok;
  ok = assertClose(googlDcf.intrinsicValuePerShare, 258.34, "Intrinsic value per share", 0.01) && ok;
  ok = assertClose(googlDcf.marginOfSafety, -0.2708, "Margin of Safety (internal only, never displayed)", 0.0002) && ok;
  ok = assertEqual(googlDcf.signal, "Overvalued", "DCF signal (MoS <= -15%)") && ok;
}

// ---------------------------------------------------------------------------
// Case 2: synthetic negative-FCF case ("Company X") — DCF disabled, alt
// models + P/OCF compute independently.
// ---------------------------------------------------------------------------
console.log("\n=== Company X — negative FCF, DCF disabled ===");

const companyXSharePrice = 50.0;
const companyXDilutedShares = 100;
const companyXFinancials = { eps: 2.0, book_value_per_share: 20.0 };
const companyXEntryInputs = {
  pb: { yearly: [2.5, 2.5, 2.5, 2.5, 2.5] },
  dividend: { annual_dividend: 1.0 },
  pe: { yearly: [15, 15, 15, 15, 15] },
  // ocf_total = ocf_per_share (3.00) * shares (100) = 300, reproducing the
  // Phase 3 golden test's OCF/share of $3.00 once derived back down.
  pocf: { ocf_total: 300, yearly: [10.0, 10.0, 10.0, 10.0, 10.0] },
  peg: { peg_ratio: 1.5 },
};

const companyXEntry = computeEntryModels(
  companyXEntryInputs,
  companyXFinancials,
  companyXSharePrice,
  companyXDilutedShares,
  DEFAULT_VALUATION_CONFIG
);

ok = assertClose(companyXEntry.pb.entryPrice, 50.0, "Company X PB entry price") && ok;
ok = assertClose(companyXEntry.pb.currentMultiple, 2.5, "Company X PB current multiple (50/20)") && ok;
ok = assertEqual(companyXEntry.pb.signal, "Fair Value", "Company X PB signal") && ok;
ok = assertClose(companyXEntry.pe.entryPrice, 30.0, "Company X PE entry price") && ok;
ok = assertClose(companyXEntry.pe.currentMultiple, 25.0, "Company X PE current multiple (50/2)") && ok;
ok = assertEqual(companyXEntry.pe.signal, "Overvalued", "Company X PE signal") && ok;
ok = assertClose(companyXEntry.dividend.entryPrice, 20.0, "Company X dividend entry price") && ok;
ok = assertEqual(companyXEntry.dividend.signal, "Overvalued", "Company X dividend signal") && ok;
ok = assertClose(companyXEntry.ocfPerShare, 3.0, "Company X OCF/share (300 total / 100 shares)") && ok;
ok = assertClose(companyXEntry.pocf.entryPrice, 30.0, "Company X P/OCF entry price") && ok;
ok = assertClose(companyXEntry.pocf.currentMultiple, 16.6667, "Company X P/OCF current multiple (50/3.00)", 0.001) && ok;
ok = assertEqual(companyXEntry.pocf.signal, "Overvalued", "Company X P/OCF signal (16.67 > 10.00)") && ok;
ok = assertEqual(companyXEntry.pegVerdict, "Overvalued", "Company X PEG verdict") && ok;

const companyXDcfInputs = {
  base_fcf: -200,
  growth_1_5: 0.1,
  growth_6_10: 0.06,
  terminal_growth: 0.03,
  diluted_shares: companyXDilutedShares,
  cash_and_st_investments: 10,
  short_term_debt: undefined,
  long_term_debt: 10,
  short_term_lease: undefined,
  long_term_lease: undefined,
  risk_free_rate: 0.04,
  market_risk_premium: 0.05,
  beta: 1,
};
const companyXDcf = computeDcf(companyXDcfInputs, companyXSharePrice, DEFAULT_VALUATION_CONFIG);
ok = assertEqual(companyXDcf.available, false, "Company X DCF availability") && ok;
if (companyXDcf.available === false) {
  ok = assertEqual(companyXDcf.reason, "negative_fcf", "Company X DCF disabled reason") && ok;
}

// Re-enable check: editing FCF back above 0 should make the DCF available again (live re-enable, no reload).
const companyXDcfFixed = computeDcf(
  { ...companyXDcfInputs, base_fcf: 200 },
  companyXSharePrice,
  DEFAULT_VALUATION_CONFIG
);
ok = assertEqual(companyXDcfFixed.available, true, "Company X DCF re-enables once FCF turns positive") && ok;
if (companyXDcfFixed.available) {
  ok = assertClose(companyXDcfFixed.totalDebtAndLeases, 10, "Company X total debt (auto-summed)") && ok;
}

// ---------------------------------------------------------------------------
// Case 3: CAGR helper
// ---------------------------------------------------------------------------
console.log("\n=== CAGR helper ===");

const cagrResult = computeCagr({ fcf_first: 100, fcf_last: 200, years: 5 });
if (!cagrResult.ok) {
  console.error("FAIL: CAGR should have computed for fcf_first=100, fcf_last=200, years=5");
  process.exitCode = 1;
  ok = false;
} else {
  ok = assertClose(cagrResult.cagr, 0.148698, "CAGR (100 -> 200 over 5y)", 0.000005) && ok;
}

const cagrEdgeCase = computeCagr({ fcf_first: -50, fcf_last: 200, years: 5 });
ok = assertEqual(cagrEdgeCase.ok, false, "CAGR edge case (negative starting FCF) reports not-ok") && ok;
if (!cagrEdgeCase.ok) {
  console.log(`  ok: CAGR edge case error = "${cagrEdgeCase.error}"`);
}

// ---------------------------------------------------------------------------
// Case 4: hostile-input guards (Phase 3 QA, still enforced post-3.1). Every
// case below was reproducible in the live UI before these guards existed —
// the student saw "CAGR: NaN%", "$NaN", "Infinity%", or a claim about the
// company's cash flow that nobody had entered.
// ---------------------------------------------------------------------------
console.log("\n=== Guards: nothing non-finite reaches the student ===");

// 4a. CAGR from positive to negative FCF: (negative ratio)^(1/years) = NaN.
const cagrFlip = computeCagr({ fcf_first: 1000, fcf_last: -500, years: 5 });
ok = assertEqual(cagrFlip.ok, false, "CAGR positive -> negative FCF reports not-ok (was NaN%)") && ok;

// 4b. An empty base FCF is "not filled in yet", never "this company has negative FCF".
const dcfEmptyFcf = computeDcf(
  { ...companyXDcfInputs, base_fcf: undefined },
  companyXSharePrice,
  DEFAULT_VALUATION_CONFIG
);
ok = assertEqual(dcfEmptyFcf.available, false, "Empty base FCF -> DCF unavailable") && ok;
if (dcfEmptyFcf.available === false) {
  ok =
    assertEqual(
      dcfEmptyFcf.reason,
      "missing_fcf",
      "Empty base FCF reason is missing_fcf, not negative_fcf"
    ) && ok;
}

// 4c. Overflow and degenerate discount rates must return a message, not a number.
const hostileDcfCases = [
  ["growth rate 1e300", { growth_1_5: 1e300, growth_6_10: 1e300 }],
  ["share count 1e-320", { diluted_shares: 1e-320 }],
  ["debt/cash at the float ceiling", { long_term_debt: 1e308, cash_and_st_investments: -1e308 }],
  ["discount rate exactly -100%", { risk_free_rate: -1, beta: 0, market_risk_premium: 0, terminal_growth: -1.5 }],
];
for (const [label, patch] of hostileDcfCases) {
  const result = computeDcf({ ...googlDcfInputs, ...patch }, googlSharePrice, DEFAULT_VALUATION_CONFIG);
  if (result.available) {
    const clean = [result.sumPv, result.intrinsicValuePerShare, result.marginOfSafety].every((n) =>
      Number.isFinite(n)
    );
    ok = assertEqual(clean, true, `DCF stays finite: ${label}`) && ok;
  } else {
    console.log(`  ok: DCF refuses "${label}" -> ${result.reason}`);
  }
}

// 4d. A zero share price must not produce a confident entry-model badge.
const zeroPriceModels = computeEntryModels(
  googlEntryInputs,
  googlCompanyFinancials,
  0,
  googlDilutedShares,
  DEFAULT_VALUATION_CONFIG
);
ok = assertEqual(zeroPriceModels.pb.signal, null, "Share price 0 -> PB signal null, not Undervalued") && ok;
ok = assertEqual(zeroPriceModels.pe.signal, null, "Share price 0 -> PE signal null") && ok;

// 4e. Phase 3.1: a partial 5Y-average (fewer than 5 yearly values) must not
// produce a confident average/signal — it's "not yet computed", not a
// silently-wrong average of 3 numbers.
const partialYearlyModels = computeEntryModels(
  { ...googlEntryInputs, pb: { yearly: [6.64, 6.64, undefined, undefined, undefined] } },
  googlCompanyFinancials,
  googlSharePrice,
  googlDilutedShares,
  DEFAULT_VALUATION_CONFIG
);
ok = assertEqual(partialYearlyModels.pb.avg5y, null, "Partial 5Y average (3 blanks) -> null, not a partial average") && ok;
ok = assertEqual(partialYearlyModels.pb.signal, null, "Partial 5Y average -> PB signal null") && ok;

console.log(ok ? "\nAll assertions passed." : "\nSome assertions FAILED.");
if (!ok) process.exit(1);
