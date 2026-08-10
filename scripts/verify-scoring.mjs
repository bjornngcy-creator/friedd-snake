#!/usr/bin/env node
// Reproduces the FRIEDD SNAKE framework spec's worked GOOGL example through
// the real scoring engine (src/lib/scoring.ts) and asserts the numbers match
// the spec exactly. This is the "same inputs -> same raw total, same final
// score, same verdict as the sheet" check required before Phase 2 ships.
//
// Source: friedd-snake-framework-spec.md, section 5 "Cross-checks against
// EG. GOOGL":
//   FRIEDD: 1,2,2,2,1,1 -> 9      Others: 1,2,1 -> 4
//   Risks: -1,0,-1,0 -> -2         Moats: 1,1,1,1,1 -> 5
//   Grand Total = 16, Total Score = (16/20)*10 = 8.0, PASS (>=7)

import { computeScore } from "../src/lib/scoring.ts";

const framework = {
  equity_scope_url: "https://example.com",
  scoring: { max_raw: 20, scale_to: 10, pass_threshold: 7.0 },
  sections: [
    {
      key: "friedd",
      title: "F.R.I.E.D.D",
      max_points: 10,
      criteria: [
        { key: "fcf_trend", label: "FCF", definition: "", rule: "", input_type: "scale", source: { label: "" } },
        { key: "roe", label: "ROE", definition: "", rule: "", input_type: "scale", source: { label: "" } },
        { key: "int_coverage", label: "Int Coverage", definition: "", rule: "", input_type: "scale", source: { label: "" } },
        { key: "eps_trend", label: "EPS", definition: "", rule: "", input_type: "scale", source: { label: "" } },
        { key: "dividends", label: "Dividends", definition: "", rule: "", input_type: "scale", source: { label: "" } },
        { key: "de_ratio", label: "D/E", definition: "", rule: "", input_type: "scale", source: { label: "" } },
      ],
    },
    {
      key: "others",
      title: "Others",
      max_points: 5,
      criteria: [
        { key: "revenue_trend", label: "Revenue", definition: "", rule: "", input_type: "scale", source: { label: "" } },
        { key: "retained_earnings_trend", label: "Retained Earnings", definition: "", rule: "", input_type: "scale", source: { label: "" } },
        { key: "share_repurchase", label: "Share Repurchase", definition: "", rule: "", input_type: "scale", source: { label: "" } },
      ],
    },
    {
      key: "snake_risks",
      title: "SNAKE Risks",
      max_points: 0,
      criteria: [
        { key: "sci_tech", label: "Sci & Tech", definition: "", rule: "", input_type: "flag", flag_effect: -1, source: { label: "" } },
        { key: "inferior_net_margin", label: "Net Margin", definition: "", rule: "", input_type: "flag", flag_effect: -1, source: { label: "" } },
        { key: "authority", label: "Authority", definition: "", rule: "", input_type: "flag", flag_effect: -1, source: { label: "" } },
        { key: "key_person", label: "Key Person", definition: "", rule: "", input_type: "flag", flag_effect: -1, source: { label: "" } },
      ],
    },
    {
      key: "moats",
      title: "Moats",
      max_points: 5,
      criteria: [
        { key: "intangible_assets", label: "Intangibles", definition: "", rule: "", input_type: "flag", flag_effect: 1, source: { label: "" } },
        { key: "low_cost_advantage", label: "Low Cost", definition: "", rule: "", input_type: "flag", flag_effect: 1, source: { label: "" } },
        { key: "high_switching_cost", label: "Switching Cost", definition: "", rule: "", input_type: "flag", flag_effect: 1, source: { label: "" } },
        { key: "network_effect", label: "Network Effect", definition: "", rule: "", input_type: "flag", flag_effect: 1, source: { label: "" } },
        { key: "efficient_scale", label: "Efficient Scale", definition: "", rule: "", input_type: "flag", flag_effect: 1, source: { label: "" } },
      ],
    },
  ],
};

// GOOGL's actual sheet input values (spec section 5).
const googlInputs = {
  fcf_trend: 1,
  roe: 2,
  int_coverage: 2,
  eps_trend: 2,
  dividends: 1,
  de_ratio: 1,

  revenue_trend: 1,
  retained_earnings_trend: 2,
  share_repurchase: 1,

  sci_tech: true, // -1
  inferior_net_margin: false, // 0
  authority: true, // -1
  key_person: false, // 0

  intangible_assets: true,
  low_cost_advantage: true,
  high_switching_cost: true,
  network_effect: true,
  efficient_scale: true,
};

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    console.error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`  ok: ${label} = ${actual}`);
  return true;
}

const result = computeScore(framework, googlInputs);

console.log("GOOGL example — section subtotals:");
for (const s of result.sections) {
  console.log(`  ${s.key}: ${s.subtotal} (max ${s.max_points})`);
}

console.log("\nAssertions:");
const friedd = result.sections.find((s) => s.key === "friedd").subtotal;
const others = result.sections.find((s) => s.key === "others").subtotal;
const risks = result.sections.find((s) => s.key === "snake_risks").subtotal;
const moats = result.sections.find((s) => s.key === "moats").subtotal;

let ok = true;
ok = assertEqual(friedd, 9, "FRIEDD subtotal") && ok;
ok = assertEqual(others, 4, "Others subtotal") && ok;
ok = assertEqual(risks, -2, "Risks subtotal") && ok;
ok = assertEqual(moats, 5, "Moats subtotal") && ok;
ok = assertEqual(result.raw_total, 16, "Grand total") && ok;
ok = assertEqual(result.final_score, 8, "Final score (/10)") && ok;
ok = assertEqual(result.verdict, "PASS", "Verdict") && ok;
ok = assertEqual(result.status, "complete", "Status (all criteria answered)") && ok;

console.log(ok ? "\nAll assertions passed — matches the spec's GOOGL example." : "\nSome assertions FAILED.");
if (!ok) process.exit(1);
