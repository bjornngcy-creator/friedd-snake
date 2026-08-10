#!/usr/bin/env node
// Applies supabase/migrations/*.sql to the remote Supabase Postgres database
// (via the session pooler) that have not already been applied, tracked in a
// `_migrations` table.
//
// Usage:
//   node scripts/db-migrate.mjs            # apply all pending migrations
//   node scripts/db-migrate.mjs --status    # list applied/pending, no changes
//
// Reads SUPABASE_DB_PASSWORD (and, for logging only, NEXT_PUBLIC_SUPABASE_URL)
// from .env.local in the project root.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(projectRoot, ".env.local");
const migrationsDir = path.join(projectRoot, "supabase", "migrations");

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

async function main() {
  const statusOnly = process.argv.includes("--status");

  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    console.error("SUPABASE_DB_PASSWORD is missing from .env.local.");
    process.exit(1);
  }

  const client = new Client({
    host: "aws-0-ap-northeast-2.pooler.supabase.com",
    port: 5432,
    user: "postgres.opivuugndhoeebfozglh",
    database: "postgres",
    password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query(`
      create table if not exists public._migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const { rows: appliedRows } = await client.query(
      "select name from public._migrations order by name"
    );
    const applied = new Set(appliedRows.map((r) => r.name));

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const pending = files.filter((f) => !applied.has(f));

    console.log(`Migrations dir: ${migrationsDir}`);
    console.log(`Applied: ${[...applied].join(", ") || "(none)"}`);
    console.log(`Pending: ${pending.join(", ") || "(none)"}`);

    if (statusOnly) return;

    for (const file of pending) {
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`\nApplying ${file}...`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into public._migrations (name) values ($1)", [
          file,
        ]);
        await client.query("commit");
        console.log(`  applied.`);
      } catch (err) {
        await client.query("rollback");
        console.error(`  FAILED: ${err.message}`);
        throw err;
      }
    }

    if (pending.length === 0) {
      console.log("\nNothing to apply.");
    } else {
      console.log(`\nApplied ${pending.length} migration(s).`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
