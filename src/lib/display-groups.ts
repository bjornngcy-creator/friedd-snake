// Resolves a framework definition's presentation groups into the current
// FrameworkDisplayTable-based shape (src/lib/scoring.ts), tolerating BOTH:
//   - the current (0008) shape: a group already has `tables: FrameworkDisplayTable[]`.
//   - the pre-3.1 (0005) shape: a group has `section_keys`/`merge_sections`
//     directly on it, no `tables` key at all.
//
// Why this exists as its own module, separate from evaluation-form.tsx:
// `framework.display` is `jsonb` from the database, cast to
// `FrameworkDefinition` at the type level only — TypeScript's static type
// says every group already has `tables`, but that's a compile-time promise,
// not a runtime one. Migration 0008 (which rewrites `display.groups` from
// the old shape to the new one) and this code deploy together in the same
// commit, but the MIGRATION is applied separately (manual DB access only,
// see CLAUDE.md). Whichever one lands second, there is a window — possibly a
// long one — where the running code and the stored `display.groups` shape
// disagree. Without this tolerance, `group.tables.map(...)` throws a
// TypeError the instant the deployed code sees the old shape (or, if the
// migration runs first, old code would choke on the new shape) — either
// deploy order breaks every student's evaluation page. This module makes
// deploy order irrelevant: it normalizes whichever shape it's given.
//
// Exported as a pure function (no React/JSX) so it can be unit-checked from
// a plain Node script (scripts/verify-display-groups.mjs) as well as used
// by the client component.

import type { FrameworkDefinition, FrameworkDisplayGroup, FrameworkDisplayTable, Section } from "@/lib/scoring";

/** Loosest possible shape a stored display group might actually have at runtime — deliberately `unknown`-friendly, never assumed to match FrameworkDisplayGroup. */
type RawDisplayGroup = {
  key?: unknown;
  title?: unknown;
  subtitle?: unknown;
  equity_scope_note?: unknown;
  tables?: unknown;
  section_keys?: unknown;
  merge_sections?: unknown;
};

function isNonEmptyArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0;
}

function looksLikeTable(v: unknown): v is FrameworkDisplayTable {
  return (
    typeof v === "object" &&
    v !== null &&
    "section_keys" in v &&
    Array.isArray((v as { section_keys?: unknown }).section_keys)
  );
}

/**
 * Normalizes one raw display group into the current FrameworkDisplayTable
 * shape, regardless of which migration produced it.
 */
export function normalizeDisplayGroup(raw: RawDisplayGroup, sections: Section[]): FrameworkDisplayGroup {
  const key = typeof raw.key === "string" ? raw.key : "group";
  const title = typeof raw.title === "string" ? raw.title : key;
  const subtitle = typeof raw.subtitle === "string" ? raw.subtitle : null;
  const equityScopeNote = typeof raw.equity_scope_note === "string" ? raw.equity_scope_note : null;

  // Current (0008) shape: `tables` is already a well-formed array.
  if (isNonEmptyArray(raw.tables) && raw.tables.every(looksLikeTable)) {
    return {
      key,
      title,
      subtitle,
      equity_scope_note: equityScopeNote,
      tables: raw.tables as FrameworkDisplayTable[],
    };
  }

  // Pre-3.1 (0005) shape: `section_keys` + `merge_sections` live directly on
  // the group, no `tables` key at all.
  const sectionKeys = Array.isArray(raw.section_keys) ? (raw.section_keys as unknown[]).filter((k): k is string => typeof k === "string") : [];
  const mergeSections = raw.merge_sections === true;

  const tables: FrameworkDisplayTable[] = mergeSections
    ? [{ key, title: null, section_keys: sectionKeys, merge_sections: true }]
    : sectionKeys.map((sectionKey) => {
        const section = sections.find((s) => s.key === sectionKey);
        return {
          key: sectionKey,
          title: section?.title ?? sectionKey,
          section_keys: [sectionKey],
          merge_sections: false,
        };
      });

  return { key, title, subtitle, equity_scope_note: equityScopeNote, tables };
}

/** Older/ungrouped framework versions won't have `display.groups` at all — fall back to one ungrouped table per section so the form still renders. */
export function resolveDisplayGroups(framework: FrameworkDefinition): FrameworkDisplayGroup[] {
  const rawGroups = (framework.display as { groups?: unknown } | undefined)?.groups;

  if (isNonEmptyArray(rawGroups)) {
    return (rawGroups as RawDisplayGroup[]).map((group) => normalizeDisplayGroup(group, framework.sections));
  }

  return framework.sections.map((section) => ({
    key: section.key,
    title: section.title,
    subtitle: section.subtitle,
    tables: [{ key: section.key, title: null, section_keys: [section.key], merge_sections: false }],
  }));
}
