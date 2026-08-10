import { createClient } from "@/lib/supabase/server";
import { getPublishedFramework } from "@/lib/framework";
import { TickerQuickInput } from "@/components/ticker-quick-input";
import { EvaluationsTable, type EvaluationRow } from "@/components/evaluations-table";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: evaluations }, framework] = await Promise.all([
    supabase
      .from("evaluations")
      .select("id, ticker, company_name, final_score, verdict, status, updated_at")
      .order("updated_at", { ascending: false }),
    getPublishedFramework(supabase),
  ]);

  const rows: EvaluationRow[] = (evaluations ?? []).map((row) => ({
    id: row.id,
    ticker: row.ticker,
    companyName: row.company_name,
    finalScore: row.final_score != null ? Number(row.final_score) : null,
    verdict: (row.verdict as "PASS" | "FAIL" | null) ?? null,
    status: row.status,
    updatedAt: row.updated_at,
  }));

  const companiesEvaluated = rows.length;
  const passedCount = rows.filter((r) => r.verdict === "PASS").length;
  const draftCount = rows.filter((r) => r.status === "draft").length;

  const greetingName = user?.email?.split("@")[0] ?? "there";

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Hi, {greetingName}</h1>
          <p className="mt-1 text-sm text-slate-500">Your FRIEDD SNAKE evaluations.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <TickerQuickInput />
          {framework && (
            <a
              href={framework.definition.equity_scope_url}
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap rounded-md border border-brand px-4 py-2 text-sm font-medium text-brand transition hover:bg-brand hover:text-white"
            >
              Equity Scope ↗
            </a>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Companies evaluated" value={companiesEvaluated} />
        <StatCard label="Passed (≥ 7.0)" value={passedCount} accent="text-emerald-600" />
        <StatCard label="Drafts" value={draftCount} accent="text-amber-600" />
      </div>

      <div className="mt-8">{rows.length === 0 ? <EmptyState /> : <EvaluationsTable rows={rows} />}</div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ?? "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <h2 className="text-lg font-semibold text-slate-900">Run your first evaluation</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        FRIEDD SNAKE scores a company on financial health, moats, and risk in three simple steps.
      </p>

      <ol className="mx-auto mt-6 grid max-w-2xl gap-4 text-left sm:grid-cols-3">
        <Step number={1} title="Enter a ticker" description="Type any US stock ticker, e.g. GOOGL." />
        <Step
          number={2}
          title="Score each criterion"
          description="Work through F.R.I.E.D.D, Others, Risks, and Moats."
        />
        <Step
          number={3}
          title="Get your verdict"
          description="Watch your live 0-10 score and PASS/FAIL update as you go."
        />
      </ol>

      <div className="mt-6 flex justify-center">
        <TickerQuickInput />
      </div>
    </div>
  );
}

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
        {number}
      </span>
      <p className="mt-2 font-medium text-slate-900">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </li>
  );
}
