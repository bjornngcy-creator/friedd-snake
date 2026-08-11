"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  computeCagr,
  computeEntryModels,
  computeDcf,
  isDcfBlockedByNegativeFcf,
  isDcfEnabled,
  resolveValuationConfig,
  type CompanyFinancialsInputs,
  type DcfInputs,
  type DcfResult,
  type EntryModelInputs,
  type EntryModelResult,
  type Signal,
  type ValuationInputs,
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
// Fixed source-link navigation hints (spec §2.1). Not framework-driven —
// unlike the scoring criteria, these valuation fields are a fixed set the
// spec pins to specific stockanalysis.com pages (plus MarketWatch and
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
  // The Statistics page publishes only *current* ratios (PE, PB, P/OCF as of
  // today). The three "5Y average" fields need the per-fiscal-year history,
  // which lives on Financials > Ratios — pointing them at Statistics sent
  // students to a page that does not contain the number being asked for.
  ratios: (t: string) => stockanalysis("financials/ratios/", t),
  overview: (t: string) => stockanalysis("", t),
  treasury: "https://www.marketwatch.com/investing/bond/tmubmusd10y",
  marketRiskPremium: "https://www.market-risk-premia.com/us.html",
};

export function ValuationForm({
  evaluation,
  valuationConfig,
}: {
  evaluation: EvaluationData;
  valuationConfig?: FrameworkValuationConfig;
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

  function setPbField(value: number | undefined) {
    setInputs((prev) => ({ ...prev, entry_models: { ...prev.entry_models, pb: { avg_5y_pb: value } } }));
  }
  function setDividendField(value: number | undefined) {
    setInputs((prev) => ({
      ...prev,
      entry_models: { ...prev.entry_models, dividend: { annual_dividend: value } },
    }));
  }
  function setPeField(value: number | undefined) {
    setInputs((prev) => ({ ...prev, entry_models: { ...prev.entry_models, pe: { avg_5y_pe: value } } }));
  }
  function setPocfField(key: keyof EntryModelInputs["pocf"], value: number | undefined) {
    setInputs((prev) => ({
      ...prev,
      entry_models: { ...prev.entry_models, pocf: { ...prev.entry_models.pocf, [key]: value } },
    }));
  }
  function setPegField(value: number | undefined) {
    setInputs((prev) => ({ ...prev, entry_models: { ...prev.entry_models, peg: { peg_ratio: value } } }));
  }

  function setDcfField(key: keyof DcfInputs, value: number | undefined) {
    setInputs((prev) => ({ ...prev, dcf: { ...prev.dcf, [key]: value } }));
  }

  const cagr = useMemo(() => computeCagr(inputs.cagr_helper), [inputs.cagr_helper]);
  const entryModels = useMemo(
    () => computeEntryModels(inputs.entry_models, inputs.company_financials, evaluation.sharePrice, config),
    [inputs.entry_models, inputs.company_financials, evaluation.sharePrice, config]
  );
  const dcf = useMemo(
    () => computeDcf(inputs.dcf, evaluation.sharePrice, config),
    [inputs.dcf, evaluation.sharePrice, config]
  );

  // Two different states, deliberately not merged: the DCF inputs are locked
  // until base FCF is positive (`dcfDisabledByFcf`), but only an actually
  // entered non-positive FCF (`dcfNegativeFcf`) justifies telling the student
  // anything about this company's cash flow.
  const dcfDisabledByFcf = !isDcfEnabled(inputs.dcf.base_fcf);
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
            dcfDisabledByFcf={dcfDisabledByFcf}
            dcfNegativeFcf={dcfNegativeFcf}
            companyName={evaluation.companyName}
            setCagrField={setCagrField}
            setDcfField={setDcfField}
            cagr={cagr}
          />

          <EntryModelsGroup
            ticker={evaluation.ticker}
            inputs={inputs}
            entryModels={entryModels}
            setCompanyField={setCompanyField}
            setPbField={setPbField}
            setDividendField={setDividendField}
            setPeField={setPeField}
            setPocfField={setPocfField}
            setPegField={setPegField}
          />
        </div>

        {/* Desktop sticky sidebar */}
        <div className="hidden lg:block">
          <div className="sticky top-6">
            <SummaryPanel
              dcf={dcf}
              entryModels={entryModels}
              saveState={saveState}
              isPending={isPending}
            />
          </div>
        </div>
      </div>

      {/* Mobile collapsible bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)] lg:hidden">
        <button
          type="button"
          onClick={() => setMobilePanelOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3"
        >
          <span className="flex items-center gap-3">
            {dcf.available ? (
              <SignalBadge signal={dcf.signal} />
            ) : (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                {dcf.reason === "missing_fcf" || dcf.reason === "missing_inputs" ? "DCF —" : "DCF N/A"}
              </span>
            )}
            <span className="text-sm font-semibold text-slate-900">
              {dcf.available
                ? `MoS ${(dcf.marginOfSafety * 100).toFixed(1)}%`
                : dcf.reason === "missing_fcf" || dcf.reason === "missing_inputs"
                  ? "Not filled in yet"
                  : "See models below"}
            </span>
          </span>
          <span className="text-xs font-medium text-slate-500">
            {mobilePanelOpen ? "Hide details ▾" : "Show details ▴"}
          </span>
        </button>

        {mobilePanelOpen && (
          <div className="max-h-[70vh] overflow-y-auto border-t border-slate-100 px-4 pb-6">
            <SummaryPanel dcf={dcf} entryModels={entryModels} saveState={saveState} isPending={isPending} compact />
          </div>
        )}
      </div>
    </div>
  );
}

function ValuationHeader({ evaluation }: { evaluation: EvaluationData }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          href={`/evaluation/${encodeURIComponent(evaluation.ticker)}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-brand"
        >
          ← Back to scoring
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-brand"
        >
          Dashboard
        </Link>
      </div>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-2xl text-foreground">{evaluation.ticker}</h1>
            <span className="text-slate-500">{evaluation.companyName}</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Valuation ·{" "}
            <span className="font-medium text-slate-900">
              Share price:{" "}
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
  dcfDisabledByFcf,
  dcfNegativeFcf,
  companyName,
  setCagrField,
  setDcfField,
  cagr,
}: {
  ticker: string;
  inputs: ValuationInputs;
  dcf: DcfResult;
  dcfDisabledByFcf: boolean;
  dcfNegativeFcf: boolean;
  companyName: string;
  setCagrField: (key: "fcf_first" | "fcf_last" | "years", value: number | undefined) => void;
  setDcfField: (key: keyof DcfInputs, value: number | undefined) => void;
  cagr: ReturnType<typeof computeCagr>;
}) {
  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-slate-50/70 p-5 shadow-sm sm:p-6">
      <div className="mb-5 border-b border-slate-200 pb-4">
        <h2 className="font-serif text-xl text-foreground">DCF Valuation</h2>
        <p className="text-sm text-slate-500">Discount future free cash flow back to today&apos;s dollars.</p>
      </div>

      <div className="space-y-6">
        {/* CAGR helper — sits before growth-rate inputs on purpose */}
        <div className="rounded-xl bg-white p-4 sm:p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            CAGR helper <span className="font-normal normal-case text-slate-400">— seeds your growth assumptions below, not wired into the math</span>
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumberField
              label="First-year FCF ($M)"
              value={inputs.cagr_helper.fcf_first}
              onChange={(v) => setCagrField("fcf_first", v)}
              sourceUrl={LINKS.cashFlow(ticker)}
              sourceLabel="Cash Flow Statement"
            />
            <NumberField
              label="Last-year FCF ($M)"
              value={inputs.cagr_helper.fcf_last}
              onChange={(v) => setCagrField("fcf_last", v)}
              sourceUrl={LINKS.cashFlow(ticker)}
              sourceLabel="Cash Flow Statement"
            />
            <NumberField
              label="Number of years"
              value={inputs.cagr_helper.years}
              onChange={(v) => setCagrField("years", v)}
            />
          </div>
          <p className="mt-3 text-sm">
            {cagr.ok ? (
              <span className="font-semibold text-slate-900">CAGR: {(cagr.cagr * 100).toFixed(2)}%</span>
            ) : (
              <span className="text-slate-400">{cagr.error}</span>
            )}
          </p>
        </div>

        {/* DCF inputs — three clusters */}
        <div className="rounded-xl bg-white p-4 sm:p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
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
              disabled={dcfDisabledByFcf}
            />
            <NumberField
              label="Growth Yrs 6-10 (%)"
              value={inputs.dcf.growth_6_10}
              onChange={(v) => setDcfField("growth_6_10", v)}
              percent
              disabled={dcfDisabledByFcf}
            />
            <NumberField
              label="Terminal growth (%)"
              value={inputs.dcf.terminal_growth}
              onChange={(v) => setDcfField("terminal_growth", v)}
              percent
              disabled={dcfDisabledByFcf}
              error={!dcf.available && dcf.reason === "guardrail" ? dcf.message : undefined}
            />
          </div>

          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">Balance Sheet</h3>
          <div className={`mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 ${dcfDisabledByFcf ? "opacity-50" : ""}`}>
            <NumberField
              label="Diluted shares (M)"
              value={inputs.dcf.diluted_shares}
              onChange={(v) => setDcfField("diluted_shares", v)}
              sourceUrl={LINKS.statistics(ticker)}
              sourceLabel="Statistics"
              disabled={dcfDisabledByFcf}
            />
            <NumberField
              label="Cash & ST investments ($M)"
              value={inputs.dcf.cash_and_st_investments}
              onChange={(v) => setDcfField("cash_and_st_investments", v)}
              sourceUrl={LINKS.balanceSheet(ticker)}
              sourceLabel="Balance Sheet"
              disabled={dcfDisabledByFcf}
            />
            <NumberField
              label="Total debt + leases ($M)"
              value={inputs.dcf.total_debt_and_leases}
              onChange={(v) => setDcfField("total_debt_and_leases", v)}
              sourceUrl={LINKS.balanceSheet(ticker)}
              sourceLabel="Balance Sheet"
              disabled={dcfDisabledByFcf}
            />
          </div>

          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">CAPM</h3>
          <div className={`mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 ${dcfDisabledByFcf ? "opacity-50" : ""}`}>
            <NumberField
              label="Risk-free rate (%)"
              value={inputs.dcf.risk_free_rate}
              onChange={(v) => setDcfField("risk_free_rate", v)}
              percent
              sourceUrl={LINKS.treasury}
              sourceLabel="10Y Treasury (MarketWatch)"
              disabled={dcfDisabledByFcf}
            />
            <NumberField
              label="Market risk premium (%)"
              value={inputs.dcf.market_risk_premium}
              onChange={(v) => setDcfField("market_risk_premium", v)}
              percent
              sourceUrl={LINKS.marketRiskPremium}
              sourceLabel="market-risk-premia.com"
              disabled={dcfDisabledByFcf}
            />
            <NumberField
              label="Beta"
              value={inputs.dcf.beta}
              onChange={(v) => setDcfField("beta", v)}
              sourceUrl={LINKS.overview(ticker)}
              sourceLabel="Overview"
              disabled={dcfDisabledByFcf}
            />
          </div>
          {dcf.available && (
            <p className="mt-4 text-xs text-slate-500">
              Discount rate (CAPM): <span className="font-semibold text-slate-900">{(dcf.discountRate * 100).toFixed(2)}%</span>
            </p>
          )}
        </div>

        {/* DCF output */}
        {dcfNegativeFcf ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">DCF valuation isn&apos;t available for {companyName}.</p>
            <p className="mt-2">
              This model works by discounting future free cash flow back to today — a company with negative
              (or zero) free cash flow doesn&apos;t have a meaningful starting point to project from. Use the
              entry-price models below (PB, Dividend Yield, PE, P/OCF) and the PEG verdict instead to judge
              whether {companyName} looks attractively priced.
            </p>
          </div>
        ) : dcfDisabledByFcf ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
            Start with the base free cash flow above — the rest of the DCF inputs unlock once it&apos;s in.
          </div>
        ) : dcf.available ? (
          <DcfOutput dcf={dcf} />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
            {dcf.message}
          </div>
        )}
      </div>
    </section>
  );
}

function DcfOutput({ dcf }: { dcf: Extract<DcfResult, { available: true }> }) {
  return (
    <div className="rounded-xl bg-white p-4 sm:p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Projected free cash flow</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-3">Year</th>
              <th className="py-1 pr-3">FCF ($M)</th>
              <th className="py-1 pr-3">Growth</th>
              <th className="py-1 pr-3">Discount factor</th>
              <th className="py-1">PV ($M)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dcf.years.map((row) => (
              <tr key={row.year} className={row.year === 0 ? "text-slate-400" : "text-slate-700"}>
                <td className="py-1.5 pr-3">{row.year === 0 ? "0 (ref)" : row.year}</td>
                <td className="py-1.5 pr-3">{formatMoney(row.fcf)}</td>
                <td className="py-1.5 pr-3">{(row.growthRateUsed * 100).toFixed(1)}%</td>
                <td className="py-1.5 pr-3">{row.discountFactor.toFixed(4)}</td>
                <td className="py-1.5">{formatMoney(row.presentValue)}</td>
              </tr>
            ))}
            <tr className="font-semibold text-slate-900">
              <td className="py-1.5 pr-3">Terminal</td>
              <td className="py-1.5 pr-3">{formatMoney(dcf.terminalValue)}</td>
              <td className="py-1.5 pr-3" colSpan={2} />
              <td className="py-1.5" />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Year 0 is a reference row (today&apos;s FCF, undiscounted) — it&apos;s not included in the sum below.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
        {/* The sheet works in USD millions throughout (framework-spec §2d,
            C57 "in USD millions"), so these three totals carry the unit
            explicitly — without it "3,099,678.5" is a number with no scale. */}
        <Stat label="Sum of PV (Yr 1-10 + terminal), $M" value={formatMoney(dcf.sumPv)} />
        <Stat
          label={dcf.netDebt < 0 ? "Net cash ($M)" : "Net debt ($M)"}
          value={formatMoney(Math.abs(dcf.netDebt))}
        />
        <Stat label="Intrinsic value (total, $M)" value={formatMoney(dcf.intrinsicValueTotal)} />
        <Stat label="Intrinsic value / share" value={`$${dcf.intrinsicValuePerShare.toFixed(2)}`} />
        <Stat
          label="Margin of Safety"
          value={`${(dcf.marginOfSafety * 100).toFixed(2)}%`}
          tone={dcf.marginOfSafety >= 0 ? "positive" : "negative"}
        />
        <div className="flex flex-col justify-center">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">DCF signal</span>
          <div className="mt-1">
            <SignalBadge signal={dcf.signal} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group 2 — Entry-Price Models + PEG (informational, secondary)
// ---------------------------------------------------------------------------

function EntryModelsGroup({
  ticker,
  inputs,
  entryModels,
  setCompanyField,
  setPbField,
  setDividendField,
  setPeField,
  setPocfField,
  setPegField,
}: {
  ticker: string;
  inputs: ValuationInputs;
  entryModels: ReturnType<typeof computeEntryModels>;
  setCompanyField: (key: keyof CompanyFinancialsInputs, value: number | undefined) => void;
  setPbField: (value: number | undefined) => void;
  setDividendField: (value: number | undefined) => void;
  setPeField: (value: number | undefined) => void;
  setPocfField: (key: keyof EntryModelInputs["pocf"], value: number | undefined) => void;
  setPegField: (value: number | undefined) => void;
}) {
  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-slate-50/70 p-5 shadow-sm sm:p-6">
      <div className="mb-5 border-b border-slate-200 pb-4">
        <h2 className="font-serif text-xl text-foreground">Entry-Price Models</h2>
        <p className="text-sm text-slate-500">
          Each model stands on its own — no blended average. Weigh them yourself alongside the DCF.
        </p>
      </div>

      <div className="rounded-xl bg-white p-4 sm:p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Company financials</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-2">
          <NumberField
            label="EPS ($)"
            value={inputs.company_financials.eps}
            onChange={(v) => setCompanyField("eps", v)}
            sourceUrl={LINKS.incomeStatement(ticker)}
            sourceLabel="Income Statement"
          />
          <NumberField
            label="Book value / share ($)"
            value={inputs.company_financials.book_value_per_share}
            onChange={(v) => setCompanyField("book_value_per_share", v)}
            sourceUrl={LINKS.balanceSheet(ticker)}
            sourceLabel="Balance Sheet"
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ModelCard title="Price / Book (PB)" result={entryModels.pb}>
          <NumberField
            label="5Y average PB ratio"
            value={inputs.entry_models.pb.avg_5y_pb}
            onChange={setPbField}
            sourceUrl={LINKS.ratios(ticker)}
            sourceLabel="Financials > Ratios (average the 5 years)"
          />
        </ModelCard>

        <ModelCard title="Dividend Yield" result={entryModels.dividend}>
          <NumberField
            label="Annual dividend ($/share)"
            value={inputs.entry_models.dividend.annual_dividend}
            onChange={setDividendField}
            sourceUrl={LINKS.statistics(ticker)}
            sourceLabel="Statistics — Dividend Per Share"
          />
        </ModelCard>

        <ModelCard title="Price / Earnings (PE)" result={entryModels.pe}>
          <NumberField
            label="5Y average PE ratio"
            value={inputs.entry_models.pe.avg_5y_pe}
            onChange={setPeField}
            sourceUrl={LINKS.ratios(ticker)}
            sourceLabel="Financials > Ratios (average the 5 years)"
          />
        </ModelCard>

        <ModelCard title="Price / Operating Cash Flow (P/OCF)" result={entryModels.pocf}>
          <div className="grid grid-cols-1 gap-3">
            <NumberField
              label="OCF per share (current, $)"
              value={inputs.entry_models.pocf.ocf_per_share}
              onChange={(v) => setPocfField("ocf_per_share", v)}
              sourceUrl={LINKS.statistics(ticker)}
              sourceLabel="Statistics"
            />
            <NumberField
              label="Current P/OCF ratio"
              value={inputs.entry_models.pocf.current_pocf}
              onChange={(v) => setPocfField("current_pocf", v)}
              sourceUrl={LINKS.statistics(ticker)}
              sourceLabel="Statistics"
            />
            <NumberField
              label="5Y average P/OCF ratio"
              value={inputs.entry_models.pocf.avg_5y_pocf}
              onChange={(v) => setPocfField("avg_5y_pocf", v)}
              sourceUrl={LINKS.ratios(ticker)}
              sourceLabel="Financials > Ratios (average the 5 years)"
            />
          </div>
        </ModelCard>
      </div>

      {/* PEG — informational only, visually secondary, never a peer of the models above */}
      <div className="mt-4 max-w-sm rounded-xl border border-dashed border-slate-300 bg-white/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">PEG ratio · informational only</p>
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

function ModelCard({
  title,
  result,
  children,
}: {
  title: string;
  result: EntryModelResult;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {result.signal && <SignalBadge signal={result.signal} />}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
      <p className="mt-3 text-sm">
        {result.entryPrice != null ? (
          <>
            Entry price: <span className="font-semibold text-slate-900">${result.entryPrice.toFixed(2)}</span>
          </>
        ) : (
          <span className="text-slate-400">Fill in every field above.</span>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky summary — recaps live numbers + each model's own badge. No
// blended/overall verdict anywhere (owner-locked decision).
// ---------------------------------------------------------------------------

function SummaryPanel({
  dcf,
  entryModels,
  saveState,
  isPending,
  compact = false,
}: {
  dcf: DcfResult;
  entryModels: ReturnType<typeof computeEntryModels>;
  saveState: "idle" | "saving" | "saved" | "error";
  isPending: boolean;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "pt-4" : "rounded-xl border border-slate-200 bg-white p-6 shadow-sm"}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Valuation summary</h2>
        <SaveIndicator saveState={saveState} isPending={isPending} />
      </div>

      <div className="mt-3">
        {dcf.available ? (
          <>
            <div className="flex items-end gap-3">
              <span className="text-3xl font-bold text-slate-900">{(dcf.marginOfSafety * 100).toFixed(1)}%</span>
              <span className="pb-1 text-xs text-slate-400">Margin of Safety</span>
            </div>
            <div className="mt-2">
              <SignalBadge signal={dcf.signal} label="DCF" />
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            {dcf.reason === "negative_fcf"
              ? "DCF unavailable for this company — see the entry-price models."
              : dcf.message}
          </p>
        )}
      </div>

      <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Every model, its own signal</p>
        <SummaryRow label="PB" result={entryModels.pb} />
        <SummaryRow label="Dividend Yield" result={entryModels.dividend} />
        <SummaryRow label="PE" result={entryModels.pe} />
        <SummaryRow label="P/OCF" result={entryModels.pocf} />
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">PEG (informational)</span>
          {entryModels.pegVerdict ? <SignalBadge signal={entryModels.pegVerdict} /> : <span className="text-slate-300">—</span>}
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        No blended verdict here on purpose — weigh each model yourself.
      </p>
    </div>
  );
}

function SummaryRow({ label, result }: { label: string; result: EntryModelResult }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      {result.signal ? <SignalBadge signal={result.signal} /> : <span className="text-slate-300">—</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small pieces
// ---------------------------------------------------------------------------

function NumberField({
  label,
  value,
  onChange,
  sourceUrl,
  sourceLabel,
  percent = false,
  disabled = false,
  error,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (value: number | undefined) => void;
  sourceUrl?: string;
  sourceLabel?: string;
  percent?: boolean;
  disabled?: boolean;
  error?: string;
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
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        type="number"
        step="any"
        inputMode="decimal"
        value={displayValue}
        disabled={disabled}
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
        className={`mt-1 w-full rounded-md border px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:outline-none focus:ring-1 ${
          error
            ? "border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-400"
            : "border-amber-200 bg-[#fffdf2] focus:border-brand focus:ring-brand"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      />
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-slate-400 underline decoration-dotted hover:text-brand"
        >
          {sourceLabel} ↗
        </a>
      ) : null}
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  const toneClass = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-red-600" : "text-slate-900";
  return (
    <div>
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`mt-0.5 block text-sm font-semibold ${toneClass}`}>{value}</span>
    </div>
  );
}

function SignalBadge({ signal, label }: { signal: Signal; label?: string }) {
  const classes =
    signal === "Undervalued"
      ? "bg-emerald-100 text-emerald-700"
      : signal === "Overvalued"
        ? "bg-red-100 text-red-700"
        : "bg-slate-100 text-slate-600";
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
    return <span className="text-xs text-slate-400">Saving…</span>;
  }
  if (saveState === "error") {
    return <span className="text-xs text-red-500">Couldn&apos;t save</span>;
  }
  return <span className="text-xs text-emerald-600">Saved ✓</span>;
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
