import { describe, expect, it } from "vitest";
import { WhatsAppAccountSchema } from "./zod-schema.providers-whatsapp.js";

describe("WhatsAppArchiveSchema", () => {
  const baseAccount = {
    allowFrom: ["*"],
  };

  it("accepts account config without archive", () => {
    const result = WhatsAppAccountSchema.safeParse(baseAccount);
    expect(result.success).toBe(true);
  });

  it("accepts archive with all fields", () => {
    const result = WhatsAppAccountSchema.safeParse({
      ...baseAccount,
      archive: {
        enabled: true,
        path: "/tmp/archive.db",
        retentionDays: 30,
        persistAudio: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts archive with no fields (defaults apply)", () => {
    const result = WhatsAppAccountSchema.safeParse({
      ...baseAccount,
      archive: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.archive?.retentionDays).toBe(90);
      expect(result.data.archive?.persistAudio).toBe(true);
    }
  });

  it("defaults retentionDays to 90", () => {
    const result = WhatsAppAccountSchema.safeParse({
      ...baseAccount,
      archive: { enabled: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.archive?.retentionDays).toBe(90);
    }
  });

  it("defaults persistAudio to true", () => {
    const result = WhatsAppAccountSchema.safeParse({
      ...baseAccount,
      archive: { enabled: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.archive?.persistAudio).toBe(true);
    }
  });

  it("rejects negative retentionDays", () => {
    const result = WhatsAppAccountSchema.safeParse({
      ...baseAccount,
      archive: { retentionDays: -5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer retentionDays", () => {
    const result = WhatsAppAccountSchema.safeParse({
      ...baseAccount,
      archive: { retentionDays: 30.5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields in archive (strict)", () => {
    const result = WhatsAppAccountSchema.safeParse({
      ...baseAccount,
      archive: { unknownField: true },
    });
    expect(result.success).toBe(false);
  });
});
