"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteEvaluation } from "@/lib/actions/evaluation";

export type EvaluationRow = {
  id: string;
  ticker: string;
  companyName: string | null;
  finalScore: number | null;
  verdict: "PASS" | "FAIL" | null;
  status: string;
  updatedAt: string;
  /** Phase 3.1 item 8 — live-recomputed count of models signaling Undervalued
   * out of models with enough inputs to signal at all. Null when nothing has
   * enough inputs yet (valuation not started, or fewer than every field filled in). */
  valuationBadge: { undervalued: number; total: number } | null;
};

type SortDirection = "asc" | "desc";

export function EvaluationsTable({ rows }: { rows: EvaluationRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [valuationSort, setValuationSort] = useState<SortDirection | null>(null);

  function handleDelete(id: string, ticker: string) {
    if (!window.confirm(`Delete your ${ticker} evaluation? This can't be undone.`)) return;
    setPendingId(id);
    startTransition(async () => {
      await deleteEvaluation(id);
      router.refresh();
      setPendingId(null);
    });
  }

  function toggleValuationSort() {
    setValuationSort((prev) => (prev === "desc" ? "asc" : prev === "asc" ? null : "desc"));
  }

  // Rows with no valuation badge (nothing computed yet) always sort to the
  // bottom, regardless of direction — a "—" isn't a meaningful value to rank
  // against real counts either way.
  const sortedRows = useMemo(() => {
    if (!valuationSort) return rows;
    const withValue = rows.filter((r) => r.valuationBadge != null);
    const withoutValue = rows.filter((r) => r.valuationBadge == null);
    withValue.sort((a, b) => {
      const av = a.valuationBadge!;
      const bv = b.valuationBadge!;
      const diff = av.undervalued - bv.undervalued || av.total - bv.total;
      return valuationSort === "asc" ? diff : -diff;
    });
    return [...withValue, ...withoutValue];
  }, [rows, valuationSort]);

  return (
    <div className="overflow-x-auto rounded-xl border border-subtle bg-surface shadow-sm">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-subtle bg-surface-muted text-xs uppercase tracking-wide text-secondary">
          <tr>
            <th className="px-4 py-3">Ticker</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Score</th>
            <th className="px-4 py-3">Verdict</th>
            <th className="px-4 py-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleValuationSort();
                }}
                className="inline-flex items-center gap-1 uppercase tracking-wide text-secondary transition hover:text-brand dark:hover:text-accent"
              >
                Valuation
                <span aria-hidden className="text-tertiary">
                  {valuationSort === "asc" ? "↑" : valuationSort === "desc" ? "↓" : "↕"}
                </span>
              </button>
            </th>
            <th className="px-4 py-3">Updated</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-subtle">
          {sortedRows.map((row) => (
            <tr
              key={row.id}
              className="cursor-pointer transition hover:bg-surface-muted"
              onClick={() => router.push(`/evaluation/${row.ticker}`)}
            >
              <td className="px-4 py-3 font-semibold text-foreground">{row.ticker}</td>
              <td className="px-4 py-3 text-secondary">{row.companyName ?? "—"}</td>
              <td className="px-4 py-3">
                <ScoreChip status={row.status} finalScore={row.finalScore} />
              </td>
              <td className="px-4 py-3 text-secondary">
                {row.status === "draft" ? "—" : (row.verdict ?? "—")}
              </td>
              <td className="px-4 py-3">
                <ValuationChip badge={row.valuationBadge} />
              </td>
              <td className="px-4 py-3 text-secondary">
                {new Date(row.updatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  disabled={isPending && pendingId === row.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(row.id, row.ticker);
                  }}
                  className="rounded-md border border-subtle px-2 py-1 text-xs text-secondary transition hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:hover:border-red-700 dark:hover:text-red-400"
                >
                  {isPending && pendingId === row.id ? "Deleting…" : "Delete"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ValuationChip({ badge }: { badge: { undervalued: number; total: number } | null }) {
  if (badge == null) {
    return <span className="text-tertiary">—</span>;
  }
  const majorityUndervalued = badge.undervalued * 2 > badge.total;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        majorityUndervalued
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-surface-sunken text-secondary"
      }`}
    >
      UV {badge.undervalued}/{badge.total}
    </span>
  );
}

function ScoreChip({ status, finalScore }: { status: string; finalScore: number | null }) {
  if (status === "draft") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        {finalScore != null ? finalScore.toFixed(1) : "—"} · Draft
      </span>
    );
  }

  const passed = (finalScore ?? 0) >= 7;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        passed
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
      }`}
    >
      {finalScore != null ? finalScore.toFixed(1) : "—"}
    </span>
  );
}
