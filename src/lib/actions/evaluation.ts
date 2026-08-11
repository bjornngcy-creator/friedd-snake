"use server";

import {
  computeScore,
  sanitizeInputs,
  type EvaluationInputs,
  type FrameworkDefinition,
} from "@/lib/scoring";
import { requireEvaluationAccess } from "@/lib/require-evaluation-access";

export type SaveEvaluationResult =
  | {
      ok: true;
      raw_score: number;
      final_score: number;
      verdict: "PASS" | "FAIL";
      status: "draft" | "complete";
    }
  | { ok: false; error: string };

export type MarkCompleteResult =
  | { ok: true; status: "complete" }
  | { ok: false; error: string };

export type ReopenResult = { ok: true; status: "draft" } | { ok: false; error: string };

/**
 * Autosave endpoint for the evaluation form. Recomputes the score
 * server-side (never trusts a client-supplied score) using the same
 * src/lib/scoring.ts module the client uses for the live preview, then
 * upserts inputs + computed scores. RLS (auth.uid() = user_id) is the real
 * guard here; the explicit .eq("user_id", ...) is belt-and-suspenders.
 *
 * `status` is an explicit workflow state now, set only by
 * markEvaluationComplete / reopenEvaluation — autosave never promotes a
 * draft to complete just because every criterion happens to be answered
 * (that used to make "complete" impossible to reach deliberately, since the
 * flag checkboxes had no way to force an explicit answer). Autosave DOES
 * demote complete -> draft if an edit leaves a previously-complete
 * evaluation missing an answer again, since "complete" can never be true
 * for an incomplete set of answers.
 */
export async function saveEvaluationInputs(
  evaluationId: string,
  inputs: EvaluationInputs
): Promise<SaveEvaluationResult> {
  const access = await requireEvaluationAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const { supabase, userId } = access;

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, framework_version, status")
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
  // `inputs` comes straight off the client — drop unknown keys and any value
  // the criterion doesn't actually allow before scoring or persisting it.
  const cleanInputs = sanitizeInputs(framework, inputs);
  const score = computeScore(framework, cleanInputs);

  const currentStatus = (evaluation.status as "draft" | "complete") ?? "draft";
  const persistedStatus: "draft" | "complete" =
    currentStatus === "complete" && score.status !== "complete" ? "draft" : currentStatus;

  const { error } = await supabase
    .from("evaluations")
    .update({
      inputs: cleanInputs,
      raw_score: score.raw_total,
      final_score: score.final_score,
      verdict: score.verdict,
      status: persistedStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", evaluationId)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    raw_score: score.raw_total,
    final_score: score.final_score,
    verdict: score.verdict,
    status: persistedStatus,
  };
}

/**
 * Explicit "Mark as complete" action. Recomputes the score server-side from
 * the currently-saved inputs (never trusts a client claim of completeness)
 * and refuses if any criterion is still unanswered, reporting how many.
 */
export async function markEvaluationComplete(evaluationId: string): Promise<MarkCompleteResult> {
  const access = await requireEvaluationAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const { supabase, userId } = access;

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, framework_version, inputs")
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
  const cleanInputs = sanitizeInputs(framework, (evaluation.inputs ?? {}) as EvaluationInputs);
  const score = computeScore(framework, cleanInputs);

  if (score.status !== "complete") {
    const missing = score.total_criteria - score.total_answered;
    return {
      ok: false,
      error: `${missing} criteri${missing === 1 ? "on" : "a"} unanswered.`,
    };
  }

  const { error } = await supabase
    .from("evaluations")
    .update({ status: "complete", updated_at: new Date().toISOString() })
    .eq("id", evaluationId)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, status: "complete" };
}

/** Reopens a completed evaluation back to draft so it can be edited again. */
export async function reopenEvaluation(evaluationId: string): Promise<ReopenResult> {
  const access = await requireEvaluationAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const { supabase, userId } = access;

  const { error } = await supabase
    .from("evaluations")
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("id", evaluationId)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, status: "draft" };
}

export async function deleteEvaluation(
  evaluationId: string
): Promise<{ ok: boolean; error?: string }> {
  const access = await requireEvaluationAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const { supabase, userId } = access;

  const { error } = await supabase
    .from("evaluations")
    .delete()
    .eq("id", evaluationId)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
