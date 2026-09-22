import { existsSync } from "node:fs";
import path from "node:path";

export const SPECOCD_DIR = ".specocd";

export class SpecddNotInitializedError extends Error {
  constructor() {
    super("No .specocd/ directory found. Run `specocd init` first.");
  }
}

/** Walks up from `start` looking for a .specocd/ directory. */
export function findRoot(start: string = process.cwd()): string | null {
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
  if (!root) throw new SpecddNotInitializedError();
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
