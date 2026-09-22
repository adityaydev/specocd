import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { changeDir } from "../paths.js";

export interface OversizedArtifact {
  file: string;
  sizeKb: number;
}

/** Artifacts that count toward the per-change context budget. */
const TRACKED = ["proposal.md", "spec-delta.md", "design.md", "tasks.md", "events.jsonl"];

export function findOversized(root: string, change: string, capKb: number): OversizedArtifact[] {
  const dir = changeDir(root, change);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => TRACKED.includes(f))
    .map((f) => ({ file: f, sizeKb: statSync(path.join(dir, f)).size / 1024 }))
    .filter((a) => a.sizeKb > capKb);
}

/**
 * The CLI never calls an LLM itself (decision #3) — it emits this instruction so
 * whichever agent is running picks up the regeneration on its next turn.
 */
export function digestInstruction(change: string, oversized: OversizedArtifact[]): string {
  const list = oversized
    .map((a) => `  - ${a.file} (${a.sizeKb.toFixed(1)} KB)`)
    .join("\n");
  return [
    `Context cap exceeded for change "${change}":`,
    list,
    "",
    `ACTION REQUIRED: regenerate ${change}/digest.md summarizing the oversized`,
    "artifacts above, then continue. Keep the digest under the cap.",
  ].join("\n");
}
