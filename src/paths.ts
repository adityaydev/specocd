import { existsSync } from "node:fs";
import path from "node:path";

export const SPECDD_DIR = ".specdd";

export class SpecddNotInitializedError extends Error {
  constructor() {
    super("No .specdd/ directory found. Run `specdd init` first.");
  }
}

/** Walks up from `start` looking for a .specdd/ directory. */
export function findRoot(start: string = process.cwd()): string | null {
  let dir = path.resolve(start);
  while (true) {
    if (existsSync(path.join(dir, SPECDD_DIR))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireRoot(start?: string): string {
  const root = findRoot(start);
  if (!root) throw new SpecddNotInitializedError();
  return root;
}

export function specddPath(root: string): string {
  return path.join(root, SPECDD_DIR);
}

export function configPath(root: string): string {
  return path.join(specddPath(root), "config.yaml");
}

export function specsDir(root: string): string {
  return path.join(specddPath(root), "specs");
}

export function changesDir(root: string): string {
  return path.join(specddPath(root), "changes");
}

export function archiveDir(root: string): string {
  return path.join(changesDir(root), "archive");
}

export function changeDir(root: string, change: string): string {
  return path.join(changesDir(root), change);
}

export function bindingsDir(root: string): string {
  return path.join(specddPath(root), "bindings");
}

export function changeFile(root: string, change: string, file: string): string {
  return path.join(changeDir(root, change), file);
}
