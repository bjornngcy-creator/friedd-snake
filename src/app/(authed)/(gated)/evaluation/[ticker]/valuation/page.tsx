import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCurrentMonthAccess, isAdmin } from "@/lib/access";
import { getPublishedFramework } from "@/lib/framework";
import { normalizeValuationInputs } from "@/lib/valuation";
import { ValuationForm } from "@/components/valuation-form";

export default async function ValuationPage({
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

  if (!user) {
    return <ErrorState message="You need to be logged in to see this." ticker={ticker} />;
  }

  // Same belt-and-suspenders re-check as the scoring page: the (gated)
  // layout already guards this route, but layouts and pages render
  // concurrently, so its redirect() doesn't stop this page's body from
  // running first.
  if (
    !(await isAdmin(supabase, user.id)) &&
    !(await hasCurrentMonthAccess(supabase, user.id))
  ) {
    redirect("/access-code");
  }

  const framework = await getPublishedFramework(supabase);
  if (!framework) {
    return (
      <ErrorState
        message="No scoring framework has been published yet. Check with the admin."
        ticker={ticker}
      />
    );
  }

  // Valuation hangs off an existing evaluation — it never creates one. If
  // the student hasn't started scoring this ticker yet, send them there
  // first instead of silently creating a blank evaluation row from this route.
  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("*")
    .eq("user_id", user.id)
    .eq("ticker", ticker)
    .maybeSingle();

  if (!evaluation) {
    return (
      <ErrorState
        message={`Start a FRIEDD SNAKE evaluation for ${ticker} before valuing it.`}
        ticker={ticker}
        ctaHref={`/evaluation/${encodeURIComponent(ticker)}`}
        ctaLabel="Go to scoring"
      />
    );
  }

  return (
    <ValuationForm
      evaluation={{
        id: evaluation.id,
        ticker: evaluation.ticker,
        companyName: evaluation.company_name ?? evaluation.ticker,
        sharePrice: evaluation.share_price != null ? Number(evaluation.share_price) : null,
        inputs: normalizeValuationInputs(evaluation.valuation_inputs),
      }}
      valuationConfig={framework.definition.valuation_config}
    />
  );
}

function ErrorState({
  message,
  ticker,
  ctaHref = "/dashboard",
  ctaLabel = "Back to dashboard",
}: {
  message: string;
  ticker?: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="font-serif text-lg text-foreground">
        {ticker ? `Couldn't load ${ticker} valuation` : "Couldn't load valuation"}
      </h1>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <Link
        href={ctaHref}
        className="mt-6 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-accent transition hover:bg-brand-dark"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}
