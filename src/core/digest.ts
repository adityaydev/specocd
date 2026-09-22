import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { changeDir, changeFile } from "../paths.js";
import { loadClaims } from "./claims.js";
import { readEvents } from "./events.js";
import { parseRequirements, parseTasks, readFrontMatter } from "./markdown.js";

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
    `ACTION REQUIRED: run \`specdd digest ${change}\` to refresh the structural`,
    "digest, then condense the oversized artifacts above in it. Keep it under the cap.",
  ].join("\n");
}

/** Recent decisions/blockers worth carrying forward in the digest. */
const RECENT_EVENT_LIMIT = 15;

/**
 * Deterministic structural digest (decision #3) — headings, task state, claims and
 * recent decisions. No LLM involved; an agent can refine the prose afterwards.
 */
export function generateDigest(root: string, change: string, now = new Date()): string {
  const proposalPath = changeFile(root, change, "proposal.md");
  const front = existsSync(proposalPath) ? readFrontMatter(proposalPath).data : {};
  const requirements = parseRequirements(changeFile(root, change, "spec-delta.md"));
  const tasks = parseTasks(changeFile(root, change, "tasks.md"));
  const { claims } = loadClaims(root, change);
  const active = claims.filter((c) => c.status === "active");
  const events = readEvents(root, change).filter((e) => e.type === "decision" || e.type === "blocker");
  const recent = events.slice(-RECENT_EVENT_LIMIT);

  const lines = [
    `# Digest: ${change}`,
    "",
    `_Generated ${now.toISOString()} by \`specdd digest\`. Structural extract — an agent may_`,
    "_condense the prose further, but keep these sections._",
    "",
    `- status: ${front.status ?? "unknown"}${front.approved === true ? " (approved)" : ""}`,
    `- requirements: ${requirements.length}`,
    `- tasks: ${tasks.filter((t) => t.done).length}/${tasks.length} done`,
    `- active claims: ${active.length}`,
    "",
    "## Requirements",
    "",
    ...(requirements.length === 0
      ? ["_none defined yet_"]
      : requirements.map((r) => `- **${r.id}** ${r.title} — WHEN ${r.whens.join("; ") || "?"} THEN ${r.thens.join("; ") || "?"}`)),
    "",
    "## Tasks",
    "",
    ...(tasks.length === 0
      ? ["_none defined yet_"]
      : tasks.map((t) => `- [${t.done ? "x" : " "}] ${t.id}: ${t.title}`)),
    "",
    "## Open claims",
    "",
    ...(active.length === 0
      ? ["_none_"]
      : active.map((c) => `- ${c.task_id} — ${c.owner_agent} (${c.session_id}), heartbeat ${c.last_heartbeat}`)),
    "",
    "## Recent decisions & blockers",
    "",
    ...(recent.length === 0
      ? ["_none recorded_"]
      : recent.map((e) => `- [${e.type}] ${e.task_id ?? "change"} — ${e.message} (${e.agent})`)),
    "",
  ];
  return lines.join("\n");
}

export function writeDigest(root: string, change: string, now = new Date()): string {
  const contents = generateDigest(root, change, now);
  writeFileSync(changeFile(root, change, "digest.md"), contents, "utf8");
  return contents;
}
