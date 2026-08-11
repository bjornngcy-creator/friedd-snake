"use server";

import type { FrameworkDefinition } from "@/lib/scoring";
import {
  computeDcf,
  computeValuationSummary,
  normalizeValuationInputs,
  resolveValuationConfig,
  type ValuationInputs,
  type ValuationSummary,
} from "@/lib/valuation";
import { requireEvaluationAccess } from "@/lib/require-evaluation-access";

export type SaveValuationResult =
  | { ok: true; summary: ValuationSummary }
  | { ok: false; error: string };

/**
 * Autosave endpoint for the valuation form — same shape as
 * saveEvaluationInputs in src/lib/actions/evaluation.ts. Recomputes
 * valuation_summary server-side via src/lib/valuation.ts (never trusts a
 * client-sent summary) using the evaluation's own share price and the
 * valuation_config from the framework version that evaluation was scored
 * under, then persists both valuation_inputs (raw, source of truth) and
 * valuation_summary (denormalized, dashboard-facing) in one update.
 */
export async function saveValuationInputs(
  evaluationId: string,
  rawInputs: unknown
): Promise<SaveValuationResult> {
  const access = await requireEvaluationAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const { supabase, userId } = access;

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, framework_version, share_price")
    .eq("id", evaluationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!evaluation) {
    return { ok: false, error: "Evaluation not found." };
  }

  const { data: frameworkRow } = await supabase
    .from("framework_versions")
    .select("definition")
    .eq("version", evaluation.framework_version)
    .maybeSingle();

  if (!frameworkRow) {
    return { ok: false, error: "Framework definition not found." };
  }

  const framework = frameworkRow.definition as FrameworkDefinition;
  const config = resolveValuationConfig(framework.valuation_config);

  // `rawInputs` comes straight off the client — normalize it into the known
  // shape before persisting or computing anything from it (same
  // "never trust the client" posture as sanitizeInputs for scoring).
  const cleanInputs: ValuationInputs = normalizeValuationInputs(rawInputs);

  const sharePrice = evaluation.share_price != null ? Number(evaluation.share_price) : null;
  const dcf = computeDcf(cleanInputs.dcf, sharePrice, config);
  const summary = computeValuationSummary(dcf);

  const { error } = await supabase
    .from("evaluations")
    .update({
      valuation_inputs: cleanInputs,
      valuation_summary: summary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", evaluationId)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, summary };
}
