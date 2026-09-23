import { existsSync } from "node:fs";
import path from "node:path";
import { mainWorktreeRoot } from "./core/git.js";

export const SPECOCD_DIR = ".specocd";

export class SpecOCDNotInitializedError extends Error {
  constructor() {
    super("No .specocd/ directory found. Run `specocd init` first.");
  }
}

/**
 * Locates the project whose coordination state applies here.
 *
 * Inside a linked git worktree this deliberately resolves to the MAIN checkout. A
 * worktree carries its own committed copy of .specocd/, and honouring that copy would
 * hand each agent a private claim registry — exactly the collision the framework
 * exists to prevent.
 */
export function findRoot(start: string = process.cwd()): string | null {
  const main = mainWorktreeRoot(start);
  if (main && existsSync(path.join(main, SPECOCD_DIR))) return main;

  let dir = path.resolve(start);
  while (true) {
    if (existsSync(path.join(dir, SPECOCD_DIR))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireRoot(start?: string): string {
  const root = findRoot(start);
  if (!root) throw new SpecOCDNotInitializedError();
  return root;
}

export function specocdPath(root: string): string {
  return path.join(root, SPECOCD_DIR);
}

export function configPath(root: string): string {
  return path.join(specocdPath(root), "config.yaml");
}

export function specsDir(root: string): string {
  return path.join(specocdPath(root), "specs");
}

export function changesDir(root: string): string {
  return path.join(specocdPath(root), "changes");
}

export function archiveDir(root: string): string {
  return path.join(changesDir(root), "archive");
}

export function changeDir(root: string, change: string): string {
  return path.join(changesDir(root), change);
}

export function bindingsDir(root: string): string {
  return path.join(specocdPath(root), "bindings");
}

export function changeFile(root: string, change: string, file: string): string {
  return path.join(changeDir(root, change), file);
}
