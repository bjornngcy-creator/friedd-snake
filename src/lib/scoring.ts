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

/**
 * Pure presentation metadata: how the form should visually group sections.
 * Never consulted by computeScore/sanitizeInputs — scoring always iterates
 * `definition.sections` directly, so grouping can change without touching
 * how any evaluation is scored.
 */
export type FrameworkDisplayGroup = {
  key: string;
  title: string;
  subtitle?: string | null;
  /** Section keys (from `definition.sections`) that belong to this group, in display order. */
  section_keys: string[];
  /** true = render the group's sections as one flat criteria list with no per-section subheading. */
  merge_sections: boolean;
  /** Optional link-out copy shown in the group header (e.g. an Equity Scope prompt). */
  equity_scope_note?: string | null;
};

export type FrameworkDisplay = {
  groups: FrameworkDisplayGroup[];
};

/**
 * Phase 3 valuation assumptions a Phase 5 admin should be able to tune
 * without a code deploy (docs/phase3-valuation-spec.md §5.2). Read by
 * src/lib/valuation.ts via resolveValuationConfig, which falls back to
 * DEFAULT_VALUATION_CONFIG for older framework versions that predate this
 * field (added in supabase/migrations/0007_valuation_config.sql).
 */
export type FrameworkValuationConfig = {
  dividend_yield_assumption: number;
  terminal_growth_guidance: { min: number; max: number };
  margin_of_safety_bands: { undervalued: number; overvalued: number };
};

export type FrameworkDefinition = {
  equity_scope_url: string;
  scoring: ScoringConfig;
  sections: Section[];
  /** Optional — older/ungrouped framework versions won't have this. */
  display?: FrameworkDisplay;
  /** Optional — older framework versions (pre-Phase-3) won't have this. */
  valuation_config?: FrameworkValuationConfig;
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

/**
 * Coerces a stored/submitted answer into a value this criterion actually
 * allows, or null if it isn't a legal answer. Scale criteria only accept a
 * value the criterion itself offers as an option; flag criteria only accept
 * a real boolean. Anything else (out-of-range numbers, junk strings, values
 * for criteria that don't exist) is treated as unanswered rather than being
 * fed into the arithmetic — the inputs JSON arrives from the client, so it
 * can never be trusted to be in range.
 */
function normalizedValue(
  criterion: Criterion,
  value: number | boolean | null | undefined
): number | boolean | null {
  if (value === undefined || value === null) return null;

  if (criterion.input_type === "scale") {
    if (typeof value === "boolean") return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const allowed = (criterion.options ?? []).map((option) => option.value);
    // A criterion with no declared options has no allowlist to enforce —
    // accept any finite number rather than silently discarding every answer.
    if (allowed.length === 0) return numeric;
    return allowed.includes(numeric) ? numeric : null;
  }

  // flag
  return typeof value === "boolean" ? value : null;
}

function pointsFor(criterion: Criterion, value: number | boolean | null | undefined): number {
  const normalized = normalizedValue(criterion, value);
  if (normalized === null) return 0;

  if (criterion.input_type === "scale") {
    return normalized as number;
  }

  // flag
  return normalized === true ? (criterion.flag_effect ?? 0) : 0;
}

/**
 * Strips a raw inputs object down to legal answers only: known criterion
 * keys, values the criterion allows. Used server-side before scoring and
 * persisting so a hand-crafted request can't store an out-of-range answer
 * (and with it a bogus score) on an evaluation.
 */
export function sanitizeInputs(
  framework: FrameworkDefinition,
  inputs: EvaluationInputs
): EvaluationInputs {
  const clean: EvaluationInputs = {};

  for (const section of framework.sections) {
    for (const criterion of section.criteria) {
      const normalized = normalizedValue(criterion, inputs[criterion.key]);
      if (normalized !== null) clean[criterion.key] = normalized;
    }
  }

  return clean;
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
      if (normalizedValue(criterion, value) !== null) answered++;
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
