import { loadConfig, type ChangeType, type SpecOCDConfig } from "../config.js";
import { branchExists, checkout, currentBranch, isRepo } from "../core/git.js";
import { readFrontMatter, updateFrontMatter } from "../core/markdown.js";
import { changeFile } from "../paths.js";

/** Keeps branch names short enough to read in a list, trimming whole words only. */
const MAX_SLUG_LENGTH = 40;

function trimWords(slug: string, maxLength: number): string {
  if (slug.length <= maxLength) return slug;
  const kept: string[] = [];
  for (const word of slug.split("-")) {
    const candidate = [...kept, word].join("-");
    if (candidate.length > maxLength && kept.length > 0) break;
    kept.push(word);
  }
  return kept.join("-");
}

/**
 * The branch-safe form of a change name. A JIRA key is restored to upper case:
 * Atlassian's git integration and most CI rules match the uppercase key to link a
 * branch back to its ticket, and a lower-cased key silently breaks that.
 */
export function branchSlug(change: string, jiraKey?: string | null, maxLength = MAX_SLUG_LENGTH): string {
  let slug = change;
  if (jiraKey && jiraKey.trim() !== "") {
    const key = jiraKey.trim();
    const lower = key.toLowerCase();
    if (slug === lower) slug = key;
    else if (slug.startsWith(`${lower}-`)) slug = key + slug.slice(lower.length);
    else slug = `${key}-${slug}`;
  }
  return trimWords(slug, maxLength);
}

/**
 * `feature/{TICKET-ID}-{kebab-desc}`, or `fix/…` for bug work. Changes without a
 * ticket simply drop that segment: `feature/rate-limiting`.
 */
export function changeBranch(
  config: SpecOCDConfig,
  change: string,
  opts: { ticket?: string | null; type?: ChangeType } = {},
): string {
  const prefix = (config.git.branch_prefix[opts.type ?? "feature"] ?? "").replace(/\/+$/, "");
  const slug = branchSlug(change, opts.ticket);
  return prefix === "" ? slug : `${prefix}/${slug}`;
}

/**
 * `feature/rate-limiting-t1`, sitting beside its change branch so
 * `git branch --list 'feature/rate-limiting*'` shows the whole family.
 *
 * The task is appended with a dash rather than a slash because git refs are paths:
 * `feature/rate-limiting` and `feature/rate-limiting/t1` cannot both exist, since the
 * first occupies the file name the second needs as a directory.
 */
export function taskBranch(
  config: SpecOCDConfig,
  change: string,
  taskId: string,
  opts: { ticket?: string | null; type?: ChangeType } = {},
): string {
  return `${changeBranch(config, change, opts)}-${taskId.toLowerCase()}`;
}

/** The JIRA key linked to a change, when there is one. */
export function changeTicket(root: string, change: string): string | null {
  const jira = readFrontMatter(changeFile(root, change, "proposal.md")).data.jira;
  return typeof jira === "string" && jira.trim() !== "" ? jira.trim() : null;
}

/** Feature unless the proposal says otherwise, which `jira start` sets from the issue type. */
export function changeType(root: string, change: string): ChangeType {
  const type = readFrontMatter(changeFile(root, change, "proposal.md")).data.type;
  return type === "fix" ? "fix" : "feature";
}

export function branchFor(root: string, change: string): string {
  return changeBranch(loadConfig(root), change, {
    ticket: changeTicket(root, change),
    type: changeType(root, change),
  });
}

/**
 * The branch a change belongs to. Recorded on the proposal the first time it is
 * resolved, so later commands agree even if the developer moves around.
 */
export function resolveBranch(root: string, change: string): string | null {
  const config = loadConfig(root);
  if (!isRepo(root)) return null;

  const proposal = changeFile(root, change, "proposal.md");
  const recorded = readFrontMatter(proposal).data.branch;
  if (typeof recorded === "string" && recorded.trim() !== "") return recorded;

  // Single mode deliberately stays on whatever branch the developer is already on.
  return config.git.mode === "single" ? currentBranch(root) : branchFor(root, change);
}

export interface BranchResult {
  branch: string;
  created: boolean;
  switched: boolean;
  mode: "single" | "multi";
}

/**
 * Puts the working tree on the change's branch, creating it if needed. In single
 * mode this is a no-op beyond recording which branch the change belongs to.
 */
export function useBranch(root: string, change: string): BranchResult {
  const config = loadConfig(root);
  if (!isRepo(root)) throw new Error("Not a git repository, so there is no branch to use.");

  const proposal = changeFile(root, change, "proposal.md");
  const current = currentBranch(root);

  if (config.git.mode === "single") {
    const branch = current ?? config.git.base_branch;
    updateFrontMatter(proposal, { branch });
    return { branch, created: false, switched: false, mode: "single" };
  }

  const branch = resolveBranch(root, change) ?? branchFor(root, change);
  const existed = branchExists(root, branch);
  if (current !== branch) checkout(root, branch, !existed);
  updateFrontMatter(proposal, { branch });

  return { branch, created: !existed, switched: current !== branch, mode: "multi" };
}
