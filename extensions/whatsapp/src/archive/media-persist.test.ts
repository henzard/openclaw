import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistAudioFile } from "./media-persist.js";

describe("persistAudioFile", () => {
  let tmpDir: string;
  let archiveDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-media-test-"));
    archiveDir = path.join(tmpDir, "audio");
    fs.mkdirSync(archiveDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("copies audio file to date-partitioned directory", () => {
    const srcFile = path.join(tmpDir, "voice.ogg");
    fs.writeFileSync(srcFile, "fake audio content");

    const result = persistAudioFile(srcFile, archiveDir, "msg-123");

    expect(result).not.toBeNull();
    expect(fs.existsSync(result!)).toBe(true);
    expect(result).toContain("msg-123.ogg");

    const content = fs.readFileSync(result!, "utf-8");
    expect(content).toBe("fake audio content");
  });

  it("creates year-month subdirectory", () => {
    const srcFile = path.join(tmpDir, "voice.ogg");
    fs.writeFileSync(srcFile, "audio");

    const result = persistAudioFile(srcFile, archiveDir, "test-1");

    expect(result).not.toBeNull();
    const parentDir = path.basename(path.dirname(result!));
    expect(parentDir).toMatch(/^\d{4}-\d{2}$/);
  });

  it("returns null when source file does not exist", () => {
    const result = persistAudioFile("/nonexistent/file.ogg", archiveDir, "msg-1");
    expect(result).toBeNull();
  });

  it("returns existing path if file already persisted", () => {
    const srcFile = path.join(tmpDir, "voice.ogg");
    fs.writeFileSync(srcFile, "audio");

    const first = persistAudioFile(srcFile, archiveDir, "msg-dup");
    const second = persistAudioFile(srcFile, archiveDir, "msg-dup");

    expect(first).toBe(second);
  });

  it("sanitizes message ID for filename", () => {
    const srcFile = path.join(tmpDir, "voice.ogg");
    fs.writeFileSync(srcFile, "audio");

    const result = persistAudioFile(srcFile, archiveDir, "msg/with:special<chars>");

    expect(result).not.toBeNull();
    expect(path.basename(result!)).not.toMatch(/[/:><]/);
  });

  it("preserves original file extension", () => {
    const srcFile = path.join(tmpDir, "voice.mp3");
    fs.writeFileSync(srcFile, "audio");

    const result = persistAudioFile(srcFile, archiveDir, "msg-ext");

    expect(result).not.toBeNull();
    expect(result!.endsWith(".mp3")).toBe(true);
  });

  it("defaults to .ogg when source has no extension", () => {
    const srcFile = path.join(tmpDir, "voice");
    fs.writeFileSync(srcFile, "audio");

    const result = persistAudioFile(srcFile, archiveDir, "msg-noext");

    expect(result).not.toBeNull();
    expect(result!.endsWith(".ogg")).toBe(true);
  });
});
