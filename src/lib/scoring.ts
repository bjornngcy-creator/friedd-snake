// FRIEDD SNAKE scoring engine — the ONE shared module that computes scores.
// Driven entirely by a framework_versions.definition JSON (see
// supabase/migrations/0003_phase2_core.sql for the seeded v1 definition and
// /private/tmp/.../friedd-snake-framework-spec.md for the source spec).
//
// Verified against the spec's worked GOOGL example in scripts/verify-scoring.mjs:
// FRIEDD 9, Others 4, Risks -2, Moats 5 -> raw 16 -> final 8.0 -> PASS.

export type CriterionOption = {
  value: number;
  label: string;
};

export type CriterionSource = {
  label: string;
  url_template?: string | null;
  url?: string | null;
};

export type Criterion = {
  key: string;
  label: string;
  definition: string;
  rule: string;
  input_type: "scale" | "flag";
  /** For "flag" criteria: points applied when the flag is true (e.g. -1 for a risk, +1 for a moat). */
  flag_effect?: number;
  /** For "scale" criteria: the discrete point choices the student picks from. */
  options?: CriterionOption[];
  source: CriterionSource;
};

export type Section = {
  key: string;
  title: string;
  subtitle?: string | null;
  instructions?: string | null;
  max_points: number;
  criteria: Criterion[];
};

export type ScoringConfig = {
  max_raw: number;
  scale_to: number;
  pass_threshold: number;
};

export type FrameworkDefinition = {
  equity_scope_url: string;
  scoring: ScoringConfig;
  sections: Section[];
};

/** Raw per-criterion answers, keyed by criterion key. Scale criteria store a
 * number (the chosen points value); flag criteria store a boolean (present/not). */
export type EvaluationInputs = Record<string, number | boolean | null | undefined>;

export type SectionScore = {
  key: string;
  title: string;
  subtotal: number;
  max_points: number;
  answered: number;
  total_criteria: number;
};

export type ScoreResult = {
  sections: SectionScore[];
  raw_total: number;
  final_score: number;
  verdict: "PASS" | "FAIL";
  status: "draft" | "complete";
  total_criteria: number;
  total_answered: number;
};

function isAnswered(value: number | boolean | null | undefined): boolean {
  return value !== undefined && value !== null;
}

function pointsFor(criterion: Criterion, value: number | boolean | null | undefined): number {
  if (!isAnswered(value)) return 0;

  if (criterion.input_type === "scale") {
    return Number(value);
  }

  // flag
  return value === true ? (criterion.flag_effect ?? 0) : 0;
}

/**
 * Computes section subtotals, the raw total, the rescaled 0-10 final score,
 * and the PASS/FAIL verdict for a given framework definition + the student's
 * current inputs. Also reports draft/complete status (complete once every
 * criterion across every section has been answered).
 */
export function computeScore(
  framework: FrameworkDefinition,
  inputs: EvaluationInputs
): ScoreResult {
  let rawTotal = 0;
  let totalCriteria = 0;
  let totalAnswered = 0;
  const sections: SectionScore[] = [];

  for (const section of framework.sections) {
    let subtotal = 0;
    let answered = 0;

    for (const criterion of section.criteria) {
      const value = inputs[criterion.key];
      if (isAnswered(value)) answered++;
      subtotal += pointsFor(criterion, value);
    }

    sections.push({
      key: section.key,
      title: section.title,
      subtotal,
      max_points: section.max_points,
      answered,
      total_criteria: section.criteria.length,
    });

    rawTotal += subtotal;
    totalCriteria += section.criteria.length;
    totalAnswered += answered;
  }

  const rawFinalScore = (rawTotal / framework.scoring.max_raw) * framework.scoring.scale_to;
  // Round to 2dp to avoid floating-point noise (e.g. 8.000000000000002).
  const finalScore = Math.round(rawFinalScore * 100) / 100;
  const verdict: "PASS" | "FAIL" = finalScore >= framework.scoring.pass_threshold ? "PASS" : "FAIL";
  const status: "draft" | "complete" = totalAnswered === totalCriteria ? "complete" : "draft";

  return {
    sections,
    raw_total: rawTotal,
    final_score: finalScore,
    verdict,
    status,
    total_criteria: totalCriteria,
    total_answered: totalAnswered,
  };
}

/** Resolves a criterion's source URL for a specific ticker (substitutes {ticker}). */
export function resolveSourceUrl(source: CriterionSource, ticker: string): string | null {
  if (source.url_template) {
    return source.url_template.replace("{ticker}", encodeURIComponent(ticker));
  }
  return source.url ?? null;
}
