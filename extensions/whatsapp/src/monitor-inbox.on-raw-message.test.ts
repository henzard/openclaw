import "./monitor-inbox.test-harness.js";
import { describe, expect, it, vi } from "vitest";
import { monitorWebInbox } from "./inbound.js";
import {
  DEFAULT_ACCOUNT_ID,
  getAuthDir,
  getSock,
  installWebMonitorInboxUnitTestHooks,
} from "./monitor-inbox.test-harness.js";

describe("onRawMessage callback", () => {
  installWebMonitorInboxUnitTestHooks();

  async function tick() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it("fires onRawMessage for every incoming message before onMessage", async () => {
    const rawMessages: unknown[] = [];
    const onRawMessage = vi.fn((raw: unknown) => {
      rawMessages.push(raw);
    });
    const onMessage = vi.fn(async () => {});

    await monitorWebInbox({
      verbose: false,
      onMessage,
      onRawMessage,
      accountId: DEFAULT_ACCOUNT_ID,
      authDir: getAuthDir(),
    });

    const sock = getSock();
    sock.ev.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            id: "raw-test-1",
            fromMe: false,
            remoteJid: "15551234567@s.whatsapp.net",
          },
          message: { conversation: "hello raw" },
          messageTimestamp: 1_700_000_000,
          pushName: "RawTester",
        },
      ],
    });

    await tick();
    await tick();

    expect(onRawMessage).toHaveBeenCalledTimes(1);
    const rawArg = onRawMessage.mock.calls[0]![0] as { key: { id: string } };
    expect(rawArg).toHaveProperty("key");
    expect(rawArg.key.id).toBe("raw-test-1");
  });

  it("fires onRawMessage even for messages that might be filtered by allowlist", async () => {
    const onRawMessage = vi.fn();
    const onMessage = vi.fn(async () => {});

    await monitorWebInbox({
      verbose: false,
      onMessage,
      onRawMessage,
      accountId: DEFAULT_ACCOUNT_ID,
      authDir: getAuthDir(),
    });

    const sock = getSock();
    sock.ev.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            id: "filtered-msg",
            fromMe: false,
            remoteJid: "unknown-sender@s.whatsapp.net",
          },
          message: { conversation: "from unknown" },
          messageTimestamp: 1_700_000_001,
          pushName: "Unknown",
        },
      ],
    });

    await tick();
    await tick();

    expect(onRawMessage).toHaveBeenCalledTimes(1);
  });

  it("does not break if onRawMessage is not provided", async () => {
    const onMessage = vi.fn(async () => {});

    const listener = await monitorWebInbox({
      verbose: false,
      onMessage,
      accountId: DEFAULT_ACCOUNT_ID,
      authDir: getAuthDir(),
    });

    const sock = getSock();
    sock.ev.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            id: "no-raw-callback",
            fromMe: false,
            remoteJid: "15551234567@s.whatsapp.net",
          },
          message: { conversation: "no crash" },
          messageTimestamp: 1_700_000_002,
          pushName: "Tester",
        },
      ],
    });

    await tick();
    await tick();

    expect(listener).toBeDefined();
  });
});
