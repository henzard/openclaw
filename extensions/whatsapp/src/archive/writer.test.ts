import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openArchiveDb } from "./db.js";
import type { OutboundMessageContext } from "./writer.js";
import { archiveInboundMessage, archiveOutboundMessage } from "./writer.js";

describe("archive writer", () => {
  let tmpDir: string;
  let db: ReturnType<typeof openArchiveDb>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-writer-test-"));
    db = openArchiveDb(path.join(tmpDir, "test.db"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("archiveInboundMessage", () => {
    it("inserts a text message", () => {
      archiveInboundMessage(
        db,
        {
          key: {
            id: "msg-1",
            fromMe: false,
            remoteJid: "15551234567@s.whatsapp.net",
          },
          message: { conversation: "hello world" },
          messageTimestamp: 1_700_000_000,
        },
        "default",
      );

      const rows = db.prepare("SELECT * FROM whatsapp_messages").all() as unknown as Array<{
        message_id: string;
        direction: string;
        body: string;
        sender: string;
        is_group: number;
        account_id: string;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.message_id).toBe("msg-1");
      expect(rows[0]!.direction).toBe("inbound");
      expect(rows[0]!.body).toBe("hello world");
      expect(rows[0]!.sender).toBe("15551234567@s.whatsapp.net");
      expect(rows[0]!.is_group).toBe(0);
      expect(rows[0]!.account_id).toBe("default");
    });

    it("deduplicates by message_id", () => {
      const raw = {
        key: { id: "dup-1", fromMe: false, remoteJid: "123@s.whatsapp.net" },
        message: { conversation: "first" },
        messageTimestamp: 1_700_000_000,
      };

      archiveInboundMessage(db, raw, "default");
      archiveInboundMessage(db, raw, "default");

      const count = db.prepare("SELECT COUNT(*) as c FROM whatsapp_messages").get() as unknown as {
        c: number;
      };
      expect(count.c).toBe(1);
    });

    it("handles group messages with participant", () => {
      archiveInboundMessage(
        db,
        {
          key: {
            id: "grp-msg-1",
            fromMe: false,
            remoteJid: "120363@g.us",
            participant: "456@s.whatsapp.net",
          },
          message: { conversation: "group message" },
          messageTimestamp: 1_700_000_000,
        },
        "default",
      );

      const rows = db.prepare("SELECT * FROM whatsapp_messages").all() as unknown as Array<{
        is_group: number;
        group_id: string;
        sender: string;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.is_group).toBe(1);
      expect(rows[0]!.group_id).toBe("120363@g.us");
      expect(rows[0]!.sender).toBe("456@s.whatsapp.net");
    });

    it("extracts media type from audio messages", () => {
      archiveInboundMessage(
        db,
        {
          key: { id: "audio-1", fromMe: false, remoteJid: "123@s.whatsapp.net" },
          message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } },
          messageTimestamp: 1_700_000_000,
        },
        "default",
      );

      const row = db.prepare("SELECT media_type FROM whatsapp_messages").get() as unknown as {
        media_type: string;
      };
      expect(row.media_type).toBe("audio/ogg; codecs=opus");
    });

    it("skips messages with no key", () => {
      archiveInboundMessage(db, {} as never, "default");

      const count = db.prepare("SELECT COUNT(*) as c FROM whatsapp_messages").get() as unknown as {
        c: number;
      };
      expect(count.c).toBe(0);
    });

    it("stores raw JSON", () => {
      const raw = {
        key: { id: "json-1", fromMe: false, remoteJid: "123@s.whatsapp.net" },
        message: { conversation: "test" },
        messageTimestamp: 1_700_000_000,
      };
      archiveInboundMessage(db, raw, "default");

      const row = db.prepare("SELECT raw_json FROM whatsapp_messages").get() as unknown as {
        raw_json: string;
      };
      const parsed = JSON.parse(row.raw_json);
      expect(parsed.key.id).toBe("json-1");
    });
  });

  describe("archiveOutboundMessage", () => {
    it("inserts an outbound message", () => {
      const ctx: OutboundMessageContext = {
        to: "15551234567@s.whatsapp.net",
        content: "hello back",
        channelId: "whatsapp",
        accountId: "default",
        messageId: "out-1",
      };

      archiveOutboundMessage(db, ctx);

      const rows = db.prepare("SELECT * FROM whatsapp_messages").all() as unknown as Array<{
        message_id: string;
        direction: string;
        sender: string;
        recipient: string;
        body: string;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.message_id).toBe("out-1");
      expect(rows[0]!.direction).toBe("outbound");
      expect(rows[0]!.sender).toBe("me");
      expect(rows[0]!.recipient).toBe("15551234567@s.whatsapp.net");
      expect(rows[0]!.body).toBe("hello back");
    });

    it("generates a message_id when not provided", () => {
      archiveOutboundMessage(db, {
        to: "123@s.whatsapp.net",
        content: "auto-id",
        channelId: "whatsapp",
      });

      const row = db.prepare("SELECT message_id FROM whatsapp_messages").get() as unknown as {
        message_id: string;
      };
      expect(row.message_id).toMatch(/^out_/);
    });
  });
});
