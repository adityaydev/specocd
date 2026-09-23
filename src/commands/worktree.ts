import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { loadClaims, updateClaims, type Claim } from "../core/claims.js";
import { addWorktree, isRepo, listWorktrees, removeWorktree, type Worktree } from "../core/git.js";
import { changeTicket, changeType, taskBranch } from "./branch.js";
import { loadConfig } from "../config.js";
import { changeDir } from "../paths.js";

export class NotARepoError extends Error {
  constructor() {
    super("Not a git repository, so there is nothing to make a worktree from.");
  }
}

/**
 * git reports fully resolved paths, while a cwd may reach the same directory through
 * a symlink (/tmp and /var on macOS are the common case). Comparing the raw strings
 * would miss a worktree that already exists.
 */
function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
}

/**
 * Worktrees live beside the repo rather than inside it: nesting a checkout under
 * the repo makes it show up in its own status and in every tool's file walk.
 */
export function worktreePath(root: string, change: string, taskId: string): string {
  const parent = path.dirname(root);
  const repo = path.basename(root);
  return path.join(parent, `${repo}-worktrees`, `${change}-${taskId.toLowerCase()}`);
}

export interface WorktreeResult {
  path: string;
  branch: string;
  existed: boolean;
}

/** Creates (or reuses) an isolated checkout for a task and records it on the claim. */
export function createWorktree(root: string, change: string, taskId: string): WorktreeResult {
  if (!isRepo(root)) throw new NotARepoError();
  if (!existsSync(changeDir(root, change))) throw new Error(`No such change: "${change}".`);

  const branch = taskBranch(loadConfig(root), change, taskId, {
    ticket: changeTicket(root, change),
    type: changeType(root, change),
  });
  const dir = worktreePath(root, change, taskId);

  const existing = listWorktrees(root).find((w) => samePath(w.path, dir));
  if (existing) return { path: path.resolve(dir), branch: existing.branch ?? branch, existed: true };

  const created = addWorktree(root, dir, branch);
  updateClaims(root, change, function (data) {
    const claim = data.claims.find((c) => c.task_id === taskId && c.status === "active");
    if (claim) claim.git = { ...(claim.git ?? {}), branch, worktree: created };
  });

  return { path: created, branch, existed: false };
}

export function dropWorktree(root: string, change: string, taskId: string, force = false): string {
  if (!isRepo(root)) throw new NotARepoError();
  const dir = worktreePath(root, change, taskId);
  removeWorktree(root, dir, force);

  updateClaims(root, change, function (data) {
    for (const claim of data.claims) {
      if (claim.task_id === taskId && claim.git?.worktree) claim.git.worktree = null;
    }
  });
  return dir;
}

export interface WorktreeListing extends Worktree {
  /** The claim this worktree belongs to, when one references it. */
  claim: Claim | null;
  change: string | null;
}

/** Worktrees this project created, matched back to the claims that own them. */
export function listTaskWorktrees(root: string, changes: string[]): WorktreeListing[] {
  if (!isRepo(root)) return [];

  const owners = new Map<string, { claim: Claim; change: string }>();
  for (const change of changes) {
    for (const claim of loadClaims(root, change).claims) {
      if (claim.git?.worktree) owners.set(claim.git.worktree, { claim, change });
    }
  }

  const ownerFor = function (p: string) {
    for (const [dir, owner] of owners) {
      if (samePath(dir, p)) return owner;
    }
    return undefined;
  };

  return listWorktrees(root)
    .filter((w) => ownerFor(w.path) !== undefined)
    .map(function (w) {
      const owner = ownerFor(w.path);
      return { ...w, claim: owner?.claim ?? null, change: owner?.change ?? null };
    });
}
