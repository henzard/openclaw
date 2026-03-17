import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openArchiveDb, pruneOldMessages } from "./db.js";

describe("archive db", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-archive-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the database file and schema", () => {
    const dbPath = path.join(tmpDir, "archive.db");
    const db = openArchiveDb(dbPath);

    expect(fs.existsSync(dbPath)).toBe(true);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_messages'")
      .all();
    expect(tables).toHaveLength(1);

    db.close();
  });

  it("creates expected indexes", () => {
    const dbPath = path.join(tmpDir, "archive.db");
    const db = openArchiveDb(dbPath);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_wa_archive_%'")
      .all() as unknown as Array<{ name: string }>;

    const indexNames = indexes.map((r) => r.name);
    expect(indexNames).toContain("idx_wa_archive_timestamp");
    expect(indexNames).toContain("idx_wa_archive_sender");
    expect(indexNames).toContain("idx_wa_archive_group_id");
    expect(indexNames).toContain("idx_wa_archive_ts_dir");

    db.close();
  });

  it("is idempotent on repeated open", () => {
    const dbPath = path.join(tmpDir, "archive.db");
    const db1 = openArchiveDb(dbPath);
    db1.close();
    const db2 = openArchiveDb(dbPath);

    const tables = db2
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_messages'")
      .all();
    expect(tables).toHaveLength(1);

    db2.close();
  });

  it("creates parent directories when missing", () => {
    const nestedPath = path.join(tmpDir, "a", "b", "archive.db");
    const db = openArchiveDb(nestedPath);

    expect(fs.existsSync(nestedPath)).toBe(true);

    db.close();
  });

  describe("pruneOldMessages", () => {
    it("returns 0 when retentionDays is 0", () => {
      const db = openArchiveDb(path.join(tmpDir, "prune.db"));
      expect(pruneOldMessages(db, 0)).toBe(0);
      db.close();
    });

    it("deletes rows older than retentionDays", () => {
      const db = openArchiveDb(path.join(tmpDir, "prune.db"));

      const oldTs = Date.now() - 40 * 86_400_000;
      const recentTs = Date.now() - 5 * 86_400_000;

      db.prepare(
        "INSERT INTO whatsapp_messages (message_id, direction, timestamp) VALUES (?, 'inbound', ?)",
      ).run("old-msg", oldTs);
      db.prepare(
        "INSERT INTO whatsapp_messages (message_id, direction, timestamp) VALUES (?, 'inbound', ?)",
      ).run("recent-msg", recentTs);

      const deleted = pruneOldMessages(db, 30);
      expect(deleted).toBe(1);

      const remaining = db
        .prepare("SELECT message_id FROM whatsapp_messages")
        .all() as unknown as Array<{
        message_id: string;
      }>;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.message_id).toBe("recent-msg");

      db.close();
    });

    it("deletes referenced audio files on prune", () => {
      const db = openArchiveDb(path.join(tmpDir, "prune-audio.db"));
      const audioDir = path.join(tmpDir, "audio");
      const monthDir = path.join(audioDir, "2024-01");
      fs.mkdirSync(monthDir, { recursive: true });

      const audioFile = path.join(monthDir, "old-audio.ogg");
      fs.writeFileSync(audioFile, "fake audio");

      const oldTs = Date.now() - 100 * 86_400_000;
      db.prepare(
        "INSERT INTO whatsapp_messages (message_id, direction, timestamp, media_type, media_path) VALUES (?, 'inbound', ?, ?, ?)",
      ).run("old-audio-msg", oldTs, "audio/ogg", audioFile);

      pruneOldMessages(db, 30, audioDir);

      expect(fs.existsSync(audioFile)).toBe(false);
      // Empty month directory should also be cleaned up
      expect(fs.existsSync(monthDir)).toBe(false);

      db.close();
    });
  });
});
