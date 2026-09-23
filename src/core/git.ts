import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Git is optional throughout: SpecOCD must work in a directory that was never
 * initialised, so every helper returns null rather than throwing when git is
 * absent, the directory is not a repo, or the command fails.
 */
export function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function isRepo(root: string): boolean {
  return git(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

/**
 * The main checkout of a repository, from anywhere inside it. A linked worktree has
 * its own .git pointer but shares the common dir, so its parent is the main root.
 * Coordination state lives there and nowhere else: every worktree checks out its own
 * copy of .specocd/, and agents writing to those copies would each hold a private
 * view of who claimed what.
 */
export function mainWorktreeRoot(start: string): string | null {
  let common = git(start, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common) {
    // --path-format predates git 2.31; fall back to resolving the relative form.
    const relative = git(start, ["rev-parse", "--git-common-dir"]);
    if (!relative) return null;
    common = path.resolve(start, relative);
  }
  return path.basename(common) === ".git" ? path.dirname(common) : null;
}

export function currentBranch(root: string): string | null {
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch === "HEAD" ? null : branch; // detached
}

export function headSha(root: string): string | null {
  return git(root, ["rev-parse", "HEAD"]);
}

export function isDirty(root: string): boolean {
  const out = git(root, ["status", "--porcelain"]);
  return out !== null && out !== "";
}

export function shortSha(sha: string | null | undefined): string | null {
  return sha ? sha.slice(0, 7) : null;
}

export interface RepoState {
  isRepo: boolean;
  branch: string | null;
  sha: string | null;
  dirty: boolean;
}

export function repoState(root: string): RepoState {
  if (!isRepo(root)) return { isRepo: false, branch: null, sha: null, dirty: false };
  return { isRepo: true, branch: currentBranch(root), sha: headSha(root), dirty: isDirty(root) };
}

/** Files changed between two commits, used to show what a task actually touched. */
export function changedFiles(root: string, from: string, to: string): string[] {
  const out = git(root, ["diff", "--name-only", `${from}..${to}`]);
  return out ? out.split("\n").filter(Boolean) : [];
}

export function branchExists(root: string, branch: string): boolean {
  return git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]) !== null;
}

/** Branch name for a task's isolated worktree. Namespaced so it is obvious who made it. */
export function taskBranch(change: string, taskId: string): string {
  return `specocd/${change}/${taskId.toLowerCase()}`;
}

export interface Worktree {
  path: string;
  branch: string | null;
}

export function listWorktrees(root: string): Worktree[] {
  const out = git(root, ["worktree", "list", "--porcelain"]);
  if (!out) return [];
  const trees: Worktree[] = [];
  let current: Partial<Worktree> = {};
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) trees.push({ path: current.path, branch: current.branch ?? null });
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }
  if (current.path) trees.push({ path: current.path, branch: current.branch ?? null });
  return trees;
}

export class GitError extends Error {}

/**
 * Creates an isolated checkout so two agents can build different tasks of the same
 * change at once without fighting over one working tree.
 */
export function addWorktree(root: string, dir: string, branch: string): string {
  const args = branchExists(root, branch)
    ? ["worktree", "add", dir, branch]
    : ["worktree", "add", "-b", branch, dir];

  if (git(root, args) === null) {
    throw new GitError(
      `Could not create a worktree at ${dir} on branch ${branch}. ` +
        "Check the path is free and the branch is not already checked out elsewhere " +
        "(`git worktree list`).",
    );
  }
  return path.resolve(root, dir);
}

export function removeWorktree(root: string, dir: string, force = false): void {
  const args = ["worktree", "remove", dir];
  if (force) args.push("--force");
  if (git(root, args) === null) {
    throw new GitError(
      `Could not remove the worktree at ${dir}. If it has uncommitted changes, commit ` +
        "them or re-run with --force to discard them.",
    );
  }
}
