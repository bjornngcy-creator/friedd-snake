"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  computeScore,
  resolveSourceUrl,
  type Criterion,
  type EvaluationInputs,
  type FrameworkDefinition,
  type Section,
} from "@/lib/scoring";
import { saveEvaluationInputs } from "@/lib/actions/evaluation";

type EvaluationData = {
  id: string;
  ticker: string;
  companyName: string;
  sharePrice: number | null;
  inputs: EvaluationInputs;
  createdAt: string;
};

const AUTOSAVE_DELAY_MS = 800;

export function EvaluationForm({
  evaluation,
  framework,
}: {
  evaluation: EvaluationData;
  framework: FrameworkDefinition;
}) {
  const [inputs, setInputs] = useState<EvaluationInputs>(evaluation.inputs);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  const score = useMemo(() => computeScore(framework, inputs), [framework, inputs]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    setSaveState("saving");
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await saveEvaluationInputs(evaluation.id, inputs);
        setSaveState(result.ok ? "saved" : "error");
      });
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputs, evaluation.id]);

  function setCriterionValue(key: string, value: number | boolean | undefined) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  const today = useMemo(
    () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    []
  );

  return (
    <div>
      <EvaluationHeader
        evaluation={evaluation}
        today={today}
        equityScopeUrl={framework.equity_scope_url}
      />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8 pb-24 lg:pb-0">
          {framework.sections.map((section) => (
            <SectionCard
              key={section.key}
              section={section}
              ticker={evaluation.ticker}
              inputs={inputs}
              onChange={setCriterionValue}
            />
          ))}
        </div>

        {/* Desktop sticky sidebar */}
        <div className="hidden lg:block">
          <div className="sticky top-6">
            <ScorePanel score={score} saveState={saveState} isPending={isPending} />
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
            <VerdictChip verdict={score.verdict} status={score.status} />
            <span className="text-sm font-semibold text-slate-900">
              {score.final_score.toFixed(1)} / 10
            </span>
          </span>
          <span className="text-xs font-medium text-slate-500">
            {mobilePanelOpen ? "Hide details ▾" : "Show details ▴"}
          </span>
        </button>

        {mobilePanelOpen && (
          <div className="max-h-[70vh] overflow-y-auto border-t border-slate-100 px-4 pb-6">
            <ScorePanel score={score} saveState={saveState} isPending={isPending} compact />
          </div>
        )}
      </div>
    </div>
  );
}

function EvaluationHeader({
  evaluation,
  today,
  equityScopeUrl,
}: {
  evaluation: EvaluationData;
  today: string;
  equityScopeUrl: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">{evaluation.ticker}</h1>
          <span className="text-slate-500">{evaluation.companyName}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
          <span>
            Share price:{" "}
            <span className="font-medium text-slate-900">
              {evaluation.sharePrice != null ? `$${evaluation.sharePrice.toFixed(2)}` : "—"}
            </span>
          </span>
          <span>{today}</span>
        </div>
      </div>

      <a
        href={equityScopeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center justify-center rounded-md border border-brand px-4 py-2 text-sm font-medium text-brand transition hover:bg-brand hover:text-white"
      >
        Open Equity Scope ↗
      </a>
    </div>
  );
}

function SectionCard({
  section,
  ticker,
  inputs,
  onChange,
}: {
  section: Section;
  ticker: string;
  inputs: EvaluationInputs;
  onChange: (key: string, value: number | boolean | undefined) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
        {section.subtitle && <p className="text-sm text-slate-500">{section.subtitle}</p>}
        {section.instructions && (
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
            {section.instructions}
          </p>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        {section.criteria.map((criterion) => (
          <CriterionRow
            key={criterion.key}
            criterion={criterion}
            ticker={ticker}
            value={inputs[criterion.key]}
            onChange={(value) => onChange(criterion.key, value)}
          />
        ))}
      </div>
    </section>
  );
}

function CriterionRow({
  criterion,
  ticker,
  value,
  onChange,
}: {
  criterion: Criterion;
  ticker: string;
  value: number | boolean | null | undefined;
  onChange: (value: number | boolean | undefined) => void;
}) {
  const sourceUrl = resolveSourceUrl(criterion.source, ticker);
  const answered = value !== undefined && value !== null;

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${answered ? "bg-brand" : "bg-slate-300"}`}
              aria-hidden
            />
            <p className="font-medium text-slate-900">{criterion.label}</p>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{criterion.rule}</p>

          <details className="mt-1 text-xs text-slate-500">
            <summary className="cursor-pointer select-none font-medium text-brand hover:text-brand-dark">
              What does this mean?
            </summary>
            <p className="mt-1 max-w-prose text-slate-500">{criterion.definition}</p>
          </details>

          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-slate-400 underline decoration-dotted hover:text-brand"
            >
              {criterion.source.label} ↗
            </a>
          ) : (
            <p className="mt-1 text-xs text-slate-400">{criterion.source.label}</p>
          )}
        </div>

        <div className="shrink-0">
          {criterion.input_type === "scale" ? (
            <ScaleInput criterion={criterion} value={value as number | null | undefined} onChange={onChange} />
          ) : (
            <FlagInput criterion={criterion} value={value as boolean | null | undefined} onChange={onChange} />
          )}
        </div>
      </div>
    </div>
  );
}

function ScaleInput({
  criterion,
  value,
  onChange,
}: {
  criterion: Criterion;
  value: number | null | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label={criterion.label}>
      {(criterion.options ?? []).map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.label}
            onClick={() => onChange(selected ? undefined : option.value)}
            className={`min-w-[64px] rounded-md border px-3 py-2 text-xs font-semibold transition ${
              selected
                ? "border-brand bg-brand text-white"
                : "border-slate-300 bg-white text-slate-600 hover:border-brand hover:text-brand"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function FlagInput({
  criterion,
  value,
  onChange,
}: {
  criterion: Criterion;
  value: boolean | null | undefined;
  onChange: (value: boolean | undefined) => void;
}) {
  const isPresent = value === true;
  const sign = (criterion.flag_effect ?? 0) >= 0 ? "+" : "";

  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand">
      <input
        type="checkbox"
        checked={isPresent}
        onChange={(e) => onChange(e.target.checked ? true : false)}
        className="h-4 w-4 accent-brand"
      />
      Present ({sign}
      {criterion.flag_effect})
    </label>
  );
}

function VerdictChip({ verdict, status }: { verdict: "PASS" | "FAIL"; status: "draft" | "complete" }) {
  if (status === "draft") {
    return (
      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
        Draft
      </span>
    );
  }
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        verdict === "PASS" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
      }`}
    >
      {verdict}
    </span>
  );
}

function ScorePanel({
  score,
  saveState,
  isPending,
  compact = false,
}: {
  score: ReturnType<typeof computeScore>;
  saveState: "idle" | "saving" | "saved" | "error";
  isPending: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "pt-4"
          : "rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      }
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Live score
        </h2>
        <SaveIndicator saveState={saveState} isPending={isPending} />
      </div>

      <div className="mt-3 flex items-end gap-3">
        <span className="text-4xl font-bold text-slate-900">{score.final_score.toFixed(1)}</span>
        <span className="pb-1 text-sm text-slate-400">/ 10</span>
        <div className="ml-auto pb-1">
          <VerdictChip verdict={score.verdict} status={score.status} />
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Raw total {score.raw_total} / 20 · Pass threshold 7.0 · {score.total_answered}/
        {score.total_criteria} answered
      </p>

      <div className="mt-5 space-y-3">
        {score.sections.map((section) => (
          <div key={section.key}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">{section.title}</span>
              <span className="text-slate-500">
                {section.subtotal} {section.max_points > 0 ? `/ ${section.max_points}` : ""}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, section.max_points > 0 ? (section.subtotal / section.max_points) * 100 : section.answered ? 100 : 0)
                  )}%`,
                }}
              />
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {section.answered}/{section.total_criteria} answered
            </p>
          </div>
        ))}
      </div>
    </div>
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
