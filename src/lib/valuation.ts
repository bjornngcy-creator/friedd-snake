// Phase 3.1 valuation engine — the ONE shared module that computes every
// valuation number. Pure functions, no side effects, importable by the
// client component (live recalc on every input change), the server action
// (recomputes server-side before persisting, never trusts a client-sent
// summary — same philosophy as src/lib/scoring.ts), and the dashboard (live
// recompute of the sortable valuation badge, §Phase 3.1 item 8 — no verdict
// is ever persisted).
//
// Source of truth: docs/framework-spec.md §2 "STEP 2: VALUATIONS" (sheet
// formulas) and docs/phase3-valuation-spec.md (buildable spec, updated for
// Phase 3.1). DCF math is UNCHANGED from Phase 3 and still verified against
// the frameworks-spec's worked GOOGL example in scripts/verify-valuation.mjs:
// discount rate 6.5573%, Year 1 FCF $80,592.6M, Year 1 PV $75,633.11M, sum of
// PV $3,099,678.52M, net debt -$59,847M (net cash), intrinsic value/share
// $258.34, MoS -27.08% -> Overvalued DCF signal.
//
// Phase 3.1 changes (owner-approved rework, see docs/phase3-valuation-spec.md):
//   - Debt input is now 4 fields (short/long-term debt, short/long-term
//     lease), auto-summed. Backward-compatible with the old single
//     `total_debt_and_leases` field via migrate-on-read.
//   - P/B, P/E and P/OCF are now "5Y average multiple" models: 5 yearly
//     inputs -> average, compared against a CURRENT multiple the app derives
//     from live share price + the student's own fundamentals (never
//     auto-fetched). Signal = current multiple vs 5Y average, same shape
//     P/OCF already used in Phase 3.
//   - P/OCF's ocf_per_share input is gone — replaced with a total OCF ($)
//     input, OCF/share is derived by dividing by diluted shares outstanding
//     (reusing the DCF section's shares input, never re-asked).
//   - No overall/blended verdict, ever (unchanged from Phase 3). No
//     "valuation_summary" persistence either — Phase 3.1 stops writing that
//     column; every consumer (the valuation page, the dashboard) recomputes
//     live from valuation_inputs + the evaluation's cached share price.

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

/**
 * 5 (or optionally 6) yearly multiple readings (any order the student
 * wants — averaged, not chronologically validated). Always exactly 6
 * slots; blanks are `undefined`. Slot 5 (the 6th year) is optional — Phase
 * 3.2 item 1 adds an unobtrusive "+ add year" control per model that
 * reveals it. Whether it's currently averaged in is a `visibleCount`
 * concern (see `averageYearly`), not something this type encodes on its
 * own: an empty slot 5 is indistinguishable from "never expanded" at the
 * data level, which is intentional (see `averageYearly`'s docs).
 */
export type YearlyMultiple = [
  number | null | undefined,
  number | null | undefined,
  number | null | undefined,
  number | null | undefined,
  number | null | undefined,
  number | null | undefined,
];

/** How many of a `YearlyMultiple`'s slots are currently part of the average — 5 (the default) or 6 once a student has added the optional 6th year. */
export type YearlyVisibleCount = 5 | 6;

function emptyYearly(): YearlyMultiple {
  return [undefined, undefined, undefined, undefined, undefined, undefined];
}

export type EntryModelInputs = {
  pb: { yearly: YearlyMultiple };
  dividend: { annual_dividend: number | null | undefined };
  pe: { yearly: YearlyMultiple };
  /** `ocf_total` = total operating cash flow ($M), NOT per-share — OCF/share is derived from `dcf.diluted_shares` (Phase 3.1 fix, spec item 10). */
  pocf: { ocf_total: number | null | undefined; yearly: YearlyMultiple };
  peg: { peg_ratio: number | null | undefined };
};

export type DcfInputs = {
  base_fcf: number | null | undefined;
  growth_1_5: number | null | undefined;
  growth_6_10: number | null | undefined;
  terminal_growth: number | null | undefined;
  diluted_shares: number | null | undefined;
  cash_and_st_investments: number | null | undefined;
  /**
   * Phase 3.1: the single `total_debt_and_leases` field became 4 fields.
   * Each is independently optional and defaults to 0 when summed — a
   * company with no lease liabilities shouldn't have to type a 0. Old rows
   * are migrated on read (see `legacyDebtTotal` below); the "auto-sum"
   * total isn't stored, it's always derived at compute time.
   */
  short_term_debt: number | null | undefined;
  long_term_debt: number | null | undefined;
  short_term_lease: number | null | undefined;
  long_term_lease: number | null | undefined;
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
      pb: { yearly: emptyYearly() },
      dividend: { annual_dividend: undefined },
      pe: { yearly: emptyYearly() },
      pocf: { ocf_total: undefined, yearly: emptyYearly() },
      peg: { peg_ratio: undefined },
    },
    dcf: {
      base_fcf: undefined,
      growth_1_5: undefined,
      growth_6_10: undefined,
      terminal_growth: undefined,
      diluted_shares: undefined,
      cash_and_st_investments: undefined,
      short_term_debt: undefined,
      long_term_debt: undefined,
      short_term_lease: undefined,
      long_term_lease: undefined,
      risk_free_rate: undefined,
      market_risk_premium: undefined,
      beta: undefined,
    },
  };
}

function numOrUndefined(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeYearly(raw: unknown): YearlyMultiple {
  const arr = Array.isArray(raw) ? raw : [];
  const out = emptyYearly();
  for (let i = 0; i < 6; i++) out[i] = numOrUndefined(arr[i]);
  return out;
}

/**
 * Reads the legacy single `total_debt_and_leases` value off a raw (pre-
 * Phase-3.1) stored `valuation_inputs.dcf` blob, if present. Exported
 * standalone (rather than folded silently into normalizeValuationInputs) so
 * the UI can show a one-time "migrated from your old total debt figure" note
 * — the migration itself still happens inside normalizeValuationInputs so
 * every consumer of a normalized ValuationInputs gets a sane, already-summed
 * total without having to know this history exists.
 */
export function legacyDebtTotal(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const dcf = (raw as Record<string, unknown>).dcf;
  if (!dcf || typeof dcf !== "object") return null;
  const legacy = numOrUndefined((dcf as Record<string, unknown>).total_debt_and_leases);
  return legacy ?? null;
}

/** Deep-merges a partial/raw inputs object (e.g. from the DB or a client request) onto the empty shape, so missing nested keys never crash a `.foo.bar` access. */
export function normalizeValuationInputs(raw: unknown): ValuationInputs {
  const empty = emptyValuationInputs();
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;

  const cf = (r.company_financials as Partial<CompanyFinancialsInputs>) ?? {};
  const cagr = (r.cagr_helper as Partial<CagrHelperInputs>) ?? {};
  const em = (r.entry_models as Record<string, unknown>) ?? {};
  const dcf = (r.dcf as Record<string, unknown>) ?? {};

  const pb = (em.pb as Record<string, unknown>) ?? {};
  const dividend = (em.dividend as Partial<EntryModelInputs["dividend"]>) ?? {};
  const pe = (em.pe as Record<string, unknown>) ?? {};
  const pocf = (em.pocf as Record<string, unknown>) ?? {};
  const peg = (em.peg as Partial<EntryModelInputs["peg"]>) ?? {};

  // Phase 3.1 debt migration — old rows only ever had `total_debt_and_leases`.
  // If none of the 4 new fields have a value yet, fold the legacy total into
  // `long_term_debt` (an arbitrary but harmless bucket — it only matters that
  // the SUM comes out right, since net debt is the only thing that reads
  // these 4 fields) so the DCF keeps working for evaluations saved before
  // this rework, without the student having to re-enter anything.
  const short_term_debt = numOrUndefined(dcf.short_term_debt);
  let long_term_debt = numOrUndefined(dcf.long_term_debt);
  const short_term_lease = numOrUndefined(dcf.short_term_lease);
  const long_term_lease = numOrUndefined(dcf.long_term_lease);
  if (
    short_term_debt === undefined &&
    long_term_debt === undefined &&
    short_term_lease === undefined &&
    long_term_lease === undefined
  ) {
    const legacy = numOrUndefined(dcf.total_debt_and_leases);
    if (legacy !== undefined) long_term_debt = legacy;
  }

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
      pb: { yearly: normalizeYearly(pb.yearly) },
      dividend: { annual_dividend: numOrUndefined(dividend.annual_dividend) },
      pe: { yearly: normalizeYearly(pe.yearly) },
      pocf: { ocf_total: numOrUndefined(pocf.ocf_total), yearly: normalizeYearly(pocf.yearly) },
      peg: { peg_ratio: numOrUndefined(peg.peg_ratio) },
    },
    dcf: {
      base_fcf: numOrUndefined(dcf.base_fcf),
      growth_1_5: numOrUndefined(dcf.growth_1_5),
      growth_6_10: numOrUndefined(dcf.growth_6_10),
      terminal_growth: numOrUndefined(dcf.terminal_growth),
      diluted_shares: numOrUndefined(dcf.diluted_shares),
      cash_and_st_investments: numOrUndefined(dcf.cash_and_st_investments),
      short_term_debt,
      long_term_debt,
      short_term_lease,
      long_term_lease,
      risk_free_rate: numOrUndefined(dcf.risk_free_rate),
      market_risk_premium: numOrUndefined(dcf.market_risk_premium),
      beta: numOrUndefined(dcf.beta),
    },
  };
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
    return { ok: false, error: "Enter first-year FCF, latest-year FCF, and number of years." };
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

/** Soft (non-blocking) range warning for the CAGR helper's "number of years" field — spec §2.1. */
export function cagrYearsRangeWarning(years: number | null | undefined): string | null {
  if (!isNum(years)) return null;
  if (years < 1 || years > 20) {
    return "That's an unusual number of years to project over — typically 1-20.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1.3 Entry-price models. Dividend keeps the original "entry price vs share
// price" comparison. P/B, P/E and P/OCF are all "5Y average multiple"
// models (Phase 3.1): a derived CURRENT multiple compared against the
// student's own 5Y average, same shape P/OCF already used pre-3.1.
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

export function computeDividendModel(
  annualDividend: number | null | undefined,
  sharePrice: number | null | undefined,
  dividendYieldAssumption: number
): EntryModelResult {
  if (!isNum(annualDividend) || !dividendYieldAssumption) return { entryPrice: null, signal: null };
  return entryModelResult(annualDividend / dividendYieldAssumption, sharePrice);
}

/** PEG verdict — informational only (owner-locked). Never combined with anything. */
export function computePegVerdict(pegRatio: number | null | undefined): Signal | null {
  if (!isNum(pegRatio)) return null;
  if (pegRatio < 1) return "Undervalued";
  if (pegRatio > 1) return "Overvalued";
  return "Fair Value";
}

/**
 * Average of a YearlyMultiple over its currently-visible slots — requires
 * EVERY visible slot to be filled (a partial average isn't a meaningful
 * "N-year average"); the guard from Phase 3.1 extends unchanged to 6 boxes.
 *
 * `visibleCount` (Phase 3.2 item 1) is how many of the 6 slots currently
 * count:
 *   - Explicit `5` or `6` — passed by the live UI, which knows the true
 *     on-screen state. This is what makes a freshly-revealed, still-empty
 *     6th box null the average immediately (slot 5 is "visible but empty"
 *     even though nothing has been typed into it yet, and nothing has been
 *     persisted for it either) — a case no purely data-driven rule could
 *     distinguish from "6th box was never added".
 *   - Omitted — auto-detected from the data itself: 6 if slot 5 holds a
 *     value, else 5. This is what every consumer WITHOUT a live UI uses
 *     (the dashboard's recomputed badge, scripts/verify-valuation.mjs):
 *     "storing a 6th value implies the box shows expanded on reload" is
 *     exactly this rule, and it's the only signal a stored-data-only
 *     reader has available.
 */
export function averageYearly(values: YearlyMultiple, visibleCount?: YearlyVisibleCount): number | null {
  const count = visibleCount ?? (isNum(values[5]) ? 6 : 5);
  const nums: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = values[i];
    if (!isNum(v)) return null;
    nums.push(v);
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  const avg = sum / nums.length;
  return Number.isFinite(avg) ? avg : null;
}

function multipleSignal(current: number | null, avg5y: number | null): Signal | null {
  if (current == null || avg5y == null || !Number.isFinite(current) || !Number.isFinite(avg5y)) return null;
  if (current < avg5y) return "Undervalued";
  if (current > avg5y) return "Overvalued";
  return "Fair Value";
}

/** Shape shared by the 3 "5Y average multiple" models (P/B, P/E, P/OCF). */
export type MultipleModelResult = {
  avg5y: number | null;
  currentMultiple: number | null;
  entryPrice: number | null;
  signal: Signal | null;
};

function multipleModelResult(
  perShareFundamental: number | null,
  yearly: YearlyMultiple,
  sharePrice: number | null | undefined,
  visibleCount?: YearlyVisibleCount
): MultipleModelResult {
  const avg5y = averageYearly(yearly, visibleCount);
  const currentMultiple =
    perShareFundamental != null && perShareFundamental > 0 && isNum(sharePrice) && sharePrice > 0
      ? sharePrice / perShareFundamental
      : null;
  // Fix 5 (Phase 3.1 QA): a negative/zero fundamental (e.g. BVPS -10) used
  // to still multiply through into a negative "entry price" like "$-20.00"
  // — the signal was already correctly null (below), but the price wasn't.
  // Gate this the same way `currentMultiple` already is: only a genuinely
  // positive fundamental produces a price worth showing; anything else is
  // "not yet computed" (a dash in the summary table), not a nonsense number.
  const rawEntryPrice =
    perShareFundamental != null && perShareFundamental > 0 && avg5y != null
      ? perShareFundamental * avg5y
      : null;
  const entryPrice = rawEntryPrice != null && Number.isFinite(rawEntryPrice) ? rawEntryPrice : null;
  return {
    avg5y,
    currentMultiple: currentMultiple != null && Number.isFinite(currentMultiple) ? currentMultiple : null,
    entryPrice,
    signal: multipleSignal(currentMultiple, avg5y),
  };
}

export function computePbModel(
  bookValuePerShare: number | null | undefined,
  yearly: YearlyMultiple,
  sharePrice: number | null | undefined,
  visibleCount?: YearlyVisibleCount
): MultipleModelResult {
  return multipleModelResult(isNum(bookValuePerShare) ? bookValuePerShare : null, yearly, sharePrice, visibleCount);
}

export function computePeModel(
  eps: number | null | undefined,
  yearly: YearlyMultiple,
  sharePrice: number | null | undefined,
  visibleCount?: YearlyVisibleCount
): MultipleModelResult {
  return multipleModelResult(isNum(eps) ? eps : null, yearly, sharePrice, visibleCount);
}

/**
 * P/OCF — Phase 3.1 fix (spec item 10): the student no longer sources
 * "OCF per share" (not published on stockanalysis.com). They give total OCF
 * ($M) instead, and OCF/share is derived from `dilutedShares` — the same
 * shares-outstanding number already collected for the DCF, reused here
 * rather than asked twice.
 */
export function computePocfModel(
  ocfTotal: number | null | undefined,
  yearly: YearlyMultiple,
  dilutedShares: number | null | undefined,
  sharePrice: number | null | undefined,
  visibleCount?: YearlyVisibleCount
): MultipleModelResult {
  const ocfPerShare =
    isNum(ocfTotal) && isNum(dilutedShares) && dilutedShares > 0 ? ocfTotal / dilutedShares : null;
  return multipleModelResult(
    ocfPerShare != null && Number.isFinite(ocfPerShare) ? ocfPerShare : null,
    yearly,
    sharePrice,
    visibleCount
  );
}

export type EntryModelsResult = {
  pb: MultipleModelResult;
  dividend: EntryModelResult;
  pe: MultipleModelResult;
  pocf: MultipleModelResult;
  pegVerdict: Signal | null;
  /** Derived OCF/share, exposed for the "show the math" formula display — null when total OCF or shares aren't in yet. */
  ocfPerShare: number | null;
};

/**
 * Phase 3.2 item 1 — how many of each multiple model's 6 yearly slots are
 * currently visible on screen. Every field is optional and independent
 * (a student can expand P/B's 6th year without touching P/E's). Omitted
 * entirely by callers with no live UI (the dashboard, verify-valuation.mjs)
 * — see `averageYearly`'s docs for what happens then.
 */
export type YearlyVisibleCounts = {
  pb?: YearlyVisibleCount;
  pe?: YearlyVisibleCount;
  pocf?: YearlyVisibleCount;
};

export function computeEntryModels(
  inputs: EntryModelInputs,
  companyFinancials: CompanyFinancialsInputs,
  sharePrice: number | null | undefined,
  dilutedShares: number | null | undefined,
  config: ValuationConfig,
  visibleCounts?: YearlyVisibleCounts
): EntryModelsResult {
  const ocfPerShare =
    isNum(inputs.pocf.ocf_total) && isNum(dilutedShares) && dilutedShares > 0
      ? inputs.pocf.ocf_total / dilutedShares
      : null;

  return {
    pb: computePbModel(companyFinancials.book_value_per_share, inputs.pb.yearly, sharePrice, visibleCounts?.pb),
    dividend: computeDividendModel(
      inputs.dividend.annual_dividend,
      sharePrice,
      config.dividend_yield_assumption
    ),
    pe: computePeModel(companyFinancials.eps, inputs.pe.yearly, sharePrice, visibleCounts?.pe),
    pocf: computePocfModel(
      inputs.pocf.ocf_total,
      inputs.pocf.yearly,
      dilutedShares,
      sharePrice,
      visibleCounts?.pocf
    ),
    pegVerdict: computePegVerdict(inputs.peg.peg_ratio),
    ocfPerShare: ocfPerShare != null && Number.isFinite(ocfPerShare) ? ocfPerShare : null,
  };
}

/** Soft (non-blocking) range warning: BVPS <= 0 makes P/B not meaningful — spec item 12. */
export function bvpsRangeWarning(bvps: number | null | undefined): string | null {
  if (isNum(bvps) && bvps <= 0) {
    return "P/B won't be meaningful with a zero or negative book value per share.";
  }
  return null;
}

/** Soft (non-blocking) range warning: negative EPS makes P/E not meaningful — spec item 12. */
export function epsRangeWarning(eps: number | null | undefined): string | null {
  if (isNum(eps) && eps < 0) {
    return "Negative EPS makes P/E not meaningful here — the current multiple will be negative.";
  }
  return null;
}

/** Soft (non-blocking) growth-decay hint — DCF growth normally decays from Yrs 1-5 to Yrs 6-10 (spec §2.1 / item 12). */
export function growthDecayWarning(
  growth1_5: number | null | undefined,
  growth6_10: number | null | undefined
): string | null {
  if (isNum(growth1_5) && isNum(growth6_10) && growth6_10 >= growth1_5) {
    return "Growth usually decays over time — Yrs 6-10 growth is typically lower than Yrs 1-5, not equal or higher.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1.4 DCF chain — CAPM discount rate, 10-year two-phase FCF projection,
// Gordon Growth terminal value, net-debt adjustment, margin of safety.
// Math is UNCHANGED from Phase 3 — only the debt/lease input shape changed
// (4 fields auto-summed instead of 1).
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
  totalDebtAndLeases: number; // auto-summed from the 4 debt/lease inputs — exposed for "show the math".
  netDebt: number; // totalDebtAndLeases - cash_and_st_investments. Negative = net cash.
  intrinsicValueTotal: number;
  intrinsicValuePerShare: number;
  marginOfSafety: number; // (intrinsic/share - share price) / share price — computed internally to drive the signal band; never displayed (owner-locked, Phase 3.1 item 7).
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
    short_term_debt,
    long_term_debt,
    short_term_lease,
    long_term_lease,
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

  // Debt/leases auto-sum (Phase 3.1 item 5): each of the 4 fields defaults
  // to 0 when blank rather than blocking the DCF — plenty of companies
  // genuinely have $0 in one or more of these buckets, and there's no reason
  // to force a student to type a zero for something that isn't there.
  const totalDebtAndLeases =
    (short_term_debt ?? 0) + (long_term_debt ?? 0) + (short_term_lease ?? 0) + (long_term_lease ?? 0);

  if (
    !isNum(growth_1_5) ||
    !isNum(growth_6_10) ||
    !isNum(terminal_growth) ||
    !isNum(diluted_shares) ||
    !isNum(cash_and_st_investments) ||
    diluted_shares <= 0 ||
    !isNum(risk_free_rate) ||
    !isNum(market_risk_premium) ||
    !isNum(beta) ||
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

  const netDebt = totalDebtAndLeases - cash_and_st_investments;
  const intrinsicValueTotal = sumPv - netDebt;
  const intrinsicValuePerShare = intrinsicValueTotal / diluted_shares;
  const marginOfSafety = (intrinsicValuePerShare - sharePrice) / sharePrice;

  // Final overflow net. Extreme-but-typeable inputs (a 1e300 growth rate, a
  // share count of 1e-320, debt at the float ceiling) can push these past
  // what a double can hold, and NaN/Infinity must never render as a valuation
  // — JSON.stringify turns both into `null`, which previously persisted the
  // nonsense state { dcf_available: true, margin_of_safety: null, … }.
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
    totalDebtAndLeases,
    netDebt,
    intrinsicValueTotal,
    intrinsicValuePerShare,
    marginOfSafety,
    signal,
  };
}

// ---------------------------------------------------------------------------
// Phase 3.1 item 7 — fixed-order valuation summary table. One row per model,
// always in this order, regardless of which ones have enough inputs yet.
// Models without sufficient inputs render as a dash row (never hidden).
// No "computed value" here doubles as a margin-of-safety display anywhere —
// the DCF row's value is intrinsic value per share, not MoS (owner-locked).
// ---------------------------------------------------------------------------

export type ValuationSummaryRow = {
  key: "dcf" | "pb" | "dividend" | "pe" | "pocf";
  label: string;
  /** Pre-formatted display value (e.g. "$258.34" or "6.2x"), or null if not yet computable. */
  value: string | null;
  signal: Signal | null;
};

export function buildValuationSummaryRows(
  dcf: DcfResult,
  entryModels: EntryModelsResult
): ValuationSummaryRow[] {
  return [
    {
      key: "dcf",
      label: "DCF",
      value: dcf.available ? `$${dcf.intrinsicValuePerShare.toFixed(2)}` : null,
      signal: dcf.available ? dcf.signal : null,
    },
    {
      key: "pb",
      label: "P/B",
      value: entryModels.pb.entryPrice != null ? `$${entryModels.pb.entryPrice.toFixed(2)}` : null,
      signal: entryModels.pb.signal,
    },
    {
      key: "dividend",
      label: "Dividend",
      value: entryModels.dividend.entryPrice != null ? `$${entryModels.dividend.entryPrice.toFixed(2)}` : null,
      signal: entryModels.dividend.signal,
    },
    {
      key: "pe",
      label: "P/E",
      value: entryModels.pe.entryPrice != null ? `$${entryModels.pe.entryPrice.toFixed(2)}` : null,
      signal: entryModels.pe.signal,
    },
    {
      key: "pocf",
      label: "P/OCF",
      value: entryModels.pocf.entryPrice != null ? `$${entryModels.pocf.entryPrice.toFixed(2)}` : null,
      signal: entryModels.pocf.signal,
    },
  ];
}

/** Phase 3.1 item 8 — dashboard badge input: count of models signaling Undervalued out of models with sufficient inputs to signal at all. DCF + the 4 entry models = up to 5; PEG is informational-only and excluded (owner-locked, never a voting signal). */
export type ValuationBadgeCounts = { undervalued: number; total: number };

export function countUndervaluedModels(dcf: DcfResult, entryModels: EntryModelsResult): ValuationBadgeCounts {
  const signals: (Signal | null)[] = [
    dcf.available ? dcf.signal : null,
    entryModels.pb.signal,
    entryModels.dividend.signal,
    entryModels.pe.signal,
    entryModels.pocf.signal,
  ];
  const withSignal = signals.filter((s): s is Signal => s !== null);
  return {
    undervalued: withSignal.filter((s) => s === "Undervalued").length,
    total: withSignal.length,
  };
}
