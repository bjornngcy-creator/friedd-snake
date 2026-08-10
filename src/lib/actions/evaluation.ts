"use server";

import { createClient } from "@/lib/supabase/server";
import { computeScore, type EvaluationInputs, type FrameworkDefinition } from "@/lib/scoring";

export type SaveEvaluationResult =
  | {
      ok: true;
      raw_score: number;
      final_score: number;
      verdict: "PASS" | "FAIL";
      status: "draft" | "complete";
    }
  | { ok: false; error: string };

/**
 * Autosave endpoint for the evaluation form. Recomputes the score
 * server-side (never trusts a client-supplied score) using the same
 * src/lib/scoring.ts module the client uses for the live preview, then
 * upserts inputs + computed scores. RLS (auth.uid() = user_id) is the real
 * guard here; the explicit .eq("user_id", ...) is belt-and-suspenders.
 */
export async function saveEvaluationInputs(
  evaluationId: string,
  inputs: EvaluationInputs
): Promise<SaveEvaluationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated." };
  }

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, framework_version")
    .eq("id", evaluationId)
    .eq("user_id", user.id)
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
  const score = computeScore(framework, inputs);

  const { error } = await supabase
    .from("evaluations")
    .update({
      inputs,
      raw_score: score.raw_total,
      final_score: score.final_score,
      verdict: score.verdict,
      status: score.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", evaluationId)
    .eq("user_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    raw_score: score.raw_total,
    final_score: score.final_score,
    verdict: score.verdict,
    status: score.status,
  };
}

export async function deleteEvaluation(
  evaluationId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated." };
  }

  const { error } = await supabase
    .from("evaluations")
    .delete()
    .eq("id", evaluationId)
    .eq("user_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
