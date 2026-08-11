"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ClipboardEvent } from "react";
import {
  bvpsRangeWarning,
  buildValuationSummaryRows,
  cagrYearsRangeWarning,
  computeCagr,
  computeEntryModels,
  computeDcf,
  epsRangeWarning,
  growthDecayWarning,
  isDcfBlockedByNegativeFcf,
  resolveValuationConfig,
  type CompanyFinancialsInputs,
  type DcfInputs,
  type DcfResult,
  type EntryModelsResult,
  type MultipleModelResult,
  type Signal,
  type ValuationInputs,
  type ValuationSummaryRow,
  type YearlyMultiple,
} from "@/lib/valuation";
import type { FrameworkValuationConfig } from "@/lib/scoring";
import { saveValuationInputs } from "@/lib/actions/valuation";

const AUTOSAVE_DELAY_MS = 800;

type EvaluationData = {
  id: string;
  ticker: string;
  companyName: string;
  sharePrice: number | null;
  inputs: ValuationInputs;
};

// ---------------------------------------------------------------------------
// Fixed source-link navigation hints. Not framework-driven — unlike the
// scoring criteria, these valuation fields are a fixed set the spec pins to
// specific stockanalysis.com pages (plus MarketWatch and
// market-risk-premia.com for the two CAPM inputs stockanalysis.com doesn't
// publish), so there's no admin-tunable JSON behind them.
// ---------------------------------------------------------------------------

function stockanalysis(path: string, ticker: string) {
  return `https://stockanalysis.com/stocks/${encodeURIComponent(ticker)}/${path}`;
}

const LINKS = {
  incomeStatement: (t: string) => stockanalysis("financials/income-statement/", t),
  balanceSheet: (t: string) => stockanalysis("financials/balance-sheet/", t),
  cashFlow: (t: string) => stockanalysis("financials/cash-flow-statement/", t),
  statistics: (t: string) => stockanalysis("statistics/", t),
  // The Statistics page publishes only *current* ratios. The "5Y" fields need
  // per-fiscal-year history, which lives on Financials > Ratios.
  ratios: (t: string) => stockanalysis("financials/ratios/", t),
  overview: (t: string) => stockanalysis("", t),
  treasury: "https://www.marketwatch.com/investing/bond/tmubmusd10y",
  marketRiskPremium: "https://www.market-risk-premia.com/us.html",
};

// ---------------------------------------------------------------------------
// Phase 3.2 item 2 — paste-to-fill for the 5Y/6Y yearly multiple boxes.
// Pasting a whole spreadsheet row (or a stockanalysis.com copy) into any one
// box should split it across that box and the ones after it. Pure functions,
// no React, so they're easy to reason about independently of the paste event
// plumbing below.
// ---------------------------------------------------------------------------

/**
 * Strips a comma ONLY when it's acting as a thousands separator — glued
 * directly to a 3-digit group followed by a non-digit or end-of-string
 * (e.g. "1,234.56" -> "1234.56"). A comma followed by anything else (a
 * space before the next number, e.g. "23.55, 22.97") is left alone: the
 * delimiter split below treats it as a value separator either way, so
 * there's nothing to "fix" there, and being conservative here avoids ever
 * mangling a genuine list of small values.
 */
function stripThousandsCommas(text: string): string {
  return text.replace(/,(?=\d{3}(?:\D|$))/g, "");
}

/** Splits pasted text on tabs, newlines, commas, and runs of whitespace — covers spreadsheet rows/columns, stockanalysis.com copies, and comma-separated lists alike. */
function splitPasteTokens(text: string): string[] {
  return stripThousandsCommas(text)
    .split(/[\t\n\r,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Parses one token into a number, stripping common copy-paste noise: a leading "$", a trailing "%" or "x"/"X" (e.g. "$23.55", "24.9%", "16.67x"). Returns null for anything that still isn't a finite number — garbage tokens are skipped, not fatal to the whole paste. */
function parseNumericToken(token: string): number | null {
  const cleaned = token.replace(/^\$+/, "").replace(/[%xX]+$/, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parses every numeric value out of a pasted blob, in order, skipping tokens that don't parse (spec: "fill the values that parse, skip tokens that don't"). */
function parsePastedNumbers(text: string): number[] {
  return splitPasteTokens(text)
    .map(parseNumericToken)
    .filter((n): n is number => n !== null);
}

// ---------------------------------------------------------------------------
// Phase 3.1 item 4 — model-fit tooltip copy. Concise, plain-English, aimed
// at a beginner investor deciding which model to trust for a given company.
// ---------------------------------------------------------------------------

const MODEL_TOOLTIPS: Record<ValuationSummaryRow["key"], string> = {
  dcf: "Best for businesses with steady, positive free cash flow you can reasonably project forward — mature, predictable earners. Skip it for volatile or cash-burning businesses; use the models below instead.",
  pb: "Best for banks, insurers, and other asset-heavy businesses, where book value closely tracks what the company is actually worth. Less useful for asset-light businesses like software.",
  dividend: "Best for mature dividend payers with a long, stable history of steady payouts. Not meaningful for companies that don't pay a dividend, or whose dividend is new or unpredictable.",
  pe: "Best for stable, mature, consistently profitable businesses with a long earnings track record. Misleading for companies with erratic, cyclical, or negative earnings.",
  pocf: "Best for capital-intensive or high-depreciation businesses, where accounting earnings understate the cash the business actually generates. A useful cross-check alongside P/E.",
};

export function ValuationSection({
  evaluation,
  valuationConfig,
  legacyDebtTotal,
}: {
  evaluation: EvaluationData;
  valuationConfig?: FrameworkValuationConfig;
  legacyDebtTotal?: number | null;
}) {
  const config = useMemo(() => resolveValuationConfig(valuationConfig), [valuationConfig]);
  const [inputs, setInputs] = useState<ValuationInputs>(evaluation.inputs);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    setSaveState("saving");
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await saveValuationInputs(evaluation.id, inputs);
        setSaveState(result.ok ? "saved" : "error");
      });
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputs, evaluation.id]);

  function setCompanyField(key: keyof CompanyFinancialsInputs, value: number | undefined) {
    setInputs((prev) => ({ ...prev, company_financials: { ...prev.company_financials, [key]: value } }));
  }

  function setCagrField(key: "fcf_first" | "fcf_last" | "years", value: number | undefined) {
    setInputs((prev) => ({ ...prev, cagr_helper: { ...prev.cagr_helper, [key]: value } }));
  }

  function setYearly(model: "pb" | "pe" | "pocf", index: number, value: number | undefined) {
    setInputs((prev) => {
      const current = prev.entry_models[model].yearly;
      const next = [...current] as YearlyMultiple;
      next[index] = value;
      return { ...prev, entry_models: { ...prev.entry_models, [model]: { ...prev.entry_models[model], yearly: next } } };
    });
  }

  /** Phase 3.2 item 2 — fills several consecutive yearly slots (starting at `startIndex`) in one state update, so a multi-value paste is one re-render/autosave tick, not N. */
  function setYearlyMany(model: "pb" | "pe" | "pocf", startIndex: number, values: number[]) {
    setInputs((prev) => {
      const current = prev.entry_models[model].yearly;
      const next = [...current] as YearlyMultiple;
      for (let i = 0; i < values.length; i++) {
        const index = startIndex + i;
        if (index > 5) break; // only 6 slots exist (0-5)
        next[index] = values[i];
      }
      return { ...prev, entry_models: { ...prev.entry_models, [model]: { ...prev.entry_models[model], yearly: next } } };
    });
  }

  // Phase 3.2 item 1 — the optional 6th yearly-multiple box, tracked per
  // model (independent: expanding P/B's 6th year doesn't touch P/E's).
  // Lazily initialized from the loaded evaluation, not the live `inputs`
  // state: "storing a 6th value implies the box shows expanded on reload"
  // is exactly this — decide once, from what was actually saved, then let
  // the student's own add/remove clicks (and paste-driven auto-expand)
  // take over from there.
  const [showSixth, setShowSixthState] = useState<{ pb: boolean; pe: boolean; pocf: boolean }>(() => ({
    pb: evaluation.inputs.entry_models.pb.yearly[5] != null,
    pe: evaluation.inputs.entry_models.pe.yearly[5] != null,
    pocf: evaluation.inputs.entry_models.pocf.yearly[5] != null,
  }));

  function setShowSixth(model: "pb" | "pe" | "pocf", value: boolean) {
    setShowSixthState((prev) => (prev[model] === value ? prev : { ...prev, [model]: value }));
  }

  function handleAddSixthYear(model: "pb" | "pe" | "pocf") {
    setShowSixth(model, true);
  }

  function handleRemoveSixthYear(model: "pb" | "pe" | "pocf") {
    setYearly(model, 5, undefined);
    setShowSixth(model, false);
  }

  function setDividendField(value: number | undefined) {
    setInputs((prev) => ({
      ...prev,
      entry_models: { ...prev.entry_models, dividend: { annual_dividend: value } },
    }));
  }
  function setPocfOcfTotal(value: number | undefined) {
    setInputs((prev) => ({
      ...prev,
      entry_models: { ...prev.entry_models, pocf: { ...prev.entry_models.pocf, ocf_total: value } },
    }));
  }
  function setPegField(value: number | undefined) {
    setInputs((prev) => ({ ...prev, entry_models: { ...prev.entry_models, peg: { peg_ratio: value } } }));
  }

  // Fix 6 (Phase 3.1 QA): the legacy-debt migration note (rendered below)
  // should disappear the moment the student touches any of the 4 debt/lease
  // fields, not linger until the next full page reload — the autosave
  // already drops the legacy key server-side on first save, so this is
  // purely about not showing a stale instruction once it's been acted on.
  const [debtFieldsTouched, setDebtFieldsTouched] = useState(false);
  const DEBT_FIELD_KEYS: (keyof DcfInputs)[] = [
    "short_term_debt",
    "long_term_debt",
    "short_term_lease",
    "long_term_lease",
  ];

  function setDcfField(key: keyof DcfInputs, value: number | undefined) {
    if (DEBT_FIELD_KEYS.includes(key)) setDebtFieldsTouched(true);
    setInputs((prev) => ({ ...prev, dcf: { ...prev.dcf, [key]: value } }));
  }

  const cagr = useMemo(() => computeCagr(inputs.cagr_helper), [inputs.cagr_helper]);
  const entryModels = useMemo(
    () =>
      computeEntryModels(
        inputs.entry_models,
        inputs.company_financials,
        evaluation.sharePrice,
        inputs.dcf.diluted_shares,
        config,
        {
          pb: showSixth.pb ? 6 : 5,
          pe: showSixth.pe ? 6 : 5,
          pocf: showSixth.pocf ? 6 : 5,
        }
      ),
    [
      inputs.entry_models,
      inputs.company_financials,
      inputs.dcf.diluted_shares,
      evaluation.sharePrice,
      config,
      showSixth,
    ]
  );
  const dcf = useMemo(
    () => computeDcf(inputs.dcf, evaluation.sharePrice, config),
    [inputs.dcf, evaluation.sharePrice, config]
  );
  const summaryRows = useMemo(() => buildValuationSummaryRows(dcf, entryModels), [dcf, entryModels]);

  // Phase 3.1 item 3 — only a genuinely entered non-positive FCF justifies
  // the teaching note. "Nothing typed yet" is a different, unremarkable
  // state. Neither state disables any input (item 3: nothing is ever
  // blocked) — this only controls which message renders in the output area.
  const dcfNegativeFcf = isDcfBlockedByNegativeFcf(inputs.dcf.base_fcf);

  return (
    <div>
      <ValuationHeader evaluation={evaluation} />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8 pb-24 lg:pb-0">
          <DcfGroup
            ticker={evaluation.ticker}
            inputs={inputs}
            dcf={dcf}
            dcfNegativeFcf={dcfNegativeFcf}
            companyName={evaluation.companyName}
            setCagrField={setCagrField}
            setDcfField={setDcfField}
            cagr={cagr}
            legacyDebtTotal={debtFieldsTouched ? null : (legacyDebtTotal ?? null)}
          />

          <EntryModelsGroup
            ticker={evaluation.ticker}
            inputs={inputs}
            entryModels={entryModels}
            setCompanyField={setCompanyField}
            setYearly={setYearly}
            setYearlyMany={setYearlyMany}
            setDividendField={setDividendField}
            setPocfOcfTotal={setPocfOcfTotal}
            setPegField={setPegField}
            sharePrice={evaluation.sharePrice}
            dilutedShares={inputs.dcf.diluted_shares}
            showSixth={showSixth}
            onAddSixthYear={handleAddSixthYear}
            onRemoveSixthYear={handleRemoveSixthYear}
          />
        </div>

        {/* Desktop sticky sidebar */}
        <div className="hidden lg:block">
          <div className="sticky top-6">
            <SummaryPanel rows={summaryRows} saveState={saveState} isPending={isPending} />
          </div>
        </div>
      </div>

      {/* Mobile collapsible bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-subtle bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.06)] lg:hidden">
        <button
          type="button"
          onClick={() => setMobilePanelOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3"
        >
          <span className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">Valuation</span>
            <span className="text-xs text-secondary">
              {summaryRows.filter((r) => r.value != null).length}/{summaryRows.length} computed
            </span>
          </span>
          <span className="text-xs font-medium text-secondary">
            {mobilePanelOpen ? "Hide details ▾" : "Show details ▴"}
          </span>
        </button>

        {mobilePanelOpen && (
          <div className="max-h-[70vh] overflow-y-auto border-t border-subtle px-4 pb-6">
            <SummaryPanel rows={summaryRows} saveState={saveState} isPending={isPending} compact />
          </div>
        )}
      </div>
    </div>
  );
}

function ValuationHeader({ evaluation }: { evaluation: EvaluationData }) {
  return (
    <div className="rounded-xl border border-subtle bg-surface p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif text-xl text-foreground">Valuation</h2>
          <p className="mt-1 text-sm text-secondary">
            {evaluation.ticker} · {evaluation.companyName} · Share price:{" "}
            <span className="font-medium text-foreground">
              {evaluation.sharePrice != null ? `$${evaluation.sharePrice.toFixed(2)}` : "—"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group 1 — DCF Valuation (CAGR helper -> DCF inputs -> DCF output)
// ---------------------------------------------------------------------------

function DcfGroup({
  ticker,
  inputs,
  dcf,
  dcfNegativeFcf,
  companyName,
  setCagrField,
  setDcfField,
  cagr,
  legacyDebtTotal,
}: {
  ticker: string;
  inputs: ValuationInputs;
  dcf: DcfResult;
  dcfNegativeFcf: boolean;
  companyName: string;
  setCagrField: (key: "fcf_first" | "fcf_last" | "years", value: number | undefined) => void;
  setDcfField: (key: keyof DcfInputs, value: number | undefined) => void;
  cagr: ReturnType<typeof computeCagr>;
  legacyDebtTotal: number | null;
}) {
  const [fcfTableOpen, setFcfTableOpen] = useState(false); // Phase 3.1 item 6 — collapsed by default
  const yearsWarning = cagrYearsRangeWarning(inputs.cagr_helper.years);
  const decayWarning = growthDecayWarning(inputs.dcf.growth_1_5, inputs.dcf.growth_6_10);

  const totalDebtDisplay =
    (inputs.dcf.short_term_debt ?? 0) +
    (inputs.dcf.long_term_debt ?? 0) +
    (inputs.dcf.short_term_lease ?? 0) +
    (inputs.dcf.long_term_lease ?? 0);

  return (
    <section className="rounded-2xl border-2 border-subtle bg-surface-muted/70 p-5 shadow-sm sm:p-6">
      <div className="mb-5 border-b border-subtle pb-4">
        <h2 className="flex items-center gap-1.5 font-serif text-xl text-foreground">
          DCF Valuation
          <InfoTooltip text={MODEL_TOOLTIPS.dcf} label="When to use DCF" />
        </h2>
        <p className="text-sm text-secondary">Discount future free cash flow back to today&apos;s dollars.</p>
      </div>

      <div className="space-y-6">
        {/* CAGR helper — sits before growth-rate inputs on purpose. Phase 3.1
            item 11: latest/TTM FCF is entered FIRST, then first-year FCF. */}
        <div className="rounded-xl bg-surface p-4 sm:p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary">
            CAGR helper <span className="font-normal normal-case text-tertiary">— seeds your growth assumptions below, not wired into the math</span>
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumberField
              label="Latest year / TTM FCF ($M)"
              value={inputs.cagr_helper.fcf_last}
              onChange={(v) => setCagrField("fcf_last", v)}
              sourceUrl={LINKS.cashFlow(ticker)}
              sourceLabel="Cash Flow Statement"
            />
            <NumberField
              label="First-year FCF ($M)"
              value={inputs.cagr_helper.fcf_first}
              onChange={(v) => setCagrField("fcf_first", v)}
              sourceUrl={LINKS.cashFlow(ticker)}
              sourceLabel="Cash Flow Statement"
            />
            <NumberField
              label="Number of years"
              value={inputs.cagr_helper.years}
              onChange={(v) => setCagrField("years", v)}
              warning={yearsWarning}
            />
          </div>
          <p className="mt-2 text-xs text-tertiary">
            Count the gaps, not the years: 2022, 2023, 2024, 2025 + TTM → enter 4 (2022→2023 is 1, 2023→2024 is 2, …).
          </p>
          <p className="mt-3 text-sm">
            {cagr.ok ? (
              <span className="font-semibold text-foreground">CAGR: {(cagr.cagr * 100).toFixed(2)}%</span>
            ) : (
              <span className="text-tertiary">{cagr.error}</span>
            )}
          </p>
        </div>

        {/* DCF inputs — three clusters. Phase 3.1 item 3: always fully
            editable, nothing is ever disabled/locked, regardless of FCF sign. */}
        <div className="rounded-xl bg-surface p-4 sm:p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary">
            Cash Flow &amp; Growth
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField
              label="Base FCF ($M)"
              value={inputs.dcf.base_fcf}
              onChange={(v) => setDcfField("base_fcf", v)}
              sourceUrl={LINKS.cashFlow(ticker)}
              sourceLabel="Cash Flow Statement"
            />
            <NumberField
              label="Growth Yrs 1-5 (%)"
              value={inputs.dcf.growth_1_5}
              onChange={(v) => setDcfField("growth_1_5", v)}
              percent
            />
            <NumberField
              label="Growth Yrs 6-10 (%)"
              value={inputs.dcf.growth_6_10}
              onChange={(v) => setDcfField("growth_6_10", v)}
              percent
              warning={decayWarning}
            />
            <NumberField
              label="Terminal growth (%)"
              value={inputs.dcf.terminal_growth}
              onChange={(v) => setDcfField("terminal_growth", v)}
              percent
              error={!dcf.available && dcf.reason === "guardrail" ? dcf.message : undefined}
            />
          </div>

          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-secondary">Balance Sheet</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumberField
              label="Diluted shares (M)"
              value={inputs.dcf.diluted_shares}
              onChange={(v) => setDcfField("diluted_shares", v)}
              sourceUrl={LINKS.statistics(ticker)}
              sourceLabel="Statistics"
            />
            <NumberField
              label="Cash & ST investments ($M)"
              value={inputs.dcf.cash_and_st_investments}
              onChange={(v) => setDcfField("cash_and_st_investments", v)}
              sourceUrl={LINKS.balanceSheet(ticker)}
              sourceLabel="Balance Sheet"
            />
          </div>

          {/* Phase 3.1 item 5 — 4 debt/lease inputs, auto-summed. */}
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-tertiary">Debt &amp; Leases</h4>
          {legacyDebtTotal != null && (
            <p className="mt-1 text-xs text-tertiary">
              Migrated from your previous single total debt + leases figure (${legacyDebtTotal.toLocaleString("en-US")}M),
              placed in Long-term debt below — split it out across the 4 fields whenever you like.
            </p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField
              label="Short-term debt ($M)"
              value={inputs.dcf.short_term_debt}
              onChange={(v) => setDcfField("short_term_debt", v)}
              sourceUrl={LINKS.balanceSheet(ticker)}
              sourceLabel="Balance Sheet"
            />
            <NumberField
              label="Long-term debt ($M)"
              value={inputs.dcf.long_term_debt}
              onChange={(v) => setDcfField("long_term_debt", v)}
              sourceUrl={LINKS.balanceSheet(ticker)}
              sourceLabel="Balance Sheet"
            />
            <NumberField
              label="Short-term lease ($M)"
              value={inputs.dcf.short_term_lease}
              onChange={(v) => setDcfField("short_term_lease", v)}
              sourceUrl={LINKS.balanceSheet(ticker)}
              sourceLabel="Balance Sheet"
            />
            <NumberField
              label="Long-term lease ($M)"
              value={inputs.dcf.long_term_lease}
              onChange={(v) => setDcfField("long_term_lease", v)}
              sourceUrl={LINKS.balanceSheet(ticker)}
              sourceLabel="Balance Sheet"
            />
          </div>
          <p className="mt-2 text-xs text-secondary">
            Total debt + leases (auto-summed): <span className="font-semibold text-foreground">${totalDebtDisplay.toLocaleString("en-US")}M</span>
          </p>

          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-secondary">CAPM</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumberField
              label="Risk-free rate (%)"
              value={inputs.dcf.risk_free_rate}
              onChange={(v) => setDcfField("risk_free_rate", v)}
              percent
              sourceUrl={LINKS.treasury}
              sourceLabel="10Y Treasury (MarketWatch)"
            />
            <NumberField
              label="Market risk premium (%)"
              value={inputs.dcf.market_risk_premium}
              onChange={(v) => setDcfField("market_risk_premium", v)}
              percent
              sourceUrl={LINKS.marketRiskPremium}
              sourceLabel="market-risk-premia.com"
            />
            <NumberField
              label="Beta"
              value={inputs.dcf.beta}
              onChange={(v) => setDcfField("beta", v)}
              sourceUrl={LINKS.overview(ticker)}
              sourceLabel="Overview"
            />
          </div>
          {dcf.available && (
            <p className="mt-4 text-xs text-secondary">
              Discount rate (CAPM) = beta × MRP + Rf = {inputs.dcf.beta} × {((inputs.dcf.market_risk_premium ?? 0) * 100).toFixed(2)}% + {((inputs.dcf.risk_free_rate ?? 0) * 100).toFixed(2)}% ={" "}
              <span className="font-semibold text-foreground">{(dcf.discountRate * 100).toFixed(2)}%</span>
            </p>
          )}
        </div>

        {/* DCF output */}
        {dcfNegativeFcf ? (
          <InlineNote>
            <p className="font-semibold text-foreground">DCF valuation isn&apos;t available for {companyName}.</p>
            <p className="mt-2">
              This model works by discounting future free cash flow back to today — a company with negative
              (or zero) free cash flow doesn&apos;t have a meaningful starting point to project from. Use the
              entry-price models below (PB, Dividend Yield, PE, P/OCF) and the PEG verdict instead to judge
              whether {companyName} looks attractively priced. The fields above stay editable — if{" "}
              {companyName}&apos;s free cash flow turns positive, the DCF will pick right back up.
            </p>
          </InlineNote>
        ) : dcf.available ? (
          <DcfOutput dcf={dcf} fcfTableOpen={fcfTableOpen} setFcfTableOpen={setFcfTableOpen} />
        ) : (
          <div className="rounded-xl border border-dashed border-subtle bg-surface p-5 text-sm text-secondary">
            {dcf.message}
          </div>
        )}
      </div>
    </section>
  );
}

function DcfOutput({
  dcf,
  fcfTableOpen,
  setFcfTableOpen,
}: {
  dcf: Extract<DcfResult, { available: true }>;
  fcfTableOpen: boolean;
  setFcfTableOpen: (open: boolean) => void;
}) {
  return (
    <div className="rounded-xl bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary">Projected free cash flow</h3>
        {/* Phase 3.1 item 6 — collapsible, collapsed by default. */}
        <button
          type="button"
          onClick={() => setFcfTableOpen(!fcfTableOpen)}
          className="text-xs font-medium text-brand hover:text-brand-dark dark:text-accent dark:hover:text-accent-dark"
        >
          {fcfTableOpen ? "Hide year-by-year ▴" : "Show year-by-year ▾"}
        </button>
      </div>

      {fcfTableOpen && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-secondary">
              <tr>
                <th className="py-1 pr-3">Year</th>
                <th className="py-1 pr-3">FCF ($M)</th>
                <th className="py-1 pr-3">Growth</th>
                <th className="py-1 pr-3">Discount factor</th>
                <th className="py-1">PV ($M)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {dcf.years.map((row) => (
                <tr key={row.year} className={row.year === 0 ? "text-tertiary" : "text-secondary"}>
                  <td className="py-1.5 pr-3">{row.year === 0 ? "0 (ref)" : row.year}</td>
                  <td className="py-1.5 pr-3">{formatMoney(row.fcf)}</td>
                  <td className="py-1.5 pr-3">{(row.growthRateUsed * 100).toFixed(1)}%</td>
                  <td className="py-1.5 pr-3">{row.discountFactor.toFixed(4)}</td>
                  <td className="py-1.5">{formatMoney(row.presentValue)}</td>
                </tr>
              ))}
              <tr className="font-semibold text-foreground">
                <td className="py-1.5 pr-3">Terminal</td>
                <td className="py-1.5 pr-3">{formatMoney(dcf.terminalValue)}</td>
                <td className="py-1.5 pr-3" colSpan={2} />
                <td className="py-1.5" />
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-tertiary">
            Year 0 is a reference row (today&apos;s FCF, undiscounted) — it&apos;s not included in the sum below.
          </p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-subtle pt-4 sm:grid-cols-3">
        {/* The sheet works in USD millions throughout, so these totals carry
            the unit explicitly. No Margin of Safety anywhere (Phase 3.1 item 7,
            owner-locked) — intrinsic value/share is the headline number instead. */}
        <Stat label="Sum of PV (Yr 1-10 + terminal), $M" value={formatMoney(dcf.sumPv)} />
        <Stat
          label={dcf.netDebt < 0 ? "Net cash ($M)" : "Net debt ($M)"}
          value={`${formatMoney(Math.abs(dcf.netDebt))} ($${formatMoney(dcf.totalDebtAndLeases)}M debt+leases − $${formatMoney(dcf.totalDebtAndLeases - dcf.netDebt)}M cash)`}
        />
        <Stat label="Intrinsic value (total, $M)" value={formatMoney(dcf.intrinsicValueTotal)} />
        <div className="flex flex-col justify-center">
          <span className="text-xs font-medium uppercase tracking-wide text-secondary">DCF signal</span>
          <div className="mt-1">
            <SignalBadge signal={dcf.signal} />
          </div>
        </div>
      </div>

      {/* Phase 3.2 item 3 — same highlighted-box treatment every entry-price
          model uses for its implied entry price, applied here to DCF's own
          headline number so "the output of this model" reads consistently
          across the whole valuation section. */}
      <ImpliedPriceBox label="Intrinsic value / share" value={dcf.intrinsicValuePerShare} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group 2 — Entry-Price Models + PEG (informational, secondary)
// ---------------------------------------------------------------------------

type YearlyModelKey = "pb" | "pe" | "pocf";
type ShowSixthState = Record<YearlyModelKey, boolean>;

function EntryModelsGroup({
  ticker,
  inputs,
  entryModels,
  setCompanyField,
  setYearly,
  setYearlyMany,
  setDividendField,
  setPocfOcfTotal,
  setPegField,
  sharePrice,
  dilutedShares,
  showSixth,
  onAddSixthYear,
  onRemoveSixthYear,
}: {
  ticker: string;
  inputs: ValuationInputs;
  entryModels: EntryModelsResult;
  setCompanyField: (key: keyof CompanyFinancialsInputs, value: number | undefined) => void;
  setYearly: (model: YearlyModelKey, index: number, value: number | undefined) => void;
  setYearlyMany: (model: YearlyModelKey, startIndex: number, values: number[]) => void;
  setDividendField: (value: number | undefined) => void;
  setPocfOcfTotal: (value: number | undefined) => void;
  setPegField: (value: number | undefined) => void;
  sharePrice: number | null;
  dilutedShares: number | null | undefined;
  showSixth: ShowSixthState;
  onAddSixthYear: (model: YearlyModelKey) => void;
  onRemoveSixthYear: (model: YearlyModelKey) => void;
}) {
  const bvpsWarning = bvpsRangeWarning(inputs.company_financials.book_value_per_share);
  const peWarning = epsRangeWarning(inputs.company_financials.eps);

  return (
    <section className="rounded-2xl border-2 border-subtle bg-surface-muted/70 p-5 shadow-sm sm:p-6">
      <div className="mb-5 border-b border-subtle pb-4">
        <h2 className="font-serif text-xl text-foreground">Entry-Price Models</h2>
        <p className="text-sm text-secondary">
          Each model stands on its own — no blended average. Weigh them yourself alongside the DCF.
        </p>
      </div>

      <div className="rounded-xl bg-surface p-4 sm:p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary">Company financials</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-2">
          <NumberField
            label="EPS ($)"
            value={inputs.company_financials.eps}
            onChange={(v) => setCompanyField("eps", v)}
            sourceUrl={LINKS.incomeStatement(ticker)}
            sourceLabel="Income Statement"
            warning={peWarning}
          />
          <NumberField
            label="Book value / share ($)"
            value={inputs.company_financials.book_value_per_share}
            onChange={(v) => setCompanyField("book_value_per_share", v)}
            sourceUrl={LINKS.balanceSheet(ticker)}
            sourceLabel="Balance Sheet"
            warning={bvpsWarning}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MultipleModelCard
          title="Price / Book (P/B)"
          tooltip={MODEL_TOOLTIPS.pb}
          result={entryModels.pb}
          yearly={inputs.entry_models.pb.yearly}
          onYearlyChange={(i, v) => setYearly("pb", i, v)}
          onYearlyFillMany={(start, values) => setYearlyMany("pb", start, values)}
          yearlySourceUrl={LINKS.ratios(ticker)}
          currentLabel="Current P/B"
          showSixth={showSixth.pb}
          onAddSixthYear={() => onAddSixthYear("pb")}
          onRemoveSixthYear={() => onRemoveSixthYear("pb")}
          math={
            entryModels.pb.currentMultiple != null
              ? `Current P/B = price ÷ book value/share = $${sharePrice?.toFixed(2)} ÷ $${inputs.company_financials.book_value_per_share} = ${entryModels.pb.currentMultiple.toFixed(2)}x`
              : "Current P/B = price ÷ book value/share (enter book value/share above)"
          }
        />

        <DividendModelCard
          ticker={ticker}
          inputs={inputs}
          result={entryModels.dividend}
          onChange={setDividendField}
        />

        <MultipleModelCard
          title="Price / Earnings (P/E)"
          tooltip={MODEL_TOOLTIPS.pe}
          result={entryModels.pe}
          yearly={inputs.entry_models.pe.yearly}
          onYearlyChange={(i, v) => setYearly("pe", i, v)}
          onYearlyFillMany={(start, values) => setYearlyMany("pe", start, values)}
          yearlySourceUrl={LINKS.ratios(ticker)}
          currentLabel="Current P/E"
          showSixth={showSixth.pe}
          onAddSixthYear={() => onAddSixthYear("pe")}
          onRemoveSixthYear={() => onRemoveSixthYear("pe")}
          math={
            entryModels.pe.currentMultiple != null
              ? `Current P/E = price ÷ EPS = $${sharePrice?.toFixed(2)} ÷ $${inputs.company_financials.eps} = ${entryModels.pe.currentMultiple.toFixed(2)}x`
              : "Current P/E = price ÷ EPS (enter EPS above)"
          }
        />

        <PocfModelCard
          ticker={ticker}
          inputs={inputs}
          entryModels={entryModels}
          onOcfTotalChange={setPocfOcfTotal}
          onYearlyChange={(i, v) => setYearly("pocf", i, v)}
          onYearlyFillMany={(start, values) => setYearlyMany("pocf", start, values)}
          sharePrice={sharePrice}
          dilutedShares={dilutedShares}
          showSixth={showSixth.pocf}
          onAddSixthYear={() => onAddSixthYear("pocf")}
          onRemoveSixthYear={() => onRemoveSixthYear("pocf")}
        />
      </div>

      {/* PEG — informational only, visually secondary, never a peer of the models above */}
      <div className="mt-4 max-w-sm rounded-xl border border-dashed border-subtle bg-surface/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">PEG ratio · informational only</p>
        <div className="mt-2 flex items-end gap-3">
          <div className="w-28">
            <NumberField
              label="PEG ratio"
              value={inputs.entry_models.peg.peg_ratio}
              onChange={setPegField}
              sourceUrl={LINKS.statistics(ticker)}
              sourceLabel="Statistics"
            />
          </div>
          {entryModels.pegVerdict && (
            <div className="pb-2">
              <SignalBadge signal={entryModels.pegVerdict} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Phase 3.2 item 3 — a consistent, bordered/highlighted treatment for
 * "the number this model is telling you to act on": DCF's intrinsic
 * value/share and every entry-price model's implied entry price. Same
 * component everywhere on purpose, so it reads as one visual language for
 * "this is the output" across the whole valuation section — brand
 * accent border/background via the semantic tokens (so it stays legible
 * and on-brand in both themes), nothing else restyled.
 */
function ImpliedPriceBox({
  label = "Implied entry price",
  value,
  placeholder = "Fill in the fields above to compute.",
}: {
  label?: string;
  value: number | null;
  placeholder?: string;
}) {
  return (
    <div className="mt-3 rounded-lg border border-brand/25 bg-brand/[0.04] px-3 py-2.5 dark:border-accent/40 dark:bg-accent/[0.08]">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-secondary">{label}</span>
      {value != null ? (
        <span className="mt-0.5 block text-xl font-bold text-brand dark:text-accent">${value.toFixed(2)}</span>
      ) : (
        <span className="mt-0.5 block text-sm text-tertiary">{placeholder}</span>
      )}
    </div>
  );
}

/**
 * Phase 3.2 item 1/2 — 5 (or 6, once expanded) yearly multiple boxes with
 * an unobtrusive add/remove control for the optional 6th year, and
 * paste-to-fill on every box (item 2): pasting a whole row/column splits
 * across that box and the ones after it, auto-expanding to the 6th box
 * when the fill reaches it.
 */
function YearlyInputs({
  yearly,
  onChange,
  onFillMany,
  sourceUrl,
  showSixth,
  onAddSixthYear,
  onRemoveSixthYear,
}: {
  yearly: YearlyMultiple;
  onChange: (index: number, value: number | undefined) => void;
  onFillMany: (startIndex: number, values: number[]) => void;
  sourceUrl: string;
  showSixth: boolean;
  onAddSixthYear: () => void;
  onRemoveSixthYear: () => void;
}) {
  const visibleCount = showSixth ? 6 : 5;
  const visibleYears = yearly.slice(0, visibleCount);

  function handlePaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    const parsed = parsePastedNumbers(text);
    // Fewer than 2 numbers parsed: nothing to "split", so don't intercept —
    // let the browser's normal single-field paste happen (a lone pasted
    // value, or unparseable text, behaves exactly like typing).
    if (parsed.length <= 1) return;

    e.preventDefault();
    const maxSlots = 6;
    const fillCount = Math.min(parsed.length, maxSlots - index);
    onFillMany(index, parsed.slice(0, fillCount));
    // If the fill reaches the 6th box (index 5), reveal it — matches "if 6
    // numeric values are pasted, auto-expand the 6th box and fill it",
    // generalized to any paste that reaches that far, not just a paste
    // starting at box 1.
    if (!showSixth && index + fillCount - 1 >= 5) onAddSixthYear();
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-secondary">
          {visibleCount}Y average — one ratio per year (paste a whole row to fill)
        </span>
      </div>
      <div className={`mt-1 grid gap-1.5 ${visibleCount === 6 ? "grid-cols-6" : "grid-cols-5"}`}>
        {visibleYears.map((v, i) => (
          <input
            key={i}
            type="number"
            step="any"
            inputMode="decimal"
            aria-label={`Year ${i + 1}`}
            placeholder={`Yr ${i + 1}`}
            value={v ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") return onChange(i, undefined);
              const n = Number(raw);
              if (Number.isFinite(n)) onChange(i, n);
            }}
            onPaste={(e) => handlePaste(i, e)}
            className="w-full rounded-md border border-amber-200 bg-[#fffdf2] px-1.5 py-1.5 text-center text-xs text-foreground shadow-sm transition focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand dark:border-amber-800/50 dark:bg-amber-950/20 dark:focus:border-accent dark:focus:ring-accent"
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs text-tertiary underline decoration-dotted hover:text-brand dark:hover:text-accent"
        >
          Financials &gt; Ratios ({visibleCount} fiscal years) ↗
        </a>
        {showSixth ? (
          <button
            type="button"
            onClick={onRemoveSixthYear}
            className="whitespace-nowrap text-xs font-medium text-tertiary hover:text-red-600 dark:hover:text-red-400"
          >
            − remove 6th year
          </button>
        ) : (
          <button
            type="button"
            onClick={onAddSixthYear}
            className="whitespace-nowrap text-xs font-medium text-brand hover:text-brand-dark dark:text-accent dark:hover:text-accent-dark"
          >
            + add year
          </button>
        )}
      </div>
    </div>
  );
}

function MultipleModelCard({
  title,
  tooltip,
  result,
  yearly,
  onYearlyChange,
  onYearlyFillMany,
  yearlySourceUrl,
  currentLabel,
  showSixth,
  onAddSixthYear,
  onRemoveSixthYear,
  math,
}: {
  title: string;
  tooltip: string;
  result: MultipleModelResult;
  yearly: YearlyMultiple;
  onYearlyChange: (index: number, value: number | undefined) => void;
  onYearlyFillMany: (startIndex: number, values: number[]) => void;
  yearlySourceUrl: string;
  currentLabel: string;
  showSixth: boolean;
  onAddSixthYear: () => void;
  onRemoveSixthYear: () => void;
  math: string;
}) {
  return (
    <div className="rounded-xl bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {title}
          <InfoTooltip text={tooltip} label={`When to use ${title}`} />
        </h3>
        {result.signal && <SignalBadge signal={result.signal} />}
      </div>
      <div className="mt-3 space-y-3">
        <YearlyInputs
          yearly={yearly}
          onChange={onYearlyChange}
          onFillMany={onYearlyFillMany}
          sourceUrl={yearlySourceUrl}
          showSixth={showSixth}
          onAddSixthYear={onAddSixthYear}
          onRemoveSixthYear={onRemoveSixthYear}
        />
      </div>
      <div className="mt-3 space-y-1 text-xs text-secondary">
        <p>{math}</p>
        <p>
          {showSixth ? "6Y" : "5Y"} average: <span className="font-medium text-foreground">{result.avg5y != null ? result.avg5y.toFixed(2) + "x" : "—"}</span>
          {" · "}
          {currentLabel}: <span className="font-medium text-foreground">{result.currentMultiple != null ? result.currentMultiple.toFixed(2) + "x" : "—"}</span>
        </p>
      </div>
      <ImpliedPriceBox value={result.entryPrice} />
    </div>
  );
}

function DividendModelCard({
  ticker,
  inputs,
  result,
  onChange,
}: {
  ticker: string;
  inputs: ValuationInputs;
  result: { entryPrice: number | null; signal: Signal | null };
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="rounded-xl bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Dividend Yield
          <InfoTooltip text={MODEL_TOOLTIPS.dividend} label="When to use the dividend model" />
        </h3>
        {result.signal && <SignalBadge signal={result.signal} />}
      </div>
      <div className="mt-3 space-y-3">
        <NumberField
          label="Annual dividend ($/share)"
          value={inputs.entry_models.dividend.annual_dividend}
          onChange={onChange}
          sourceUrl={LINKS.statistics(ticker)}
          sourceLabel="Statistics — Dividend Per Share"
        />
      </div>
      <p className="mt-3 text-xs text-secondary">
        Entry price = annual dividend ÷ 5% assumed yield = ${inputs.entry_models.dividend.annual_dividend ?? "—"} ÷ 0.05
      </p>
      <ImpliedPriceBox label="Entry price" value={result.entryPrice} placeholder="Fill in the field above." />
    </div>
  );
}

function PocfModelCard({
  ticker,
  inputs,
  entryModels,
  onOcfTotalChange,
  onYearlyChange,
  onYearlyFillMany,
  sharePrice,
  dilutedShares,
  showSixth,
  onAddSixthYear,
  onRemoveSixthYear,
}: {
  ticker: string;
  inputs: ValuationInputs;
  entryModels: EntryModelsResult;
  onOcfTotalChange: (value: number | undefined) => void;
  onYearlyChange: (index: number, value: number | undefined) => void;
  onYearlyFillMany: (startIndex: number, values: number[]) => void;
  sharePrice: number | null;
  dilutedShares: number | null | undefined;
  showSixth: boolean;
  onAddSixthYear: () => void;
  onRemoveSixthYear: () => void;
}) {
  const result = entryModels.pocf;
  return (
    <div className="rounded-xl bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Price / Operating Cash Flow (P/OCF)
          <InfoTooltip text={MODEL_TOOLTIPS.pocf} label="When to use P/OCF" />
        </h3>
        {result.signal && <SignalBadge signal={result.signal} />}
      </div>
      <div className="mt-3 space-y-3">
        <NumberField
          label="Total operating cash flow ($M)"
          value={inputs.entry_models.pocf.ocf_total}
          onChange={onOcfTotalChange}
          sourceUrl={LINKS.cashFlow(ticker)}
          sourceLabel="Cash Flow Statement"
        />
        <YearlyInputs
          yearly={inputs.entry_models.pocf.yearly}
          onChange={onYearlyChange}
          onFillMany={onYearlyFillMany}
          sourceUrl={LINKS.ratios(ticker)}
          showSixth={showSixth}
          onAddSixthYear={onAddSixthYear}
          onRemoveSixthYear={onRemoveSixthYear}
        />
      </div>
      <div className="mt-3 space-y-1 text-xs text-secondary">
        <p>
          OCF/share = OCF ($M) ÷ diluted shares (M) ={" "}
          {inputs.entry_models.pocf.ocf_total != null && dilutedShares != null
            ? `$${inputs.entry_models.pocf.ocf_total} ÷ ${dilutedShares} = $${entryModels.ocfPerShare?.toFixed(2) ?? "—"}`
            : "enter total OCF above (diluted shares come from the DCF section)"}
        </p>
        <p>
          Current P/OCF = price ÷ OCF/share ={" "}
          {result.currentMultiple != null
            ? `$${sharePrice?.toFixed(2)} ÷ $${entryModels.ocfPerShare?.toFixed(2)} = ${result.currentMultiple.toFixed(2)}x`
            : "—"}
        </p>
        <p>
          {showSixth ? "6Y" : "5Y"} average: <span className="font-medium text-foreground">{result.avg5y != null ? result.avg5y.toFixed(2) + "x" : "—"}</span>
        </p>
      </div>
      <ImpliedPriceBox value={result.entryPrice} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky summary — Phase 3.1 item 7: ONE table, fixed row order (DCF, P/B,
// Dividend, P/E, P/OCF), model name + tooltip icon, computed value, signal.
// No headline DCF treatment, no margin of safety anywhere. Models without
// enough inputs show a dash row — never hidden, order never changes.
// ---------------------------------------------------------------------------

function SummaryPanel({
  rows,
  saveState,
  isPending,
  compact = false,
}: {
  rows: ValuationSummaryRow[];
  saveState: "idle" | "saving" | "saved" | "error";
  isPending: boolean;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "pt-4" : "rounded-xl border border-subtle bg-surface p-6 shadow-sm"}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary">Valuation summary</h2>
        <SaveIndicator saveState={saveState} isPending={isPending} />
      </div>

      <div className="mt-4 divide-y divide-subtle">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-2 py-2.5 text-sm">
            <span className="flex items-center gap-1.5 text-secondary">
              {row.label}
              <InfoTooltip text={MODEL_TOOLTIPS[row.key]} label={`When to use ${row.label}`} />
            </span>
            <span className="flex items-center gap-2">
              <span className="font-medium text-foreground">{row.value ?? "—"}</span>
              {row.signal ? <SignalBadge signal={row.signal} /> : <span className="text-tertiary">—</span>}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-tertiary">
        No blended verdict here on purpose — weigh each model yourself.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small pieces
// ---------------------------------------------------------------------------

/** Phase 3.1 item 3/12 — non-blocking inline teaching note. Same visual treatment for the negative-FCF banner and every soft range warning. */
function InlineNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200">
      {children}
    </div>
  );
}

/**
 * Phase 3.1 item 4 — small info icon; hover reveals the tip on desktop, tap
 * toggles it on mobile.
 *
 * Fix 3 (Phase 3.1 QA, mobile first-tap dead): a tap fires a synthetic
 * `mouseenter` immediately before `click` in the same batch — the old
 * onMouseEnter/onClick combo set open=true then flipped it back to false on
 * the very first tap, so mobile students had to tap twice. Pointer events
 * fix this because they carry `pointerType`: hover-open only responds to a
 * real mouse (`pointerType === "mouse"`), so on touch the ONLY thing that
 * opens the tooltip is the click. Closing on outside tap replaces the old
 * onBlur (unreliable on iOS Safari, where a tapped <button> doesn't reliably
 * take focus) with a document-level pointerdown listener, attached only
 * while open and removed on close/unmount.
 */
function InfoTooltip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleOutsidePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [open]);

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setOpen(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setOpen(false);
        }}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-tertiary text-[10px] font-semibold leading-none text-tertiary transition hover:border-brand hover:text-brand dark:hover:border-accent dark:hover:text-accent"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-1.5 w-56 -translate-x-1/2 rounded-md border border-subtle bg-surface p-2.5 text-left text-xs font-normal normal-case leading-snug text-secondary shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

function NumberField({
  label,
  value,
  onChange,
  sourceUrl,
  sourceLabel,
  percent = false,
  error,
  warning,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (value: number | undefined) => void;
  sourceUrl?: string;
  sourceLabel?: string;
  percent?: boolean;
  error?: string;
  warning?: string | null;
}) {
  // Percent-typed fields are stored as decimals (0.10 = 10%) but keying in
  // "10" reads more naturally than "0.10" — display/edit as whole percent,
  // convert on the way in/out.
  //
  // The round-trip has to be de-noised: a student types 3.974, it's stored as
  // 3.974/100 = 0.03974, and 0.03974 * 100 comes back as 3.9740000000000006
  // in IEEE-754 — which is what the risk-free rate field actually showed
  // (and, at 375px, overflowed its own box). toFixed(10) is well inside
  // double precision for any rate a human types, and Number() strips the
  // trailing zeros it leaves behind.
  const displayValue =
    value == null ? "" : percent ? Number((value * 100).toFixed(10)) : value;

  return (
    <label className="block">
      <span className="text-xs font-medium text-secondary">{label}</span>
      <input
        type="number"
        step="any"
        inputMode="decimal"
        value={displayValue}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(undefined);
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(percent ? n / 100 : n);
        }}
        className={`mt-1 w-full rounded-md border px-3 py-2 text-sm text-foreground shadow-sm transition focus:outline-none focus:ring-1 ${
          error
            ? "border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-400 dark:border-red-700/60 dark:bg-red-950/20"
            : "border-amber-200 bg-[#fffdf2] focus:border-brand focus:ring-brand dark:border-amber-800/50 dark:bg-amber-950/20 dark:focus:border-accent dark:focus:ring-accent"
        }`}
      />
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : warning ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{warning}</p>
      ) : sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-tertiary underline decoration-dotted hover:text-brand dark:hover:text-accent"
        >
          {sourceLabel} ↗
        </a>
      ) : null}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs font-medium uppercase tracking-wide text-secondary">{label}</span>
      <span className="mt-0.5 block text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

function SignalBadge({ signal, label }: { signal: Signal; label?: string }) {
  const classes =
    signal === "Undervalued"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : signal === "Overvalued"
        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
        : "bg-surface-sunken text-secondary";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${classes}`}>
      {label ? `${label}: ${signal}` : signal}
    </span>
  );
}

function SaveIndicator({
  saveState,
  isPending,
}: {
  saveState: "idle" | "saving" | "saved" | "error";
  isPending: boolean;
}) {
  if (saveState === "idle") return null;
  if (saveState === "saving" || isPending) {
    return <span className="text-xs text-tertiary">Saving…</span>;
  }
  if (saveState === "error") {
    return <span className="text-xs text-red-500 dark:text-red-400">Couldn&apos;t save</span>;
  }
  return <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved ✓</span>;
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
