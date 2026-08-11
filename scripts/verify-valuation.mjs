#!/usr/bin/env node
// Reproduces the FRIEDD SNAKE framework spec's worked GOOGL valuation example
// (docs/framework-spec.md §5 "Cross-checks against EG. GOOGL") plus the two
// synthetic acceptance cases from docs/phase3-valuation-spec.md (§6.2 negative
// FCF, §6.3 CAGR) through the real valuation engine (src/lib/valuation.ts)
// and asserts the numbers match exactly (within floating-point rounding).

import {
  computeCagr,
  computeEntryModels,
  computeDcf,
  computeValuationSummary,
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
const googlEntryInputs = {
  pb: { avg_5y_pb: 6.64 },
  dividend: { annual_dividend: 0.84 },
  pe: { avg_5y_pe: 24.9 },
  pocf: { ocf_per_share: undefined, current_pocf: undefined, avg_5y_pocf: undefined },
  peg: { peg_ratio: 1.84 },
};
const googlSharePrice = 354.3;

const googlEntry = computeEntryModels(
  googlEntryInputs,
  googlCompanyFinancials,
  googlSharePrice,
  DEFAULT_VALUATION_CONFIG
);

ok = assertClose(googlEntry.pb.entryPrice, 212.6792, "PB entry price") && ok;
ok = assertClose(googlEntry.dividend.entryPrice, 16.8, "Dividend entry price") && ok;
ok = assertClose(googlEntry.pe.entryPrice, 252.486, "PE entry price") && ok;
ok = assertEqual(googlEntry.pegVerdict, "Overvalued", "PEG verdict") && ok;
ok = assertEqual(googlEntry.pb.signal, "Overvalued", "PB signal (share price way above entry price)") && ok;
ok = assertEqual(googlEntry.dividend.signal, "Overvalued", "Dividend signal") && ok;
ok = assertEqual(googlEntry.pe.signal, "Overvalued", "PE signal") && ok;

const googlDcfInputs = {
  base_fcf: 73266,
  growth_1_5: 0.1,
  growth_6_10: 0.06,
  terminal_growth: 0.03,
  diluted_shares: 12230,
  cash_and_st_investments: 126843,
  total_debt_and_leases: 66996,
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

  ok = assertClose(googlDcf.netDebt, -59847, "Net debt (net cash)") && ok;
  ok = assertClose(googlDcf.intrinsicValueTotal, 3159525.52, "Intrinsic value (total)", 1) && ok;
  ok = assertClose(googlDcf.intrinsicValuePerShare, 258.34, "Intrinsic value per share", 0.01) && ok;
  ok = assertClose(googlDcf.marginOfSafety, -0.2708, "Margin of Safety", 0.0002) && ok;
  ok = assertEqual(googlDcf.signal, "Overvalued", "DCF signal (MoS <= -15%)") && ok;

  const summary = computeValuationSummary(googlDcf, new Date("2026-08-10T09:00:12Z"));
  ok = assertEqual(summary.dcf_available, true, "Summary dcf_available") && ok;
  ok = assertEqual(summary.dcf_signal, "Overvalued", "Summary dcf_signal") && ok;
  ok = assertClose(summary.margin_of_safety, -0.2708, "Summary margin_of_safety", 0.0002) && ok;
}

// ---------------------------------------------------------------------------
// Case 2: synthetic negative-FCF case ("Company X") — DCF disabled, alt
// models + P/OCF compute independently.
// ---------------------------------------------------------------------------
console.log("\n=== Company X — negative FCF, DCF disabled ===");

const companyXSharePrice = 50.0;
const companyXFinancials = { eps: 2.0, book_value_per_share: 20.0 };
const companyXEntryInputs = {
  pb: { avg_5y_pb: 2.5 },
  dividend: { annual_dividend: 1.0 },
  pe: { avg_5y_pe: 15 },
  pocf: { ocf_per_share: 3.0, current_pocf: 16.67, avg_5y_pocf: 10.0 },
  peg: { peg_ratio: 1.5 },
};

const companyXEntry = computeEntryModels(
  companyXEntryInputs,
  companyXFinancials,
  companyXSharePrice,
  DEFAULT_VALUATION_CONFIG
);

ok = assertClose(companyXEntry.pb.entryPrice, 50.0, "Company X PB entry price") && ok;
ok = assertEqual(companyXEntry.pb.signal, "Fair Value", "Company X PB signal") && ok;
ok = assertClose(companyXEntry.pe.entryPrice, 30.0, "Company X PE entry price") && ok;
ok = assertEqual(companyXEntry.pe.signal, "Overvalued", "Company X PE signal") && ok;
ok = assertClose(companyXEntry.dividend.entryPrice, 20.0, "Company X dividend entry price") && ok;
ok = assertEqual(companyXEntry.dividend.signal, "Overvalued", "Company X dividend signal") && ok;
ok = assertClose(companyXEntry.pocf.entryPrice, 30.0, "Company X P/OCF entry price") && ok;
ok = assertEqual(companyXEntry.pocf.signal, "Overvalued", "Company X P/OCF signal (16.67 > 10.00)") && ok;
ok = assertEqual(companyXEntry.pegVerdict, "Overvalued", "Company X PEG verdict") && ok;

const companyXDcfInputs = {
  base_fcf: -200,
  growth_1_5: 0.1,
  growth_6_10: 0.06,
  terminal_growth: 0.03,
  diluted_shares: 100,
  cash_and_st_investments: 10,
  total_debt_and_leases: 10,
  risk_free_rate: 0.04,
  market_risk_premium: 0.05,
  beta: 1,
};
const companyXDcf = computeDcf(companyXDcfInputs, companyXSharePrice, DEFAULT_VALUATION_CONFIG);
ok = assertEqual(companyXDcf.available, false, "Company X DCF availability") && ok;
if (companyXDcf.available === false) {
  ok = assertEqual(companyXDcf.reason, "negative_fcf", "Company X DCF disabled reason") && ok;
}

const companyXSummary = companyXDcf.available
  ? computeValuationSummary(companyXDcf)
  : computeValuationSummary(companyXDcf);
ok = assertEqual(companyXSummary.dcf_available, false, "Company X summary dcf_available") && ok;
ok = assertEqual(companyXSummary.margin_of_safety, null, "Company X summary margin_of_safety") && ok;

// Re-enable check: editing FCF back above 0 should make the DCF available again (live re-enable, no reload).
const companyXDcfFixed = computeDcf(
  { ...companyXDcfInputs, base_fcf: 200 },
  companyXSharePrice,
  DEFAULT_VALUATION_CONFIG
);
ok = assertEqual(companyXDcfFixed.available, true, "Company X DCF re-enables once FCF turns positive") && ok;

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

console.log(ok ? "\nAll assertions passed." : "\nSome assertions FAILED.");
if (!ok) process.exit(1);
