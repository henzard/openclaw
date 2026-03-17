import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

const require_ = createRequire(import.meta.url);

export function openArchiveDb(dbPath: string): DatabaseSync {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const { DatabaseSync: DB } = requireNodeSqlite();
  const db = new DB(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  ensureSchema(db);
  return db;
}

function requireNodeSqlite(): typeof import("node:sqlite") {
  try {
    return require_("node:sqlite") as typeof import("node:sqlite");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `SQLite support is unavailable in this Node runtime (missing node:sqlite). ${message}`,
      { cause: err },
    );
  }
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE,
      direction TEXT NOT NULL,
      sender TEXT,
      recipient TEXT,
      body TEXT,
      media_type TEXT,
      media_path TEXT,
      is_group INTEGER NOT NULL DEFAULT 0,
      group_id TEXT,
      group_subject TEXT,
      timestamp INTEGER NOT NULL,
      account_id TEXT,
      raw_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_wa_archive_timestamp ON whatsapp_messages(timestamp)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_wa_archive_sender ON whatsapp_messages(sender)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_wa_archive_group_id ON whatsapp_messages(group_id)");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_wa_archive_ts_dir ON whatsapp_messages(timestamp, direction)",
  );
}

/**
 * Prune messages older than `retentionDays`. Also deletes referenced audio files.
 * Returns the number of rows deleted.
 */
export function pruneOldMessages(
  db: DatabaseSync,
  retentionDays: number,
  audioBaseDir?: string,
): number {
  if (retentionDays <= 0) {
    return 0;
  }
  const cutoffMs = Date.now() - retentionDays * 86_400_000;

  if (audioBaseDir) {
    const rows = db
      .prepare(
        `SELECT media_path FROM whatsapp_messages
         WHERE timestamp < ? AND media_type LIKE 'audio/%' AND media_path IS NOT NULL`,
      )
      .all(cutoffMs) as Array<{ media_path: string }>;

    for (const row of rows) {
      try {
        if (fs.existsSync(row.media_path)) {
          fs.unlinkSync(row.media_path);
        }
        const parentDir = path.dirname(row.media_path);
        if (parentDir !== audioBaseDir && fs.existsSync(parentDir)) {
          const remaining = fs.readdirSync(parentDir);
          if (remaining.length === 0) {
            fs.rmdirSync(parentDir);
          }
        }
      } catch {
        // best-effort cleanup
      }
    }
  }

  const result = db.prepare("DELETE FROM whatsapp_messages WHERE timestamp < ?").run(cutoffMs);
  return (result as { changes?: number }).changes ?? 0;
}
