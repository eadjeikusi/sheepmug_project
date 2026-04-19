/**
 * Applies migrations/group_type_options.sql via Postgres.
 * Set DATABASE_URL or SUPABASE_DB_URL (Supabase → Project Settings → Database → Connection string URI).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { parseCustomFieldsSqlStatements } from "./runCustomFieldsMigration";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runGroupTypeOptionsMigration(connectionString: string): Promise<{ ok: boolean; message: string }> {
  const sqlPath = path.join(__dirname, "group_type_options.sql");
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
    return { ok: true, message: "group_type_options migration applied successfully." };
  } finally {
    await client.end().catch(() => {});
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
      const r = await runGroupTypeOptionsMigration(url);
      console.log(r.message);
      process.exit(0);
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
  })();
}
