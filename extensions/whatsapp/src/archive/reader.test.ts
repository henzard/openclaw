import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openArchiveDb } from "./db.js";
import { getMessageSummary, getRecentMessages, searchMessages } from "./reader.js";

describe("archive reader", () => {
  let tmpDir: string;
  let db: ReturnType<typeof openArchiveDb>;

  function seed() {
    const insert = db.prepare(
      `INSERT INTO whatsapp_messages
        (message_id, direction, sender, recipient, body, is_group, group_id, group_subject, timestamp, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const baseTs = new Date("2025-03-17T10:00:00Z").getTime();
    insert.run(
      "m1",
      "inbound",
      "alice@s.whatsapp.net",
      "me",
      "hello",
      0,
      null,
      null,
      baseTs,
      "default",
    );
    insert.run(
      "m2",
      "inbound",
      "bob@s.whatsapp.net",
      "me",
      "world",
      0,
      null,
      null,
      baseTs + 1000,
      "default",
    );
    insert.run(
      "m3",
      "outbound",
      "me",
      "alice@s.whatsapp.net",
      "hi alice",
      0,
      null,
      null,
      baseTs + 2000,
      "default",
    );
    insert.run(
      "m4",
      "inbound",
      "carol@s.whatsapp.net",
      "me",
      "group msg",
      1,
      "grp1@g.us",
      "Team Chat",
      baseTs + 3000,
      "default",
    );
    insert.run(
      "m5",
      "inbound",
      "alice@s.whatsapp.net",
      "me",
      "another from alice",
      0,
      null,
      null,
      baseTs + 4000,
      "default",
    );
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-reader-test-"));
    db = openArchiveDb(path.join(tmpDir, "test.db"));
    seed();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("searchMessages", () => {
    it("returns all messages with empty filters", () => {
      const results = searchMessages(db, {});
      expect(results).toHaveLength(5);
    });

    it("filters by sender", () => {
      const results = searchMessages(db, { sender: "alice" });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.sender?.includes("alice"))).toBe(true);
    });

    it("filters by direction", () => {
      const results = searchMessages(db, { direction: "outbound" });
      expect(results).toHaveLength(1);
      expect(results[0]!.direction).toBe("outbound");
    });

    it("filters by text query", () => {
      const results = searchMessages(db, { query: "group" });
      expect(results).toHaveLength(1);
      expect(results[0]!.body).toBe("group msg");
    });

    it("filters by group", () => {
      const results = searchMessages(db, { group: "Team" });
      expect(results).toHaveLength(1);
      expect(results[0]!.group_subject).toBe("Team Chat");
    });

    it("respects limit", () => {
      const results = searchMessages(db, { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("caps limit at 200", () => {
      const results = searchMessages(db, { limit: 999 });
      expect(results).toHaveLength(5);
    });

    it("returns results ordered by timestamp DESC", () => {
      const results = searchMessages(db, {});
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.timestamp).toBeGreaterThanOrEqual(results[i]!.timestamp);
      }
    });
  });

  describe("getMessageSummary", () => {
    it("returns correct totals", () => {
      const summary = getMessageSummary(db);
      expect(summary.totalMessages).toBe(5);
      expect(summary.inbound).toBe(4);
      expect(summary.outbound).toBe(1);
    });

    it("groups by sender", () => {
      const summary = getMessageSummary(db);
      expect(summary.bySender.length).toBeGreaterThan(0);
      const alice = summary.bySender.find((s) => s.sender.includes("alice"));
      expect(alice?.count).toBe(2);
    });

    it("groups by group", () => {
      const summary = getMessageSummary(db);
      expect(summary.byGroup).toHaveLength(1);
      expect(summary.byGroup[0]!.group_id).toBe("grp1@g.us");
    });

    it("filters by date range", () => {
      const baseTs = new Date("2025-03-17T10:00:00Z").getTime();
      const from = new Date(baseTs + 1500).toISOString();
      const to = new Date(baseTs + 3500).toISOString();

      const summary = getMessageSummary(db, from, to);
      expect(summary.totalMessages).toBe(2);
    });
  });

  describe("getRecentMessages", () => {
    it("returns messages in reverse chronological order", () => {
      const results = getRecentMessages(db, 10);
      expect(results).toHaveLength(5);
      expect(results[0]!.message_id).toBe("m5");
    });

    it("respects limit parameter", () => {
      const results = getRecentMessages(db, 2);
      expect(results).toHaveLength(2);
    });

    it("caps limit at 200", () => {
      const results = getRecentMessages(db, 999);
      expect(results).toHaveLength(5);
    });
  });
});
