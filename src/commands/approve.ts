import { loadConfig } from "../config.js";
import { appendEvent } from "../core/events.js";
import { commit, currentBranch, hasChanges, headSha, isRepo, shortSha, stageAll } from "../core/git.js";
import { updateFrontMatter } from "../core/markdown.js";
import { resolveIdentity } from "../core/session.js";
import { changeFile } from "../paths.js";
import { resolveBranch } from "./branch.js";
import { verify, type VerifyReport } from "./verify.js";
import { show } from "./show.js";

export class NotVerifiedError extends Error {
  constructor(public readonly report: VerifyReport) {
    super(
      `"${report.change}" does not pass verification yet:\n` +
        report.blockers.map((b) => `  - ${b}`).join("\n") +
        "\n\nApproval is the human sign-off on verified work, so resolve these first " +
        "(or pass --force if you are knowingly approving anyway).",
    );
  }
}

export interface ApproveResult {
  change: string;
  sha: string | null;
  branch: string | null;
  committed: boolean;
  message: string;
  /** Nothing to commit is normal when the agent already committed as it worked. */
  nothingToCommit: boolean;
}

/** The commit message for approved work: what was built, and what it satisfies. */
export function commitMessage(root: string, change: string): string {
  const ctx = show(root, change);
  const lines = [`${change}: ${ctx.requirements.length} requirement(s) verified`, ""];

  for (const r of ctx.requirements) lines.push(`${r.id}: ${r.title}`);
  if (ctx.tasks.length > 0) {
    lines.push("");
    for (const t of ctx.tasks) lines.push(`- [${t.done ? "x" : " "}] ${t.id}: ${t.title}`);
  }
  const decisions = ctx.decisions.slice(-5);
  if (decisions.length > 0) {
    lines.push("", "Decisions:");
    for (const d of decisions) lines.push(`- ${d.message}`);
  }
  if (ctx.jira) lines.push("", `Refs: ${ctx.jira}`);

  return lines.join("\n");
}

/**
 * The human gate. Everything downstream — pushing, merging, opening a pull request,
 * moving the ticket — is authorised by this step, so it is deliberately a separate
 * command a person runs, never something an agent can reach on its own.
 */
export function approve(
  root: string,
  change: string,
  opts: { force?: boolean; message?: string } = {},
): ApproveResult {
  const report = verify(root, change);
  if (report.blockers.length > 0 && !opts.force) throw new NotVerifiedError(report);

  const config = loadConfig(root);
  const identity = resolveIdentity();
  const proposal = changeFile(root, change, "proposal.md");
  const branch = isRepo(root) ? (currentBranch(root) ?? resolveBranch(root, change)) : null;

  const message = opts.message ?? commitMessage(root, change);

  // The approval marker and its event are written first so they land in the same
  // commit. Writing them afterwards would leave the tree dirty the moment it was
  // supposed to be clean, and shipping would refuse on changes approval itself made.
  updateFrontMatter(proposal, {
    approved: true,
    approved_at: new Date().toISOString(),
    ...(branch ? { branch } : {}),
  });

  appendEvent(root, change, {
    task_id: null,
    agent: identity.agent,
    session_id: identity.session_id,
    type: "status",
    message: "Approved by developer after verification",
  });

  let sha: string | null = null;
  let committed = false;
  let nothingToCommit = false;

  if (isRepo(root) && config.git.require_approval_to_commit) {
    if (hasChanges(root)) {
      stageAll(root);
      sha = commit(root, message);
      committed = true;
    } else {
      nothingToCommit = true;
      sha = headSha(root);
    }
  }

  return { change, sha, branch, committed, message, nothingToCommit };
}
