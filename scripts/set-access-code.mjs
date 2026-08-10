#!/usr/bin/env node
// Sets (or rotates) the access code for a given month.
//
// Usage:
//   node scripts/set-access-code.mjs <plaintext-code> [YYYY-MM]
//
// If the month is omitted, defaults to the current month in Asia/Singapore.
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
// .env.local in the project root.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(projectRoot, ".env.local");

loadEnvFile(envPath);

function loadEnvFile(filePath) {
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(filePath);
      return;
    } catch {
      // fall through to manual parsing below
    }
  }

  if (!existsSync(filePath)) return;

  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function currentMonthSGT() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year").value;
  const month = parts.find((p) => p.type === "month").value;
  return `${year}-${month}`;
}

async function main() {
  const [, , code, monthArg] = process.argv;

  if (!code) {
    console.error("Usage: node scripts/set-access-code.mjs <code> [YYYY-MM]");
    process.exit(1);
  }

  const month = monthArg ?? currentMonthSGT();

  if (!/^\d{4}-\d{2}$/.test(month)) {
    console.error(`Month must look like 'YYYY-MM', got: ${month}`);
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey || url.includes("your-project-ref")) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing or still " +
        "placeholder values in .env.local. Fill them in with your real Supabase " +
        "project values first."
    );
    process.exit(1);
  }

  // Codes are case-insensitive: normalize to uppercase + trim before hashing,
  // matching the normalization applied when verifying (src/lib/actions/access-code.ts).
  const normalizedCode = code.trim().toUpperCase();
  const codeHash = bcrypt.hashSync(normalizedCode, 10);

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase
    .from("access_codes")
    .upsert({ month, code_hash: codeHash }, { onConflict: "month" });

  if (error) {
    console.error("Failed to set access code:", error.message);
    process.exit(1);
  }

  console.log(`Access code for ${month} set successfully.`);
}

main();
