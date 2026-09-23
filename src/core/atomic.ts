import { renameSync, writeFileSync } from "node:fs";

/**
 * Writes through a temp file and renames into place. Rename is atomic within a
 * filesystem, so a concurrent reader sees either the old file or the new one,
 * never a half-written artifact.
 */
export function writeFileAtomic(file: string, contents: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, file);
}
