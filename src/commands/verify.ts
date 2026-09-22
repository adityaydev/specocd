import { existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { isStale, loadClaims, type Claim } from "../core/claims.js";
import { findOversized, type OversizedArtifact } from "../core/digest.js";
import { isPlaceholder, parseRequirements, parseTasks, readFrontMatter, type Requirement, type Task } from "../core/markdown.js";
import { changeDir, changeFile } from "../paths.js";

export interface VerifyReport {
  change: string;
  requirements: Requirement[];
  placeholders: Requirement[];
  tasks: Task[];
  incompleteTasks: Task[];
  activeClaims: Claim[];
  staleClaims: Claim[];
  oversized: OversizedArtifact[];
  approvalRequired: boolean;
  approved: boolean;
  /** Structural reasons this change is not ready to archive. */
  blockers: string[];
}

export function verify(root: string, change: string): VerifyReport {
  if (!existsSync(changeDir(root, change))) throw new Error(`No such change: "${change}".`);
  const config = loadConfig(root);

  const requirements = parseRequirements(changeFile(root, change, "spec-delta.md"));
  const placeholders = requirements.filter(isPlaceholder);
  const tasks = parseTasks(changeFile(root, change, "tasks.md"));
  const incompleteTasks = tasks.filter((t) => !t.done);

  const { claims } = loadClaims(root, change);
  const live = claims.filter((c) => c.status === "active");
  const activeClaims = live.filter((c) => !isStale(c, config.stale_claim_minutes));
  const staleClaims = live.filter((c) => isStale(c, config.stale_claim_minutes));

  const front = readFrontMatter(changeFile(root, change, "proposal.md")).data;
  const approved = front.approved === true;

  const blockers: string[] = [];
  if (requirements.length === 0) blockers.push("No requirements defined in spec-delta.md.");
  if (placeholders.length > 0) {
    blockers.push(`Requirements still holding template placeholders: ${placeholders.map((r) => r.id).join(", ")}.`);
  }
  if (incompleteTasks.length > 0) {
    blockers.push(`Tasks not marked done: ${incompleteTasks.map((t) => t.id).join(", ")}.`);
  }
  if (activeClaims.length > 0) {
    blockers.push(
      `Tasks still actively claimed: ${activeClaims.map((c) => `${c.task_id} (${c.owner_agent})`).join(", ")}.`,
    );
  }
  if (config.require_approval && !approved) {
    blockers.push("config.require_approval is set but proposal.md front-matter has approved: false.");
  }

  return {
    change,
    requirements,
    placeholders,
    tasks,
    incompleteTasks,
    activeClaims,
    staleClaims,
    oversized: findOversized(root, change, config.size_cap_kb),
    approvalRequired: config.require_approval,
    approved,
    blockers,
  };
}

/**
 * Structural checks are all the CLI can do on its own — semantic verification
 * (does the code actually satisfy each WHEN/THEN?) is handed to the active agent.
 */
export function verifyInstruction(report: VerifyReport): string {
  return [
    `Structural checks passed for "${report.change}". Semantic verification is yours:`,
    "",
    ...report.requirements.map((r) => `  ${r.id}: WHEN ${r.whens.join("; ")} THEN ${r.thens.join("; ")}`),
    "",
    "For each requirement above, check the ACTUAL implementation (read the code, run",
    "the tests) and report pass/fail with evidence — file:line or test output. Do not",
    "mark a requirement verified on the basis of the spec or task list alone.",
  ].join("\n");
}
