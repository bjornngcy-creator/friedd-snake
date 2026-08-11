#!/usr/bin/env node
// Fix 1 (Phase 3.1 QA, deploy-ordering deadlock): asserts
// src/lib/display-groups.ts's resolveDisplayGroups() renders an equivalent
// table structure whether the stored framework `display.groups` is in the
// pre-3.1 (0005) shape (section_keys/merge_sections directly on the group)
// or the current (0008) shape (tables: [...] already present) — so a
// deploy where the code and the migration land in either order never
// crashes /evaluation/[ticker].

import { resolveDisplayGroups } from "../src/lib/display-groups.ts";

function assertEqual(actual, expected, label) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    console.error(`FAIL: ${label}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`  ok: ${label}`);
  return true;
}

let ok = true;

const sections = [
  { key: "friedd", title: "F.R.I.E.D.D", max_points: 10, criteria: [] },
  { key: "others", title: "Others", max_points: 5, criteria: [] },
  { key: "snake_risks", title: "Risks", max_points: 0, criteria: [] },
  { key: "moats", title: "Economic Moats", max_points: 5, criteria: [] },
];

const baseFramework = {
  equity_scope_url: "https://example.com",
  scoring: { max_raw: 20, scale_to: 10, pass_threshold: 7.0 },
  sections,
};

// ---------------------------------------------------------------------------
// Case 1: current (0008) shape — groups already carry `tables`.
// ---------------------------------------------------------------------------
console.log("=== 0008 shape (tables already present) ===");

const newShapeFramework = {
  ...baseFramework,
  display: {
    groups: [
      {
        key: "friedd_group",
        title: "Quantitative Analysis",
        subtitle: "F.R.I.E.D.D",
        tables: [{ key: "friedd_others_table", title: null, section_keys: ["friedd", "others"], merge_sections: true }],
      },
      {
        key: "snake_group",
        title: "Qualitative Analysis",
        subtitle: "SNAKE",
        equity_scope_note: "Use Equity Scope to help you",
        tables: [
          { key: "risks_table", title: "Risks", section_keys: ["snake_risks"], merge_sections: true },
          { key: "moats_table", title: "Economic Moats", section_keys: ["moats"], merge_sections: true },
        ],
      },
    ],
  },
};

const newShapeResolved = resolveDisplayGroups(newShapeFramework);
ok = assertEqual(newShapeResolved.length, 2, "0008 shape: 2 groups") && ok;
ok = assertEqual(newShapeResolved[0].tables.length, 1, "0008 shape: Quantitative group has 1 table") && ok;
ok = assertEqual(newShapeResolved[1].tables.length, 2, "0008 shape: Qualitative group has 2 tables") && ok;
ok = assertEqual(newShapeResolved[1].tables[0].title, "Risks", "0008 shape: first Qualitative table titled Risks") && ok;
ok = assertEqual(newShapeResolved[1].tables[1].title, "Economic Moats", "0008 shape: second Qualitative table titled Economic Moats") && ok;

// ---------------------------------------------------------------------------
// Case 2: pre-3.1 (0005) shape — section_keys/merge_sections on the group,
// no `tables` key. This is what production currently holds. Must resolve to
// an EQUIVALENT table structure (same section coverage), not crash.
// ---------------------------------------------------------------------------
console.log("\n=== 0005 shape (section_keys/merge_sections, no tables) ===");

const oldShapeFramework = {
  ...baseFramework,
  display: {
    groups: [
      {
        key: "friedd_group",
        title: "FRIEDD",
        subtitle: "Understand the financials",
        section_keys: ["friedd", "others"],
        merge_sections: true,
      },
      {
        key: "snake_group",
        title: "SNAKE",
        subtitle: "Understand the quality",
        section_keys: ["snake_risks", "moats"],
        merge_sections: false,
        equity_scope_note: "Use Equity Scope to help you",
      },
    ],
  },
};

let oldShapeResolved;
try {
  oldShapeResolved = resolveDisplayGroups(oldShapeFramework);
} catch (e) {
  console.error(`FAIL: resolveDisplayGroups threw on the 0005 shape: ${e.message}`);
  process.exit(1);
}

ok = assertEqual(oldShapeResolved.length, 2, "0005 shape: 2 groups") && ok;
ok = assertEqual(oldShapeResolved[0].tables.length, 1, "0005 shape: merged group -> 1 table") && ok;
ok =
  assertEqual(
    oldShapeResolved[0].tables[0].section_keys,
    ["friedd", "others"],
    "0005 shape: merged table covers friedd + others"
  ) && ok;
ok = assertEqual(oldShapeResolved[1].tables.length, 2, "0005 shape: non-merged group -> 1 table per section (Risks, Moats)") && ok;
ok = assertEqual(oldShapeResolved[1].tables[0].title, "Risks", "0005 shape: first synthesized table titled from section (Risks)") && ok;
ok = assertEqual(oldShapeResolved[1].tables[1].title, "Economic Moats", "0005 shape: second synthesized table titled from section (Economic Moats)") && ok;
ok = assertEqual(oldShapeResolved[1].tables[0].section_keys, ["snake_risks"], "0005 shape: Risks table scoped to snake_risks only") && ok;
ok = assertEqual(oldShapeResolved[1].tables[1].section_keys, ["moats"], "0005 shape: Moats table scoped to moats only") && ok;

// Both shapes must cover the exact same sections in the exact same order —
// this is the actual "deploy order is irrelevant" guarantee: whichever
// shape is live, a student sees the same criteria, just possibly with
// pre-3.1 titles until the migration lands.
const flatten = (groups) => groups.flatMap((g) => g.tables.flatMap((t) => t.section_keys));
ok =
  assertEqual(
    flatten(newShapeResolved),
    flatten(oldShapeResolved),
    "Both shapes cover the same sections in the same order"
  ) && ok;

// ---------------------------------------------------------------------------
// Case 3: no `display` at all (oldest/ungrouped framework versions).
// ---------------------------------------------------------------------------
console.log("\n=== No display metadata at all ===");
const ungroupedResolved = resolveDisplayGroups(baseFramework);
ok = assertEqual(ungroupedResolved.length, sections.length, "No display -> one group per section") && ok;

console.log(ok ? "\nAll assertions passed." : "\nSome assertions FAILED.");
if (!ok) process.exit(1);
