import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWhatsAppArchiveTool } from "./agent-tool.js";
import { openArchiveDb } from "./db.js";

describe("whatsapp_archive agent tool", () => {
  let tmpDir: string;
  let db: ReturnType<typeof openArchiveDb>;

  function seedMessages() {
    const insert = db.prepare(
      `INSERT INTO whatsapp_messages
        (message_id, direction, sender, recipient, body, is_group, group_id, timestamp, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const baseTs = new Date("2025-03-17T12:00:00Z").getTime();
    insert.run(
      "m1",
      "inbound",
      "alice@s.whatsapp.net",
      "me",
      "hello there",
      0,
      null,
      baseTs,
      "default",
    );
    insert.run(
      "m2",
      "outbound",
      "me",
      "alice@s.whatsapp.net",
      "hi back",
      0,
      null,
      baseTs + 1000,
      "default",
    );
    insert.run(
      "m3",
      "inbound",
      "bob@s.whatsapp.net",
      "me",
      "in group",
      1,
      "grp@g.us",
      baseTs + 2000,
      "default",
    );
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-tool-test-"));
    db = openArchiveDb(path.join(tmpDir, "test.db"));
    seedMessages();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has correct tool metadata", () => {
    const tool = createWhatsAppArchiveTool(db);
    expect(tool.name).toBe("whatsapp_archive");
    expect(tool.ownerOnly).toBe(true);
  });

  it("returns recent messages by default", async () => {
    const tool = createWhatsAppArchiveTool(db);
    const result = await tool.execute("call-1", { action: "recent" });

    expect(result.details).toHaveProperty("count", 3);
    expect(result.details).toHaveProperty("messages");
  });

  it("returns summary with counts", async () => {
    const tool = createWhatsAppArchiveTool(db);
    const result = await tool.execute("call-2", {
      action: "summary",
      date_from: "2025-03-17",
      date_to: "2025-03-18",
    });

    expect(result.details).toHaveProperty("totalMessages", 3);
    expect(result.details).toHaveProperty("inbound", 2);
    expect(result.details).toHaveProperty("outbound", 1);
  });

  it("searches by text query", async () => {
    const tool = createWhatsAppArchiveTool(db);
    const result = await tool.execute("call-3", {
      action: "search",
      query: "group",
    });

    expect(result.details).toHaveProperty("count", 1);
  });

  it("defaults to recent when action is missing", async () => {
    const tool = createWhatsAppArchiveTool(db);
    const result = await tool.execute("call-4", {});

    expect(result.details).toHaveProperty("count", 3);
  });

  it("returns JSON text content", async () => {
    const tool = createWhatsAppArchiveTool(db);
    const result = await tool.execute("call-5", { action: "recent", limit: 1 });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty("type", "text");

    const block = result.content[0]!;
    const parsed = JSON.parse(block.type === "text" ? block.text : "");
    expect(parsed).toHaveProperty("count");
    expect(parsed).toHaveProperty("messages");
  });
});
