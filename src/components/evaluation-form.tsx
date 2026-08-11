"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  computeScore,
  resolveSourceUrl,
  type Criterion,
  type EvaluationInputs,
  type FrameworkDefinition,
  type FrameworkDisplayGroup,
  type FrameworkDisplayTable,
  type Section,
  type ScoreResult,
  type SectionScore,
} from "@/lib/scoring";
import {
  markEvaluationComplete,
  reopenEvaluation,
  saveEvaluationInputs,
} from "@/lib/actions/evaluation";

type EvaluationData = {
  id: string;
  ticker: string;
  companyName: string;
  sharePrice: number | null;
  inputs: EvaluationInputs;
  createdAt: string;
  status: "draft" | "complete";
};

const AUTOSAVE_DELAY_MS = 800;

/** Older/ungrouped framework versions won't have `display.groups` — fall
 * back to one ungrouped table per section so the form still renders. */
function resolveGroups(framework: FrameworkDefinition): FrameworkDisplayGroup[] {
  if (framework.display?.groups?.length) return framework.display.groups;
  return framework.sections.map((section) => ({
    key: section.key,
    title: section.title,
    subtitle: section.subtitle,
    tables: [{ key: section.key, title: null, section_keys: [section.key], merge_sections: false }],
  }));
}

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

  // The persisted workflow status (set only by Mark complete / Reopen, or
  // auto-demoted by autosave if a completed evaluation becomes incomplete
  // again) — distinct from `score.status`, which is just "are all criteria
  // currently answered" and updates live on every keystroke.
  const [workflowStatus, setWorkflowStatus] = useState<"draft" | "complete">(evaluation.status);
  const [completionPending, startCompletionTransition] = useTransition();
  const [completionError, setCompletionError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  const score = useMemo(() => computeScore(framework, inputs), [framework, inputs]);
  const groups = useMemo(() => resolveGroups(framework), [framework]);

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
        if (result.ok) setWorkflowStatus(result.status);
      });
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputs, evaluation.id]);

  function setCriterionValue(key: string, value: number | boolean | undefined) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function handleMarkComplete() {
    setCompletionError(null);
    startCompletionTransition(async () => {
      const result = await markEvaluationComplete(evaluation.id);
      if (result.ok) {
        setWorkflowStatus(result.status);
      } else {
        setCompletionError(result.error);
      }
    });
  }

  function handleReopen() {
    setCompletionError(null);
    startCompletionTransition(async () => {
      const result = await reopenEvaluation(evaluation.id);
      if (result.ok) {
        setWorkflowStatus(result.status);
      } else {
        setCompletionError(result.error);
      }
    });
  }

  const today = useMemo(
    () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    []
  );

  const missingCount = score.total_criteria - score.total_answered;

  return (
    <div>
      <EvaluationHeader evaluation={evaluation} today={today} />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8 pb-24 lg:pb-0">
          {groups.map((group) => (
            <GroupCard
              key={group.key}
              group={group}
              sections={framework.sections}
              ticker={evaluation.ticker}
              inputs={inputs}
              onChange={setCriterionValue}
              equityScopeUrl={framework.equity_scope_url}
            />
          ))}
        </div>

        {/* Desktop sticky sidebar */}
        <div className="hidden lg:block">
          <div className="sticky top-6">
            <ScorePanel
              score={score}
              groups={groups}
              saveState={saveState}
              isPending={isPending}
              workflowStatus={workflowStatus}
              missingCount={missingCount}
              completionPending={completionPending}
              completionError={completionError}
              onMarkComplete={handleMarkComplete}
              onReopen={handleReopen}
            />
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
            <VerdictChip verdict={score.verdict} workflowStatus={workflowStatus} />
            <span className="text-sm font-semibold text-foreground">
              {score.final_score.toFixed(1)} / 10
            </span>
          </span>
          <span className="text-xs font-medium text-secondary">
            {mobilePanelOpen ? "Hide details ▾" : "Show details ▴"}
          </span>
        </button>

        {mobilePanelOpen && (
          <div className="max-h-[70vh] overflow-y-auto border-t border-subtle px-4 pb-6">
            <ScorePanel
              score={score}
              groups={groups}
              saveState={saveState}
              isPending={isPending}
              workflowStatus={workflowStatus}
              missingCount={missingCount}
              completionPending={completionPending}
              completionError={completionError}
              onMarkComplete={handleMarkComplete}
              onReopen={handleReopen}
              compact
            />
          </div>
        )}
      </div>
    </div>
  );
}

function EvaluationHeader({ evaluation, today }: { evaluation: EvaluationData; today: string }) {
  return (
    <div className="rounded-xl border border-subtle bg-surface p-6 shadow-sm">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-xs font-medium text-secondary transition hover:text-brand dark:hover:text-accent"
      >
        ← Back to dashboard
      </Link>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-2xl text-foreground">{evaluation.ticker}</h1>
            <span className="text-secondary">{evaluation.companyName}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary">
            <span>
              Share price:{" "}
              <span className="font-medium text-foreground">
                {evaluation.sharePrice != null ? `$${evaluation.sharePrice.toFixed(2)}` : "—"}
              </span>
            </span>
            <span>{today}</span>
          </div>
        </div>

        {/* Phase 3.1 item 1/2 — valuation lives further down THIS page now, always
            reachable regardless of scoring status. This is just a same-page jump, not
            a route/step. */}
        <a
          href="#valuation"
          className="inline-flex shrink-0 items-center justify-center rounded-md border border-brand px-4 py-2 text-sm font-medium text-brand transition hover:bg-brand hover:text-accent dark:border-accent dark:text-accent dark:hover:bg-accent dark:hover:text-brand"
        >
          Jump to valuation ↓
        </a>
      </div>
    </div>
  );
}

function GroupCard({
  group,
  sections,
  ticker,
  inputs,
  onChange,
  equityScopeUrl,
}: {
  group: FrameworkDisplayGroup;
  sections: Section[];
  ticker: string;
  inputs: EvaluationInputs;
  onChange: (key: string, value: number | boolean | undefined) => void;
  equityScopeUrl: string;
}) {
  return (
    <section className="rounded-2xl border-2 border-subtle bg-surface-muted/70 p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-subtle pb-4">
        <div>
          <h2 className="font-serif text-xl text-foreground">{group.title}</h2>
          {/* Small, muted sub-label carrying the original acronym (Phase 3.1 item 14) — e.g. "F.R.I.E.D.D" under "Quantitative Analysis". */}
          {group.subtitle && <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">{group.subtitle}</p>}
        </div>

        {group.equity_scope_note && (
          <a
            href={equityScopeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center justify-center rounded-md border border-brand px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-brand hover:text-accent dark:border-accent dark:text-accent dark:hover:bg-accent dark:hover:text-brand"
          >
            {group.equity_scope_note} ↗
          </a>
        )}
      </div>

      {/* Phase 3.1 item 13 — each table in `group.tables` renders as its own
          separately-boxed block. A group with one table (Quantitative
          Analysis) renders one box; a group with two tables (Qualitative
          Analysis: Risks, Economic Moats) renders two separate boxes under
          the shared heading above. */}
      <div className="space-y-5">
        {group.tables.map((table) => (
          <DisplayTable
            key={table.key}
            table={table}
            sections={sections}
            ticker={ticker}
            inputs={inputs}
            onChange={onChange}
          />
        ))}
      </div>
    </section>
  );
}

function DisplayTable({
  table,
  sections,
  ticker,
  inputs,
  onChange,
}: {
  table: FrameworkDisplayTable;
  sections: Section[];
  ticker: string;
  inputs: EvaluationInputs;
  onChange: (key: string, value: number | boolean | undefined) => void;
}) {
  const tableSections = table.section_keys
    .map((key) => sections.find((s) => s.key === key))
    .filter((s): s is Section => Boolean(s));

  if (table.merge_sections) {
    return (
      <div>
        {table.title && (
          <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary">{table.title}</h3>
        )}
        <div className={`divide-y divide-subtle rounded-xl bg-surface px-4 sm:px-5 ${table.title ? "mt-2" : ""}`}>
          {tableSections.flatMap((section) => section.criteria).map((criterion) => (
            <CriterionRow
              key={criterion.key}
              criterion={criterion}
              ticker={ticker}
              value={inputs[criterion.key]}
              onChange={(value) => onChange(criterion.key, value)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {tableSections.map((section) => (
        <div key={section.key}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary">
            {table.title ?? section.title}
          </h3>
          {section.subtitle && <p className="text-xs text-tertiary">{section.subtitle}</p>}
          <div className="mt-2 divide-y divide-subtle rounded-xl bg-surface px-4 sm:px-5">
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
        </div>
      ))}
    </div>
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
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${answered ? "bg-brand dark:bg-accent" : "bg-subtle"}`}
              aria-hidden
            />
            <p className="font-medium text-foreground">{criterion.label}</p>
          </div>
          <p className="mt-0.5 text-xs text-secondary">{criterion.rule}</p>

          <details className="mt-1 text-xs text-secondary">
            <summary className="cursor-pointer select-none font-medium text-brand hover:text-brand-dark dark:text-accent dark:hover:text-accent-dark">
              What does this mean?
            </summary>
            <p className="mt-1 max-w-prose text-secondary">{criterion.definition}</p>
          </details>

          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-tertiary underline decoration-dotted hover:text-brand dark:hover:text-accent"
            >
              {criterion.source.label} ↗
            </a>
          ) : criterion.source.label ? (
            <p className="mt-1 text-xs text-tertiary">{criterion.source.label}</p>
          ) : null}
        </div>

        <div className="max-w-full shrink-0">
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
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={criterion.label}>
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
                ? "border-brand bg-brand text-accent dark:border-accent dark:bg-accent dark:text-brand"
                : "border-subtle bg-surface text-secondary hover:border-brand hover:text-brand dark:hover:border-accent dark:hover:text-accent"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Present? Yes/No — an explicit two-button choice, same interaction model
 * as ScaleInput. Previously this was a single checkbox: unchecked was the
 * natural way to leave a risk/moat alone, but that state was
 * indistinguishable on screen from "answered No", so nothing forced a real
 * choice and an evaluation could never actually reach 100% answered. Now
 * neither button selected = unanswered, and either button must be clicked
 * to record Yes (present) or No (not present) — clicking the selected
 * button again clears it back to unanswered.
 */
function FlagInput({
  criterion,
  value,
  onChange,
}: {
  criterion: Criterion;
  value: boolean | null | undefined;
  onChange: (value: boolean | undefined) => void;
}) {
  const sign = (criterion.flag_effect ?? 0) >= 0 ? "+" : "";
  const options: { key: string; selected: boolean; label: string; val: boolean }[] = [
    { key: "no", val: false, selected: value === false, label: "No" },
    { key: "yes", val: true, selected: value === true, label: `Yes (${sign}${criterion.flag_effect})` },
  ];

  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${criterion.label} — present?`}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={option.selected}
          onClick={() => onChange(option.selected ? undefined : option.val)}
          className={`min-w-[64px] rounded-md border px-3 py-2 text-xs font-semibold transition ${
            option.selected
              ? "border-brand bg-brand text-accent dark:border-accent dark:bg-accent dark:text-brand"
              : "border-subtle bg-surface text-secondary hover:border-brand hover:text-brand dark:hover:border-accent dark:hover:text-accent"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function VerdictChip({
  verdict,
  workflowStatus,
}: {
  verdict: "PASS" | "FAIL";
  workflowStatus: "draft" | "complete";
}) {
  if (workflowStatus !== "complete") {
    return (
      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        Draft
      </span>
    );
  }
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        verdict === "PASS"
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
      }`}
    >
      {verdict}
    </span>
  );
}

function ScorePanel({
  score,
  groups,
  saveState,
  isPending,
  workflowStatus,
  missingCount,
  completionPending,
  completionError,
  onMarkComplete,
  onReopen,
  compact = false,
}: {
  score: ScoreResult;
  groups: FrameworkDisplayGroup[];
  saveState: "idle" | "saving" | "saved" | "error";
  isPending: boolean;
  workflowStatus: "draft" | "complete";
  missingCount: number;
  completionPending: boolean;
  completionError: string | null;
  onMarkComplete: () => void;
  onReopen: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "pt-4"
          : "rounded-xl border border-subtle bg-surface p-6 shadow-sm"
      }
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary">
          Live score
        </h2>
        <SaveIndicator saveState={saveState} isPending={isPending} />
      </div>

      <div className="mt-3 flex items-end gap-3">
        <span className="text-4xl font-bold text-foreground">{score.final_score.toFixed(1)}</span>
        <span className="pb-1 text-sm text-tertiary">/ 10</span>
        <div className="ml-auto pb-1">
          <VerdictChip verdict={score.verdict} workflowStatus={workflowStatus} />
        </div>
      </div>
      <p className="mt-1 text-xs text-tertiary">
        Raw total {score.raw_total} / 20 · Pass threshold 7.0 · {score.total_answered}/
        {score.total_criteria} answered
      </p>

      <div className="mt-5 space-y-4">
        {groups.map((group) => {
          const bars = group.tables.map((table) => {
            const tableSections = table.section_keys
              .map((key) => score.sections.find((s) => s.key === key))
              .filter((s): s is SectionScore => Boolean(s));
            const subtotal = tableSections.reduce((sum, s) => sum + s.subtotal, 0);
            const maxPoints = tableSections.reduce((sum, s) => sum + s.max_points, 0);
            const answered = tableSections.reduce((sum, s) => sum + s.answered, 0);
            const totalCriteria = tableSections.reduce((sum, s) => sum + s.total_criteria, 0);
            return { barKey: table.key, title: table.title ?? group.title, subtotal, maxPoints, answered, totalCriteria };
          });

          if (bars.length === 1) {
            const { barKey, ...bar } = bars[0];
            return <SectionBar key={barKey} {...bar} />;
          }

          return (
            <div key={group.key} className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">
                {group.title}
              </p>
              {bars.map(({ barKey, ...bar }) => (
                <SectionBar key={barKey} {...bar} />
              ))}
            </div>
          );
        })}
      </div>

      <div className="mt-5 space-y-2 border-t border-subtle pt-4">
        {workflowStatus === "complete" ? (
          <>
            <p className="text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">Marked complete.</p>
            <button
              type="button"
              onClick={onReopen}
              disabled={completionPending}
              className="w-full rounded-md border border-subtle px-3 py-2 text-xs font-semibold text-secondary transition hover:bg-surface-sunken disabled:opacity-50"
            >
              {completionPending ? "Reopening…" : "Reopen"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onMarkComplete}
              disabled={missingCount > 0 || completionPending}
              className="w-full rounded-md bg-brand px-3 py-2 text-xs font-semibold text-accent transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-tertiary"
            >
              {completionPending ? "Marking…" : "Mark as complete"}
            </button>
            {missingCount > 0 && (
              <p className="text-center text-xs text-tertiary">
                {missingCount} criteri{missingCount === 1 ? "on" : "a"} unanswered
              </p>
            )}
          </>
        )}
        {completionError && (
          <p className="text-center text-xs text-red-500 dark:text-red-400">{completionError}</p>
        )}
      </div>
    </div>
  );
}

function SectionBar({
  title,
  subtotal,
  maxPoints,
  answered,
  totalCriteria,
}: {
  title: string;
  subtotal: number;
  maxPoints: number;
  answered: number;
  totalCriteria: number;
}) {
  // Sections with max_points = 0 (SNAKE Risks: every criterion present costs
  // points, so there's no "positive" total to fill toward) used to always
  // show a full bar the moment any single criterion was answered, which
  // reads as "100% risk" regardless of the actual answers. Show answered
  // progress instead for those sections; point-based fill everywhere else.
  const pct =
    maxPoints > 0
      ? Math.max(0, Math.min(100, (subtotal / maxPoints) * 100))
      : Math.max(0, Math.min(100, totalCriteria > 0 ? (answered / totalCriteria) * 100 : 0));

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-secondary">{title}</span>
        <span className="text-secondary">
          {subtotal} {maxPoints > 0 ? `/ ${maxPoints}` : ""}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-brand dark:bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-0.5 text-xs text-tertiary">
        {answered}/{totalCriteria} answered
      </p>
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
    return <span className="text-xs text-tertiary">Saving…</span>;
  }
  if (saveState === "error") {
    return <span className="text-xs text-red-500 dark:text-red-400">Couldn&apos;t save</span>;
  }
  return <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved ✓</span>;
}
