// Phase 3 valuation engine — the ONE shared module that computes every
// valuation number. Pure functions, no side effects, importable by the
// client component (live recalc on every input change) and the server
// action (recomputes server-side before persisting, never trusts a
// client-sent summary — same philosophy as src/lib/scoring.ts).
//
// Source of truth: docs/framework-spec.md §2 "STEP 2: VALUATIONS" (sheet
// formulas) and docs/phase3-valuation-spec.md (buildable spec). Verified
// against the frameworks-spec's worked GOOGL example in
// scripts/verify-valuation.mjs: discount rate 6.5573%, PB entry $212.68,
// dividend entry $16.80, PE entry $252.49, PEG Overvalued, Year 1 FCF
// $80,592.6M, Year 1 PV $75,633.11M, sum of PV $3,099,678.52M, net debt
// -$59,847M (net cash), intrinsic value/share $258.34, MoS -27.08% ->
// Overvalued DCF signal.
//
// Owner-locked decision: there is no overall/blended valuation verdict
// anywhere in this app. Every model below returns its OWN independent
// signal; nothing combines, votes across, or averages them. PEG is
// informational only (never gates or scores anything).

export type Signal = "Undervalued" | "Fair Value" | "Overvalued";

/**
 * Structurally identical to FrameworkValuationConfig in src/lib/scoring.ts
 * (FrameworkDefinition.valuation_config) — defined locally rather than
 * imported so this module stays free of cross-file imports, same as
 * scoring.ts itself. That's deliberate, not an oversight: both modules need
 * to run standalone under plain Node (no bundler, no tsconfig path-alias
 * resolution) via scripts/verify-scoring.mjs / scripts/verify-valuation.mjs,
 * and TypeScript's structural typing means callers can pass a
 * FrameworkDefinition's valuation_config straight in without a cast.
 */
export type ValuationConfig = {
  dividend_yield_assumption: number;
  terminal_growth_guidance: { min: number; max: number };
  margin_of_safety_bands: { undervalued: number; overvalued: number };
};

/** Fallback used when a framework version predates §valuation_config (older versions won't have it). */
export const DEFAULT_VALUATION_CONFIG: ValuationConfig = {
  dividend_yield_assumption: 0.05,
  terminal_growth_guidance: { min: 0.02, max: 0.04 },
  margin_of_safety_bands: { undervalued: 0.15, overvalued: -0.15 },
};

export function resolveValuationConfig(config: ValuationConfig | null | undefined): ValuationConfig {
  return config ?? DEFAULT_VALUATION_CONFIG;
}

// ---------------------------------------------------------------------------
// Raw input shapes (mirrors valuation_inputs jsonb shape, phase3 spec §5.1)
// ---------------------------------------------------------------------------

export type CompanyFinancialsInputs = {
  eps: number | null | undefined;
  book_value_per_share: number | null | undefined;
};

export type CagrHelperInputs = {
  fcf_first: number | null | undefined;
  fcf_last: number | null | undefined;
  years: number | null | undefined;
};

export type EntryModelInputs = {
  pb: { avg_5y_pb: number | null | undefined };
  dividend: { annual_dividend: number | null | undefined };
  pe: { avg_5y_pe: number | null | undefined };
  pocf: {
    ocf_per_share: number | null | undefined;
    current_pocf: number | null | undefined;
    avg_5y_pocf: number | null | undefined;
  };
  peg: { peg_ratio: number | null | undefined };
};

export type DcfInputs = {
  base_fcf: number | null | undefined;
  growth_1_5: number | null | undefined;
  growth_6_10: number | null | undefined;
  terminal_growth: number | null | undefined;
  diluted_shares: number | null | undefined;
  cash_and_st_investments: number | null | undefined;
  total_debt_and_leases: number | null | undefined;
  risk_free_rate: number | null | undefined;
  market_risk_premium: number | null | undefined;
  beta: number | null | undefined;
};

export type ValuationInputs = {
  company_financials: CompanyFinancialsInputs;
  cagr_helper: CagrHelperInputs;
  entry_models: EntryModelInputs;
  dcf: DcfInputs;
};

export function emptyValuationInputs(): ValuationInputs {
  return {
    company_financials: { eps: undefined, book_value_per_share: undefined },
    cagr_helper: { fcf_first: undefined, fcf_last: undefined, years: undefined },
    entry_models: {
      pb: { avg_5y_pb: undefined },
      dividend: { annual_dividend: undefined },
      pe: { avg_5y_pe: undefined },
      pocf: { ocf_per_share: undefined, current_pocf: undefined, avg_5y_pocf: undefined },
      peg: { peg_ratio: undefined },
    },
    dcf: {
      base_fcf: undefined,
      growth_1_5: undefined,
      growth_6_10: undefined,
      terminal_growth: undefined,
      diluted_shares: undefined,
      cash_and_st_investments: undefined,
      total_debt_and_leases: undefined,
      risk_free_rate: undefined,
      market_risk_premium: undefined,
      beta: undefined,
    },
  };
}

/** Deep-merges a partial/raw inputs object (e.g. from the DB or a client request) onto the empty shape, so missing nested keys never crash a `.foo.bar` access. */
export function normalizeValuationInputs(raw: unknown): ValuationInputs {
  const empty = emptyValuationInputs();
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;

  const cf = (r.company_financials as Partial<CompanyFinancialsInputs>) ?? {};
  const cagr = (r.cagr_helper as Partial<CagrHelperInputs>) ?? {};
  const em = (r.entry_models as Record<string, unknown>) ?? {};
  const dcf = (r.dcf as Partial<DcfInputs>) ?? {};

  const pb = (em.pb as Partial<EntryModelInputs["pb"]>) ?? {};
  const dividend = (em.dividend as Partial<EntryModelInputs["dividend"]>) ?? {};
  const pe = (em.pe as Partial<EntryModelInputs["pe"]>) ?? {};
  const pocf = (em.pocf as Partial<EntryModelInputs["pocf"]>) ?? {};
  const peg = (em.peg as Partial<EntryModelInputs["peg"]>) ?? {};

  return {
    company_financials: {
      eps: numOrUndefined(cf.eps),
      book_value_per_share: numOrUndefined(cf.book_value_per_share),
    },
    cagr_helper: {
      fcf_first: numOrUndefined(cagr.fcf_first),
      fcf_last: numOrUndefined(cagr.fcf_last),
      years: numOrUndefined(cagr.years),
    },
    entry_models: {
      pb: { avg_5y_pb: numOrUndefined(pb.avg_5y_pb) },
      dividend: { annual_dividend: numOrUndefined(dividend.annual_dividend) },
      pe: { avg_5y_pe: numOrUndefined(pe.avg_5y_pe) },
      pocf: {
        ocf_per_share: numOrUndefined(pocf.ocf_per_share),
        current_pocf: numOrUndefined(pocf.current_pocf),
        avg_5y_pocf: numOrUndefined(pocf.avg_5y_pocf),
      },
      peg: { peg_ratio: numOrUndefined(peg.peg_ratio) },
    },
    dcf: {
      base_fcf: numOrUndefined(dcf.base_fcf),
      growth_1_5: numOrUndefined(dcf.growth_1_5),
      growth_6_10: numOrUndefined(dcf.growth_6_10),
      terminal_growth: numOrUndefined(dcf.terminal_growth),
      diluted_shares: numOrUndefined(dcf.diluted_shares),
      cash_and_st_investments: numOrUndefined(dcf.cash_and_st_investments),
      total_debt_and_leases: numOrUndefined(dcf.total_debt_and_leases),
      risk_free_rate: numOrUndefined(dcf.risk_free_rate),
      market_risk_premium: numOrUndefined(dcf.market_risk_premium),
      beta: numOrUndefined(dcf.beta),
    },
  };
}

function numOrUndefined(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// ---------------------------------------------------------------------------
// 1.2 CAGR helper — informational only, never wired into the DCF math.
// ---------------------------------------------------------------------------

export type CagrResult =
  | { ok: true; cagr: number }
  | { ok: false; error: string };

export function computeCagr(inputs: CagrHelperInputs): CagrResult {
  const { fcf_first, fcf_last, years } = inputs;
  if (!isNum(fcf_first) || !isNum(fcf_last) || !isNum(years) || years <= 0) {
    return { ok: false, error: "Enter first-year FCF, last-year FCF, and number of years." };
  }
  if (fcf_first <= 0) {
    return { ok: false, error: "Can't compute CAGR — starting FCF must be positive." };
  }
  // The ending value has to be positive too. A positive start and a negative
  // end makes the ratio negative, and a negative number raised to a
  // fractional power (1/years) is NaN — which is exactly how "CAGR: NaN%"
  // used to reach the student. This is not a hypothetical: any company whose
  // FCF flipped negative in the final year of the window lands here.
  if (fcf_last <= 0) {
    return {
      ok: false,
      error: "Can't compute CAGR — ending FCF must be positive too. A move from positive to negative FCF has no meaningful growth rate.",
    };
  }
  const cagr = Math.pow(fcf_last / fcf_first, 1 / years) - 1;
  if (!Number.isFinite(cagr)) {
    return { ok: false, error: "Can't compute CAGR from those numbers — check the values you entered." };
  }
  return { ok: true, cagr };
}

// ---------------------------------------------------------------------------
// 1.3 Entry-price models — each returns its own independent signal.
// diff_pct = (entry_price - current_share_price) / current_share_price
// Undervalued if diff_pct > 0, Overvalued if diff_pct < 0, Fair Value if 0.
// (PB/Dividend/PE use this; P/OCF uses its own current-vs-average
// comparison per spec §1.3; PEG uses its own ratio verdict.)
// ---------------------------------------------------------------------------

/**
 * Null (no signal) rather than a made-up verdict when the share price isn't a
 * usable positive number — dividing by 0 yields ±Infinity and 0/0 yields NaN,
 * both of which used to fall through the comparisons below and paint a
 * confident Undervalued/Fair Value badge built on nothing.
 */
function priceDiffSignal(entryPrice: number, sharePrice: number): Signal | null {
  if (!Number.isFinite(entryPrice) || !isNum(sharePrice) || sharePrice <= 0) return null;
  const diffPct = (entryPrice - sharePrice) / sharePrice;
  if (!Number.isFinite(diffPct)) return null;
  if (diffPct > 0) return "Undervalued";
  if (diffPct < 0) return "Overvalued";
  return "Fair Value";
}

export type EntryModelResult = { entryPrice: number | null; signal: Signal | null };

/** Shared exit for every entry-price model: an entry price that overflowed to ±Infinity is not a price, so it's reported as "not computed" rather than rendered as "$Infinity". */
function entryModelResult(entryPrice: number, sharePrice: number | null | undefined): EntryModelResult {
  if (!Number.isFinite(entryPrice)) return { entryPrice: null, signal: null };
  return { entryPrice, signal: priceDiffSignal(entryPrice, sharePrice as number) };
}

export function computePbModel(
  bookValuePerShare: number | null | undefined,
  avg5yPb: number | null | undefined,
  sharePrice: number | null | undefined
): EntryModelResult {
  if (!isNum(bookValuePerShare) || !isNum(avg5yPb)) return { entryPrice: null, signal: null };
  return entryModelResult(bookValuePerShare * avg5yPb, sharePrice);
}

export function computeDividendModel(
  annualDividend: number | null | undefined,
  sharePrice: number | null | undefined,
  dividendYieldAssumption: number
): EntryModelResult {
  if (!isNum(annualDividend) || !dividendYieldAssumption) return { entryPrice: null, signal: null };
  return entryModelResult(annualDividend / dividendYieldAssumption, sharePrice);
}

export function computePeModel(
  eps: number | null | undefined,
  avg5yPe: number | null | undefined,
  sharePrice: number | null | undefined
): EntryModelResult {
  if (!isNum(eps) || !isNum(avg5yPe)) return { entryPrice: null, signal: null };
  return entryModelResult(eps * avg5yPe, sharePrice);
}

/** P/OCF — the one model with a current-vs-5y-average comparison built in, per spec §1.3 (not diff-vs-share-price like the other three). */
export function computePocfModel(
  ocfPerShare: number | null | undefined,
  currentPocf: number | null | undefined,
  avg5yPocf: number | null | undefined
): EntryModelResult {
  if (!isNum(ocfPerShare) || !isNum(avg5yPocf)) return { entryPrice: null, signal: null };
  const rawEntryPrice = ocfPerShare * avg5yPocf;
  const entryPrice = Number.isFinite(rawEntryPrice) ? rawEntryPrice : null;
  let signal: Signal | null = null;
  if (isNum(currentPocf)) {
    if (currentPocf < avg5yPocf) signal = "Undervalued";
    else if (currentPocf > avg5yPocf) signal = "Overvalued";
    else signal = "Fair Value";
  }
  return { entryPrice, signal };
}

/** PEG verdict — informational only (owner-locked). Never combined with anything. */
export function computePegVerdict(pegRatio: number | null | undefined): Signal | null {
  if (!isNum(pegRatio)) return null;
  if (pegRatio < 1) return "Undervalued";
  if (pegRatio > 1) return "Overvalued";
  return "Fair Value";
}

export type EntryModelsResult = {
  pb: EntryModelResult;
  dividend: EntryModelResult;
  pe: EntryModelResult;
  pocf: EntryModelResult;
  pegVerdict: Signal | null;
};

export function computeEntryModels(
  inputs: EntryModelInputs,
  companyFinancials: CompanyFinancialsInputs,
  sharePrice: number | null | undefined,
  config: ValuationConfig
): EntryModelsResult {
  return {
    pb: computePbModel(companyFinancials.book_value_per_share, inputs.pb.avg_5y_pb, sharePrice),
    dividend: computeDividendModel(
      inputs.dividend.annual_dividend,
      sharePrice,
      config.dividend_yield_assumption
    ),
    pe: computePeModel(companyFinancials.eps, inputs.pe.avg_5y_pe, sharePrice),
    pocf: computePocfModel(inputs.pocf.ocf_per_share, inputs.pocf.current_pocf, inputs.pocf.avg_5y_pocf),
    pegVerdict: computePegVerdict(inputs.peg.peg_ratio),
  };
}

// ---------------------------------------------------------------------------
// 1.4 DCF chain — CAPM discount rate, 10-year two-phase FCF projection,
// Gordon Growth terminal value, net-debt adjustment, margin of safety.
// ---------------------------------------------------------------------------

export type DcfYearRow = {
  year: number;
  fcf: number;
  growthRateUsed: number;
  discountFactor: number;
  presentValue: number;
};

export type DcfUnavailable = {
  available: false;
  /**
   * `missing_fcf` (base FCF simply hasn't been entered yet) is deliberately
   * distinct from `negative_fcf` (a real, entered, non-positive number).
   * Collapsing the two made a brand-new, untouched valuation page tell the
   * student "DCF valuation isn't available for Microsoft Corp — a company
   * with negative free cash flow…", a claim about the business that nobody
   * had made and that was usually false.
   */
  reason: "missing_fcf" | "negative_fcf" | "missing_inputs" | "guardrail";
  message: string;
};

export type DcfAvailable = {
  available: true;
  discountRate: number;
  years: DcfYearRow[]; // Year 0..10, inclusive — Year 0 is reference-only, excluded from sumPv.
  terminalValue: number;
  sumPv: number; // sum of Year 1-10 PV + PV of terminal value. Year 0 PV is deliberately excluded.
  netDebt: number; // total_debt_and_leases - cash_and_st_investments. Negative = net cash.
  intrinsicValueTotal: number;
  intrinsicValuePerShare: number;
  marginOfSafety: number; // (intrinsic/share - share price) / share price
  signal: Signal;
};

export type DcfResult = DcfUnavailable | DcfAvailable;

/** True the moment base FCF is a real, positive number — used to drive the panel's disabled/enabled state live, independent of whether every other DCF field is filled in yet. */
export function isDcfEnabled(baseFcf: number | null | undefined): boolean {
  return isNum(baseFcf) && baseFcf > 0;
}

/** True only when base FCF has actually been entered AND is non-positive — i.e. the genuine "this company can't be DCF'd" case, as opposed to "nothing typed yet". */
export function isDcfBlockedByNegativeFcf(baseFcf: number | null | undefined): boolean {
  return isNum(baseFcf) && baseFcf <= 0;
}

export function computeDcf(
  inputs: DcfInputs,
  sharePrice: number | null | undefined,
  config: ValuationConfig
): DcfResult {
  const {
    base_fcf,
    growth_1_5,
    growth_6_10,
    terminal_growth,
    diluted_shares,
    cash_and_st_investments,
    total_debt_and_leases,
    risk_free_rate,
    market_risk_premium,
    beta,
  } = inputs;

  if (!isNum(base_fcf)) {
    return {
      available: false,
      reason: "missing_fcf",
      message: "Enter the base free cash flow above to start the DCF.",
    };
  }

  if (!isDcfEnabled(base_fcf)) {
    return {
      available: false,
      reason: "negative_fcf",
      message:
        "DCF valuation isn't available. This model works by discounting future free cash flow back to today — a company with negative (or zero) free cash flow doesn't have a meaningful starting point to project from. Use the entry-price models below (PB, Dividend Yield, PE, P/OCF) and the PEG verdict instead to judge whether it looks attractively priced.",
    };
  }

  if (
    !isNum(growth_1_5) ||
    !isNum(growth_6_10) ||
    !isNum(terminal_growth) ||
    !isNum(diluted_shares) ||
    !isNum(cash_and_st_investments) ||
    !isNum(total_debt_and_leases) ||
    !isNum(risk_free_rate) ||
    !isNum(market_risk_premium) ||
    !isNum(beta) ||
    diluted_shares <= 0 ||
    !isNum(sharePrice) ||
    sharePrice <= 0
  ) {
    return {
      available: false,
      reason: "missing_inputs",
      message: "Fill in every DCF input to see the projection.",
    };
  }

  const discountRate = beta * market_risk_premium + risk_free_rate;

  // A discount rate of -100% makes every discount factor divide by zero, and
  // anything below that alternates sign each year — neither produces a
  // number worth showing. Caught here so the student gets a sentence instead
  // of a table full of ∞.
  if (!Number.isFinite(discountRate) || discountRate <= -1) {
    return {
      available: false,
      reason: "guardrail",
      message:
        "Those CAPM inputs give a discount rate of -100% or lower, which the model can't work with. Check the risk-free rate, market risk premium and beta.",
    };
  }

  if (discountRate <= terminal_growth) {
    return {
      available: false,
      reason: "guardrail",
      message: `Terminal growth rate must be lower than the discount rate of ${(discountRate * 100).toFixed(2)}%.`,
    };
  }

  const years: DcfYearRow[] = [];
  let prevFcf = base_fcf as number;
  let prevDiscountFactor = 1;

  // Year 0 — reference row only, NOT included in sumPv (framework-spec §2d's
  // explicit quirk: the sheet sums G82:G92, not G81:G92).
  years.push({ year: 0, fcf: prevFcf, growthRateUsed: growth_1_5, discountFactor: 1, presentValue: prevFcf * 1 });

  let sumPv = 0;
  for (let year = 1; year <= 10; year++) {
    const growth = year <= 5 ? growth_1_5 : growth_6_10;
    const fcf = prevFcf * (1 + growth);
    const discountFactor = prevDiscountFactor / (1 + discountRate);
    const presentValue = fcf * discountFactor;
    years.push({ year, fcf, growthRateUsed: growth, discountFactor, presentValue });
    sumPv += presentValue;
    prevFcf = fcf;
    prevDiscountFactor = discountFactor;
  }

  const year10 = years[10];
  const terminalValue = (year10.fcf * (1 + terminal_growth)) / (discountRate - terminal_growth);
  // Terminal value's discount factor is ONE period further out than Year
  // 10's own factor (framework-spec.md §2d row 92: F92 = F91/(1+$D$72), not
  // F91 itself) — the Gordon Growth terminal value is valued as of the end
  // of Year 10, so discounting it back to today needs Year 10's factor
  // divided by (1+discount_rate) once more, not reused as-is. Easy to
  // mis-port if you assume "terminal value discounts like Year 10" — it
  // discounts like Year 11.
  const terminalDiscountFactor = year10.discountFactor / (1 + discountRate);
  const pvTerminalValue = terminalValue * terminalDiscountFactor;
  sumPv += pvTerminalValue;

  const netDebt = total_debt_and_leases - cash_and_st_investments;
  const intrinsicValueTotal = sumPv - netDebt;
  const intrinsicValuePerShare = intrinsicValueTotal / diluted_shares;
  const marginOfSafety = (intrinsicValuePerShare - sharePrice) / sharePrice;

  // Final overflow net. Extreme-but-typeable inputs (a 1e300 growth rate, a
  // share count of 1e-320, debt at the float ceiling) can push these past
  // what a double can hold, and NaN/Infinity must never render as a valuation
  // or be written to valuation_summary — JSON.stringify turns both into
  // `null`, which previously persisted the nonsense state
  // { dcf_available: true, margin_of_safety: null, dcf_signal: "…" }.
  if (
    ![sumPv, terminalValue, intrinsicValueTotal, intrinsicValuePerShare, marginOfSafety].every(
      Number.isFinite
    )
  ) {
    return {
      available: false,
      reason: "guardrail",
      message:
        "Those inputs produce numbers too large for the model to work with. Check the growth rates, share count, cash and debt figures.",
    };
  }

  const bands = config.margin_of_safety_bands;
  let signal: Signal;
  if (marginOfSafety >= bands.undervalued) signal = "Undervalued";
  else if (marginOfSafety <= bands.overvalued) signal = "Overvalued";
  else signal = "Fair Value";

  return {
    available: true,
    discountRate,
    years,
    terminalValue,
    sumPv,
    netDebt,
    intrinsicValueTotal,
    intrinsicValuePerShare,
    marginOfSafety,
    signal,
  };
}

// ---------------------------------------------------------------------------
// Denormalized summary — persisted to evaluations.valuation_summary on every
// autosave so the dashboard can render/sort the Valuation column without
// recomputing a DCF. No "overall verdict" field (owner-locked decision).
// ---------------------------------------------------------------------------

export type ValuationSummary = {
  dcf_available: boolean;
  margin_of_safety: number | null;
  dcf_signal: Signal | null;
  updated_at: string;
};

export function computeValuationSummary(dcf: DcfResult, now: Date = new Date()): ValuationSummary {
  if (dcf.available) {
    return {
      dcf_available: true,
      margin_of_safety: dcf.marginOfSafety,
      dcf_signal: dcf.signal,
      updated_at: now.toISOString(),
    };
  }
  return {
    dcf_available: false,
    margin_of_safety: null,
    dcf_signal: null,
    updated_at: now.toISOString(),
  };
}
