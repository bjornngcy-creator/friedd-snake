import { createClient } from "@/lib/supabase/server";
import { getPublishedFramework } from "@/lib/framework";
import { getTickerInfo, type TickerLookupResult } from "@/lib/ticker";
import { TickerQuickInput } from "@/components/ticker-quick-input";
import { EvaluationsTable, type EvaluationRow } from "@/components/evaluations-table";
import {
  computeDcf,
  computeEntryModels,
  countUndervaluedModels,
  normalizeValuationInputs,
  resolveValuationConfig,
} from "@/lib/valuation";

const TICKER_REFRESH_CONCURRENCY = 5;

/**
 * Fix 2 (Phase 3.1 QA): runs `fn` over `items` with at most `limit` calls
 * in flight at once. Used below to refresh every distinct ticker's price
 * without firing an unbounded burst of Finnhub calls (or DB writes) when a
 * student has a long evaluation list.
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: evaluations }, framework] = await Promise.all([
    supabase
      .from("evaluations")
      .select(
        "id, ticker, company_name, final_score, verdict, status, updated_at, share_price, valuation_inputs"
      )
      .order("updated_at", { ascending: false }),
    getPublishedFramework(supabase),
  ]);

  // Fix 2 (Phase 3.1 QA, badge staleness): the dashboard badge must reflect
  // the CURRENT market price, not whatever `share_price` happened to be the
  // last time the student opened that specific ticker's evaluation page —
  // the owner's requirement is that a market crash flips a badge from OV to
  // UV on the dashboard with no student action. Refresh every distinct
  // ticker's price here via the same `getTickerInfo` the evaluation page
  // uses (ticker_cache's 24h TTL already caps this at ~1 Finnhub call per
  // ticker per day, globally — this does not multiply Finnhub usage, it
  // just means the dashboard can now be the thing that triggers that one
  // daily refresh instead of only the ticker page). Failures are per-ticker
  // and never fatal — `getTickerInfo` itself already falls back to a stale
  // cache entry or reports `ok:false` rather than throwing, so a bad
  // ticker/Finnhub outage can only make ONE row keep its last-known price,
  // never crash the dashboard.
  const uniqueTickers = Array.from(new Set((evaluations ?? []).map((row) => row.ticker)));
  const tickerLookups = await mapWithConcurrency(
    uniqueTickers,
    TICKER_REFRESH_CONCURRENCY,
    async (ticker): Promise<[string, TickerLookupResult]> => [ticker, await getTickerInfo(ticker)]
  );
  const freshByTicker = new Map(
    tickerLookups
      .filter(([, result]) => result.ok)
      .map(([ticker, result]) => [ticker, (result as { ok: true; data: { companyName: string; price: number } }).data])
  );

  // Phase 3.1 item 8 — the dashboard's Valuation column is a live-recomputed
  // badge, never a stored verdict. `valuation_summary` is no longer read or
  // written anywhere in the app (deprecated column, drop deferred to a later
  // cleanup). Every row's models are recomputed here from `valuation_inputs`
  // + the freshly-refreshed share price above, using the current published
  // framework's `valuation_config` — every evaluation on this dashboard was
  // scored under framework v1, the only version that has ever existed, so
  // this doesn't yet hit the framework-version-divergence issue flagged for
  // Phase 5 in CLAUDE.md.
  const valuationConfig = resolveValuationConfig(framework?.definition.valuation_config);

  const rows: EvaluationRow[] = (evaluations ?? []).map((row) => {
    const fresh = freshByTicker.get(row.ticker);
    const sharePrice = fresh != null ? fresh.price : row.share_price != null ? Number(row.share_price) : null;
    const inputs = normalizeValuationInputs(row.valuation_inputs);
    const dcf = computeDcf(inputs.dcf, sharePrice, valuationConfig);
    const entryModels = computeEntryModels(
      inputs.entry_models,
      inputs.company_financials,
      sharePrice,
      inputs.dcf.diluted_shares,
      valuationConfig
    );
    const counts = countUndervaluedModels(dcf, entryModels);

    return {
      id: row.id,
      ticker: row.ticker,
      companyName: fresh?.companyName ?? row.company_name,
      finalScore: row.final_score != null ? Number(row.final_score) : null,
      verdict: (row.verdict as "PASS" | "FAIL" | null) ?? null,
      status: row.status,
      updatedAt: row.updated_at,
      valuationBadge: counts.total > 0 ? counts : null,
    };
  });

  // Write the fresh price/name back so the evaluation page (and every future
  // dashboard load) agrees with what was just shown — mirrors the same
  // "refresh price/name on every visit, inputs/scores untouched" pattern
  // the evaluation page already uses, minus `updated_at` (a background price
  // refresh shouldn't bump a row to the top of the "recently updated" sort;
  // only a real student edit should).
  const priceUpdates = (evaluations ?? [])
    .map((row) => {
      const fresh = freshByTicker.get(row.ticker);
      if (!fresh) return null;
      const priceChanged = row.share_price == null || Number(row.share_price) !== fresh.price;
      const nameChanged = row.company_name !== fresh.companyName;
      if (!priceChanged && !nameChanged) return null;
      return { id: row.id, company_name: fresh.companyName, share_price: fresh.price };
    })
    .filter((u): u is { id: string; company_name: string; share_price: number } => u !== null);

  if (priceUpdates.length > 0) {
    await mapWithConcurrency(priceUpdates, TICKER_REFRESH_CONCURRENCY, async (update) => {
      await supabase
        .from("evaluations")
        .update({ company_name: update.company_name, share_price: update.share_price })
        .eq("id", update.id);
    });
  }

  const companiesEvaluated = rows.length;
  const passedCount = rows.filter((r) => r.verdict === "PASS").length;
  const draftCount = rows.filter((r) => r.status === "draft").length;

  const greetingName = user?.email?.split("@")[0] ?? "there";

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl text-foreground">Hi, {greetingName}</h1>
          <p className="mt-1 text-sm text-secondary">Your FRIEDD SNAKE evaluations.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <TickerQuickInput />
          {framework && (
            <a
              href={framework.definition.equity_scope_url}
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap rounded-md border border-brand px-4 py-2 text-sm font-medium text-brand transition hover:bg-brand hover:text-accent dark:border-accent dark:text-accent dark:hover:bg-accent dark:hover:text-brand"
            >
              Equity Scope ↗
            </a>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Companies evaluated" value={companiesEvaluated} />
        <StatCard label="Passed (≥ 7.0)" value={passedCount} accent="text-emerald-600 dark:text-emerald-400" />
        <StatCard label="Drafts" value={draftCount} accent="text-amber-600 dark:text-amber-400" />
      </div>

      <div className="mt-8">{rows.length === 0 ? <EmptyState /> : <EvaluationsTable rows={rows} />}</div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-subtle bg-surface p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-secondary">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-subtle bg-surface p-10 text-center">
      <h2 className="font-serif text-lg text-foreground">Run your first evaluation</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-secondary">
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
    <li className="rounded-lg border border-subtle p-4">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-accent">
        {number}
      </span>
      <p className="mt-2 font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-secondary">{description}</p>
    </li>
  );
}
