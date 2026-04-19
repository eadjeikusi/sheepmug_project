/**
 * Applies migrations/custom_fields.sql using a direct Postgres connection.
 * Set DATABASE_URL (or SUPABASE_DB_URL) — Supabase Dashboard → Project Settings → Database → Connection string (URI).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function parseCustomFieldsSqlStatements(content: string): string[] {
  const noLineComments = content
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  return noLineComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function runCustomFieldsMigration(connectionString: string): Promise<{ ok: boolean; message: string }> {
  const sqlPath = path.join(__dirname, "custom_fields.sql");
  const raw = fs.readFileSync(sqlPath, "utf8");
  const statements = parseCustomFieldsSqlStatements(raw);
  const useSsl = !/localhost|127\.0\.0\.1/i.test(connectionString);
  const client = new pg.Client({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    for (const st of statements) {
      await client.query(st);
    }
    return { ok: true, message: "custom_fields migration applied successfully." };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function runCustomFieldsMigrationFromEnv(): Promise<{
  ok: boolean;
  skipped: boolean;
  message: string;
}> {
  const url = (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
  if (!url) {
    return {
      ok: false,
      skipped: true,
      message:
        "DATABASE_URL not set — skipped auto-migration. Add DATABASE_URL from Supabase (Database → Connection string), or run: npm run migrate:custom-fields",
    };
  }
  try {
    const r = await runCustomFieldsMigration(url);
    return { ok: r.ok, skipped: false, message: r.message };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      skipped: false,
      message: `custom_fields migration failed: ${msg}`,
    };
  }
}

function isRunAsMain(): boolean {
  const a = process.argv[1];
  if (!a) return false;
  try {
    return path.resolve(a) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isRunAsMain()) {
  void (async () => {
    const url = (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
    if (!url) {
      console.error("Set DATABASE_URL or SUPABASE_DB_URL in .env (Supabase → Database → Connection string URI).");
      process.exit(1);
    }
    try {
      const r = await runCustomFieldsMigration(url);
      console.log(r.message);
      process.exit(0);
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
  })();
}
