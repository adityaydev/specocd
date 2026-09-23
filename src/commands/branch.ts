import { loadConfig, type SpecOCDConfig } from "../config.js";
import { branchExists, checkout, currentBranch, isRepo } from "../core/git.js";
import { readFrontMatter, updateFrontMatter } from "../core/markdown.js";
import { changeFile } from "../paths.js";

/** `feature/rate-limiting` in multi mode. */
export function changeBranch(config: SpecOCDConfig, change: string): string {
  const prefix = config.git.branch_prefix.replace(/\/+$/, "");
  return prefix === "" ? change : `${prefix}/${change}`;
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
  return config.git.mode === "single" ? currentBranch(root) : changeBranch(config, change);
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

  const branch = resolveBranch(root, change) ?? changeBranch(config, change);
  const existed = branchExists(root, branch);
  if (current !== branch) checkout(root, branch, !existed);
  updateFrontMatter(proposal, { branch });

  return { branch, created: !existed, switched: current !== branch, mode: "multi" };
}
