import { existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { isStale, loadClaims, type Claim } from "../core/claims.js";
import { findOversized, type OversizedArtifact } from "../core/digest.js";
import { readEvents, type SpecOCDEvent } from "../core/events.js";
import {
  parseRequirements,
  parseTasks,
  readFrontMatter,
  type Requirement,
  type Task,
} from "../core/markdown.js";
import { repoState, shortSha, type RepoState } from "../core/git.js";
import { changeDir, changeFile } from "../paths.js";

export interface ChangeContext {
  change: string;
  status: string;
  approved: boolean;
  jira: string | null;
  feature: string;
  requirements: Requirement[];
  tasks: Task[];
  activeClaims: Claim[];
  staleClaims: Claim[];
  finishedClaims: Claim[];
  decisions: SpecOCDEvent[];
  blockers: SpecOCDEvent[];
  oversized: OversizedArtifact[];
  /** Tasks with no claim and not yet done: what an arriving agent can pick up. */
  available: Task[];
  repo: RepoState;
}

/**
 * Everything an agent needs to start cold on a change, in one read: what is being
 * built, who holds what, and why earlier decisions went the way they did.
 */
export function show(root: string, change: string): ChangeContext {
  if (!existsSync(changeDir(root, change))) throw new Error(`No such change: "${change}".`);
  const config = loadConfig(root);

  const front = readFrontMatter(changeFile(root, change, "proposal.md")).data;
  const requirements = parseRequirements(changeFile(root, change, "spec-delta.md"));
  const tasks = parseTasks(changeFile(root, change, "tasks.md"));

  const { claims } = loadClaims(root, change);
  const live = claims.filter((c) => c.status === "active");
  const activeClaims = live.filter((c) => !isStale(c, config.stale_claim_minutes));
  const staleClaims = live.filter((c) => isStale(c, config.stale_claim_minutes));

  const events = readEvents(root, change);
  const held = new Set(activeClaims.map((c) => c.task_id));

  return {
    change,
    status: typeof front.status === "string" ? front.status : "unknown",
    approved: front.approved === true,
    jira: typeof front.jira === "string" && front.jira.trim() !== "" ? front.jira : null,
    feature: typeof front.feature === "string" ? front.feature : change,
    requirements,
    tasks,
    activeClaims,
    staleClaims,
    finishedClaims: claims.filter((c) => c.status !== "active"),
    decisions: events.filter((e) => e.type === "decision"),
    blockers: events.filter((e) => e.type === "blocker"),
    oversized: findOversized(root, change, config.size_cap_kb),
    available: tasks.filter((t) => !t.done && !held.has(t.id)),
    repo: repoState(root),
  };
}

export function renderContext(ctx: ChangeContext): string {
  const lines = [
    `# ${ctx.change}`,
    "",
    `status: ${ctx.status}${ctx.approved ? " (approved)" : ""} · feature: ${ctx.feature}` +
      (ctx.jira ? ` · JIRA: ${ctx.jira}` : ""),
    ...(ctx.repo.isRepo
      ? [
          `git: ${ctx.repo.branch ?? "detached"} at ${shortSha(ctx.repo.sha)}` +
            (ctx.repo.dirty ? " (uncommitted changes)" : " (clean)"),
        ]
      : []),
    "",
    "## Requirements",
    "",
    ...(ctx.requirements.length === 0
      ? ["_none defined yet_"]
      : ctx.requirements.map(
          (r) => `- **${r.id}** ${r.title}\n    WHEN ${r.whens.join("; ") || "?"}\n    THEN ${r.thens.join("; ") || "?"}`,
        )),
    "",
    "## Tasks",
    "",
    ...(ctx.tasks.length === 0
      ? ["_none defined yet_"]
      : ctx.tasks.map(function (t) {
          const claim = ctx.activeClaims.find((c) => c.task_id === t.id);
          const stale = ctx.staleClaims.find((c) => c.task_id === t.id);
          const who = claim
            ? ` — held by ${claim.owner_agent} (${claim.session_id})`
            : stale
              ? ` — STALE claim by ${stale.owner_agent}, free to take over`
              : t.done
                ? ""
                : " — unclaimed";

          const done = ctx.finishedClaims.find((c) => c.task_id === t.id && c.git?.end_sha);
          const g = claim?.git ?? stale?.git ?? done?.git;
          const trail: string[] = [];
          if (g?.branch) trail.push(g.branch);
          if (g?.start_sha && g?.end_sha && g.start_sha !== g.end_sha) {
            trail.push(`${shortSha(g.start_sha)}..${shortSha(g.end_sha)}`);
          } else if (g?.start_sha) {
            trail.push(`from ${shortSha(g.start_sha)}`);
          }
          if (g?.worktree) trail.push(`worktree ${g.worktree}`);

          return (
            `- [${t.done ? "x" : " "}] ${t.id}: ${t.title}${who}` +
            (trail.length > 0 ? `\n    ${trail.join(" · ")}` : "")
          );
        })),
    "",
    "## Decisions so far",
    "",
    ...(ctx.decisions.length === 0
      ? ["_none recorded_"]
      : ctx.decisions.map((d) => `- [${d.task_id ?? "change"}] ${d.message} (${d.agent})`)),
  ];

  if (ctx.blockers.length > 0) {
    lines.push(
      "",
      "## Open blockers",
      "",
      ...ctx.blockers.map((b) => `- [${b.task_id ?? "change"}] ${b.message} (${b.agent})`),
    );
  }

  lines.push(
    "",
    "## Next",
    "",
    ctx.available.length === 0
      ? "_nothing available to claim_"
      : `Claim one of: ${ctx.available.map((t) => t.id).join(", ")}`,
  );

  if (ctx.oversized.length > 0) {
    lines.push(
      "",
      `_Context cap exceeded on ${ctx.oversized.map((o) => o.file).join(", ")}; run \`specocd digest ${ctx.change}\`._`,
    );
  }

  return lines.join("\n") + "\n";
}
