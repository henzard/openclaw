import { describe, expect, it } from "vitest";
import { buildModelDecision } from "./runner.entries.js";

describe("faster-whisper model decision", () => {
  it("builds a CLI model decision for faster-whisper", () => {
    const decision = buildModelDecision({
      entry: {
        type: "cli",
        command: "faster-whisper",
        args: [
          "--model",
          "large-v3",
          "--output_format",
          "txt",
          "--output_dir",
          "{{OutputDir}}",
          "{{MediaPath}}",
        ],
      },
      entryType: "cli",
      outcome: "success",
    });

    expect(decision.type).toBe("cli");
    expect(decision.provider).toBe("faster-whisper");
    expect(decision.model).toBe("faster-whisper");
    expect(decision.outcome).toBe("success");
  });

  it("uses entry.model when explicitly set", () => {
    const decision = buildModelDecision({
      entry: {
        type: "cli",
        command: "faster-whisper",
        model: "large-v3",
        args: [],
      },
      entryType: "cli",
      outcome: "success",
    });

    expect(decision.model).toBe("large-v3");
  });
});
