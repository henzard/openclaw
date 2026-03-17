import fs from "node:fs";
import path from "node:path";

/**
 * Copy an audio file to the permanent archive directory.
 * Directory structure: `<archiveDir>/<YYYY-MM>/<messageId>.ogg`
 *
 * Returns the destination path, or null if copy failed.
 */
export function persistAudioFile(
  srcPath: string,
  archiveDir: string,
  messageId: string,
): string | null {
  try {
    if (!fs.existsSync(srcPath)) {
      return null;
    }

    const now = new Date();
    const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const destDir = path.join(archiveDir, monthDir);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const ext = path.extname(srcPath) || ".ogg";
    const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const destPath = path.join(destDir, `${safeId}${ext}`);

    if (fs.existsSync(destPath)) {
      return destPath;
    }

    fs.copyFileSync(srcPath, destPath);
    return destPath;
  } catch {
    return null;
  }
}
