"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteEvaluation } from "@/lib/actions/evaluation";

export type EvaluationRow = {
  id: string;
  ticker: string;
  companyName: string | null;
  finalScore: number | null;
  verdict: "PASS" | "FAIL" | null;
  status: string;
  updatedAt: string;
};

export function EvaluationsTable({ rows }: { rows: EvaluationRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: string, ticker: string) {
    if (!window.confirm(`Delete your ${ticker} evaluation? This can't be undone.`)) return;
    setPendingId(id);
    startTransition(async () => {
      await deleteEvaluation(id);
      router.refresh();
      setPendingId(null);
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Ticker</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Score</th>
            <th className="px-4 py-3">Verdict</th>
            <th className="px-4 py-3">Valuation</th>
            <th className="px-4 py-3">Updated</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr
              key={row.id}
              className="cursor-pointer transition hover:bg-slate-50"
              onClick={() => router.push(`/evaluation/${row.ticker}`)}
            >
              <td className="px-4 py-3 font-semibold text-slate-900">{row.ticker}</td>
              <td className="px-4 py-3 text-slate-600">{row.companyName ?? "—"}</td>
              <td className="px-4 py-3">
                <ScoreChip status={row.status} finalScore={row.finalScore} />
              </td>
              <td className="px-4 py-3 text-slate-600">
                {row.status === "draft" ? "—" : (row.verdict ?? "—")}
              </td>
              <td className="px-4 py-3 text-slate-400">—</td>
              <td className="px-4 py-3 text-slate-500">
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
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50"
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

function ScoreChip({ status, finalScore }: { status: string; finalScore: number | null }) {
  if (status === "draft") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
        {finalScore != null ? finalScore.toFixed(1) : "—"} · Draft
      </span>
    );
  }

  const passed = (finalScore ?? 0) >= 7;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
      }`}
    >
      {finalScore != null ? finalScore.toFixed(1) : "—"}
    </span>
  );
}
