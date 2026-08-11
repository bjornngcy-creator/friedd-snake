import { redirect } from "next/navigation";

// Phase 3.1 item 1 — valuation is no longer a separate route/step. It's a
// section on the same evaluation page now (see
// src/app/(authed)/(gated)/evaluation/[ticker]/page.tsx). This route is kept
// as a redirect only so any old bookmark/link (including the ones students
// may have saved from Phase 3) still lands somewhere useful instead of 404ing.
export default async function LegacyValuationRedirect({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  redirect(`/evaluation/${encodeURIComponent(ticker)}`);
}
