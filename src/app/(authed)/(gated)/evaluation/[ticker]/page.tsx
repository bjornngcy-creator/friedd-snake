import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCurrentMonthAccess, isAdmin } from "@/lib/access";
import { getPublishedFramework } from "@/lib/framework";
import { getTickerInfo } from "@/lib/ticker";
import { EvaluationForm } from "@/components/evaluation-form";
import type { EvaluationInputs } from "@/lib/scoring";

export default async function EvaluationPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const ticker = decodeURIComponent(rawTicker).trim().toUpperCase();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The (gated) layout already guarantees a user here; keep this page safe
  // to reason about on its own.
  if (!user) {
    return <ErrorState message="You need to be logged in to see this." />;
  }

  // Re-check the monthly access gate here, not just in the (gated) layout.
  // Layouts and pages render concurrently, so the layout's redirect() does
  // NOT stop this page's body from running — without this check a student
  // who has never entered the code (or is locked out) still triggers the
  // Finnhub lookup and the evaluations insert below, burning API quota and
  // leaving phantom rows they'd see the moment they do unlock.
  if (
    !(await isAdmin(supabase, user.id)) &&
    !(await hasCurrentMonthAccess(supabase, user.id))
  ) {
    redirect("/access-code");
  }

  const framework = await getPublishedFramework(supabase);
  if (!framework) {
    return (
      <ErrorState message="No scoring framework has been published yet. Check with the admin." />
    );
  }

  const tickerLookup = await getTickerInfo(ticker);
  if (!tickerLookup.ok) {
    return <ErrorState message={tickerLookup.error} ticker={ticker} />;
  }

  const { data: existing } = await supabase
    .from("evaluations")
    .select("*")
    .eq("user_id", user.id)
    .eq("ticker", ticker)
    .maybeSingle();

  let evaluation = existing;

  if (evaluation) {
    // Refresh price/name on every visit; inputs and scores are untouched.
    const { data: updated } = await supabase
      .from("evaluations")
      .update({
        company_name: tickerLookup.data.companyName,
        share_price: tickerLookup.data.price,
      })
      .eq("id", evaluation.id)
      .select()
      .single();
    if (updated) evaluation = updated;
  } else {
    const { data: inserted, error } = await supabase
      .from("evaluations")
      .insert({
        user_id: user.id,
        ticker,
        company_name: tickerLookup.data.companyName,
        share_price: tickerLookup.data.price,
        framework_version: framework.version,
        status: "draft",
        inputs: {},
      })
      .select()
      .single();

    if (error || !inserted) {
      return <ErrorState message="Couldn't start a new evaluation. Try again." ticker={ticker} />;
    }
    evaluation = inserted;
  }

  if (!evaluation) {
    return <ErrorState message="Couldn't load this evaluation." ticker={ticker} />;
  }

  return (
    <EvaluationForm
      evaluation={{
        id: evaluation.id,
        ticker: evaluation.ticker,
        companyName: evaluation.company_name ?? evaluation.ticker,
        sharePrice: evaluation.share_price != null ? Number(evaluation.share_price) : null,
        inputs: (evaluation.inputs ?? {}) as EvaluationInputs,
        createdAt: evaluation.created_at,
      }}
      framework={framework.definition}
    />
  );
}

function ErrorState({ message, ticker }: { message: string; ticker?: string }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">
        {ticker ? `Couldn't load ${ticker}` : "Couldn't load evaluation"}
      </h1>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <a
        href="/dashboard"
        className="mt-6 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
      >
        Back to dashboard
      </a>
    </div>
  );
}
