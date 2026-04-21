import * as SQLite from "expo-sqlite";

const DB_NAME = "sheepmug_offline_v1.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function initDb(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS offline_resource_cache (
      cache_key TEXT PRIMARY KEY NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offline_meta (
      meta_key TEXT PRIMARY KEY NOT NULL,
      meta_value TEXT NOT NULL
    );
  `);
}

export async function getOfflineDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await initDb(db);
      return db;
    })();
  }
  return dbPromise;
}

export async function getOfflineDbSizeBytes(): Promise<number> {
  const db = await getOfflineDb();
  const pageSizeRow = await db.getFirstAsync<{ page_size: number }>("PRAGMA page_size;");
  const pageCountRow = await db.getFirstAsync<{ page_count: number }>("PRAGMA page_count;");
  const pageSize = Number(pageSizeRow?.page_size ?? 0);
  const pageCount = Number(pageCountRow?.page_count ?? 0);
  if (!Number.isFinite(pageSize) || !Number.isFinite(pageCount)) return 0;
  return pageSize * pageCount;
}
