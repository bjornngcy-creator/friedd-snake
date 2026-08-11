"use server";

import { normalizeValuationInputs, type ValuationInputs } from "@/lib/valuation";
import { requireEvaluationAccess } from "@/lib/require-evaluation-access";

export type SaveValuationResult = { ok: true } | { ok: false; error: string };

/**
 * Autosave endpoint for the valuation section — same shape as
 * saveEvaluationInputs in src/lib/actions/evaluation.ts. Phase 3.1: this no
 * longer computes or persists `valuation_summary`. Every valuation
 * signal/verdict is now recomputed live wherever it's needed (the merged
 * evaluation+valuation page, the dashboard badge) straight from
 * `valuation_inputs` + the evaluation's cached share price — nothing
 * verdict-shaped is ever stored, so there's nothing to go stale when the
 * share price refreshes. `valuation_summary` stays in the schema
 * (dropping the column is a deferred cleanup) but nothing reads or writes
 * it anymore.
 *
 * Phase 3.1 item 2: this action never checks the evaluation's scoring
 * status — valuation autosaves the same way on a zero-answer draft, a FAIL,
 * or a PASS. The only gate is the shared monthly-access check in
 * requireEvaluationAccess.
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
    .select("id")
    .eq("id", evaluationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!evaluation) {
    return { ok: false, error: "Evaluation not found." };
  }

  // `rawInputs` comes straight off the client — normalize it into the known
  // shape before persisting anything (same "never trust the client" posture
  // as sanitizeInputs for scoring).
  const cleanInputs: ValuationInputs = normalizeValuationInputs(rawInputs);

  const { error } = await supabase
    .from("evaluations")
    .update({
      valuation_inputs: cleanInputs,
      updated_at: new Date().toISOString(),
    })
    .eq("id", evaluationId)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
