import { writeFileSync } from "node:fs";
import { loadConfig } from "../config.js";
import { appendEvent } from "../core/events.js";
import {
  compareUrl,
  createPullRequest,
  currentBranch,
  hasChanges,
  hasGhCli,
  hasRemote,
  isRepo,
  mergeBranch,
  push,
} from "../core/git.js";
import { readFrontMatter } from "../core/markdown.js";
import { resolveIdentity } from "../core/session.js";
import { changeFile } from "../paths.js";
import { resolveBranch } from "./branch.js";
import { handoff, type HandoffResult } from "./jira.js";
import { show } from "./show.js";
import { verify } from "./verify.js";

export class NotApprovedError extends Error {
  constructor(change: string) {
    super(
      `"${change}" has not been approved. Shipping pushes code and opens a pull request ` +
        `or merges, so it requires a human sign-off first: run \`specocd approve ${change}\`.`,
    );
  }
}

export interface ShipStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ShipResult {
  change: string;
  branch: string | null;
  steps: ShipStep[];
  prUrl: string | null;
  merged: boolean;
  pushed: boolean;
  jira: HandoffResult | null;
  manualPath?: string;
}

function manualDocument(change: string, branch: string | null, steps: ShipStep[], base: string, remote: string): string {
  const failed = steps.filter((s) => !s.ok);
  return `# Shipping ${change} — manual steps needed

SpecOCD could not finish:

${failed.map((s) => `- ${s.name}: ${s.detail}`).join("\n")}

Already done, do not repeat:

${steps.filter((s) => s.ok).map((s) => `- ${s.name}: ${s.detail}`).join("\n") || "- nothing"}

Finish by hand:

    git push --set-upstream ${remote} ${branch ?? "<branch>"}
    # then open a pull request against ${base}, or merge it

_Delete this file once you have finished._
`;
}

/**
 * Push, integrate, then update the ticket — in that order, so the ticket is never
 * told the work is ready when the code never left the machine.
 *
 * Every step here touches shared state, so the whole command refuses to run until a
 * human has approved the change.
 */
export async function ship(
  root: string,
  change: string,
  opts: { force?: boolean; dryRun?: boolean; skipJira?: boolean } = {},
): Promise<ShipResult> {
  const config = loadConfig(root);
  const front = readFrontMatter(changeFile(root, change, "proposal.md")).data;
  if (front.approved !== true && !opts.force) throw new NotApprovedError(change);

  const report = verify(root, change);
  if (report.blockers.length > 0 && !opts.force) {
    throw new Error(
      `"${change}" no longer passes verification:\n` + report.blockers.map((b) => `  - ${b}`).join("\n"),
    );
  }

  const steps: ShipStep[] = [];
  const branch = isRepo(root) ? (resolveBranch(root, change) ?? currentBranch(root)) : null;
  const { base_branch: base, remote, integration } = config.git;
  let prUrl: string | null = null;
  let merged = false;
  let pushed = false;

  if (opts.dryRun) {
    const plan = [
      config.git.push && branch ? `push ${branch} to ${remote}` : null,
      integration === "pull-request" ? `open a pull request against ${base}` : null,
      integration === "merge" ? `merge ${branch} into ${base}` : null,
      typeof front.jira === "string" && !opts.skipJira ? `update ${front.jira}` : null,
    ].filter(Boolean);
    steps.push({
      name: "dry run",
      ok: true,
      detail: plan.length > 0 ? `would ${plan.join(", then ")}` : "nothing configured to do",
    });
    return { change, branch, steps, prUrl, merged, pushed, jira: null };
  }

  if (!isRepo(root)) {
    steps.push({ name: "git", ok: true, detail: "not a repository; nothing to push" });
  } else {
    if (hasChanges(root)) {
      steps.push({
        name: "working tree",
        ok: false,
        detail: "uncommitted changes — approve again to commit them before shipping",
      });
    }

    if (config.git.push && branch) {
      if (!hasRemote(root, remote)) {
        steps.push({ name: "push", ok: false, detail: `no remote named "${remote}"` });
      } else {
        try {
          push(root, remote, branch);
          pushed = true;
          steps.push({ name: "push", ok: true, detail: `${branch} → ${remote}` });
        } catch (error) {
          steps.push({ name: "push", ok: false, detail: (error as Error).message });
        }
      }
    }

    if (pushed && integration === "pull-request" && branch) {
      const ctx = show(root, change);
      const title = ctx.jira ? `${ctx.jira}: ${change}` : change;
      if (hasGhCli()) {
        try {
          prUrl = createPullRequest(root, { base, head: branch, title, body: prBody(root, change) });
          steps.push({ name: "pull request", ok: true, detail: prUrl });
        } catch (error) {
          steps.push({ name: "pull request", ok: false, detail: (error as Error).message });
        }
      } else {
        const url = compareUrl(root, remote, base, branch);
        steps.push({
          name: "pull request",
          ok: false,
          detail: url
            ? `GitHub CLI not installed. Open one here: ${url}`
            : "GitHub CLI not installed and the remote is not a recognised host.",
        });
      }
    }

    if (integration === "merge" && branch) {
      try {
        mergeBranch(root, branch, base);
        merged = true;
        steps.push({ name: "merge", ok: true, detail: `${branch} → ${base}` });
      } catch (error) {
        steps.push({ name: "merge", ok: false, detail: (error as Error).message });
      }
    }
  }

  // The ticket is updated last, so it never claims readiness the repo cannot back up.
  let jira: HandoffResult | null = null;
  const ticket = typeof front.jira === "string" ? front.jira : null;
  if (ticket && !opts.skipJira) {
    const blocked = steps.some((s) => !s.ok);
    if (blocked && !opts.force) {
      steps.push({ name: "jira", ok: false, detail: "skipped: the code did not ship cleanly" });
    } else {
      jira = await handoff(root, { change, key: ticket });
      steps.push({
        name: "jira",
        ok: jira.failures.length === 0,
        detail:
          jira.failures.length === 0
            ? `commented and moved to ${jira.transitionedTo ?? jira.qcStage}`
            : jira.failures.join(" | "),
      });
    }
  }

  const identity = resolveIdentity();
  const failed = steps.filter((s) => !s.ok);
  appendEvent(root, change, {
    task_id: null,
    agent: identity.agent,
    session_id: identity.session_id,
    type: "handoff",
    message:
      failed.length === 0
        ? `Shipped: ${steps.map((s) => s.name).join(", ")}`
        : `Ship incomplete: ${failed.map((s) => `${s.name} (${s.detail})`).join(" | ")}`,
  });

  let manualPath: string | undefined;
  if (failed.length > 0) {
    manualPath = changeFile(root, change, "ship-manual.md");
    writeFileSync(manualPath, manualDocument(change, branch, steps, base, remote), "utf8");
  }

  return { change, branch, steps, prUrl, merged, pushed, jira, manualPath };
}

export function prBody(root: string, change: string): string {
  const ctx = show(root, change);
  const lines = ["## What this does", "", `Implements \`${change}\`.`, "", "## Acceptance criteria", ""];

  for (const r of ctx.requirements) {
    lines.push(`- **${r.id}** ${r.title}`, `  - WHEN ${r.whens.join("; ")}`, `  - THEN ${r.thens.join("; ")}`);
  }

  lines.push("", "## Tasks", "");
  for (const t of ctx.tasks) lines.push(`- [${t.done ? "x" : " "}] ${t.id}: ${t.title}`);

  const decisions = ctx.decisions.slice(-8);
  if (decisions.length > 0) {
    lines.push("", "## Decisions", "");
    for (const d of decisions) lines.push(`- ${d.message}`);
  }
  if (ctx.jira) lines.push("", `Ticket: ${ctx.jira}`);

  lines.push(
    "",
    "---",
    "_Verified against the criteria above and approved by a developer before shipping._",
  );
  return lines.join("\n");
}
