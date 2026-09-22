import { existsSync, readdirSync } from "node:fs";
import { loadConfig } from "../config.js";
import { isStale, loadClaims, type Claim } from "../core/claims.js";
import { findOversized, type OversizedArtifact } from "../core/digest.js";
import { changeDir, changesDir } from "../paths.js";

export interface ChangeStatus {
  change: string;
  active: Claim[];
  stale: Claim[];
  finished: Claim[];
  oversized: OversizedArtifact[];
}

export function listChanges(root: string): string[] {
  const dir = changesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "archive")
    .map((e) => e.name)
    .sort();
}

export function status(root: string, change?: string): ChangeStatus[] {
  const config = loadConfig(root);
  const changes = change ? [change] : listChanges(root);

  return changes.map((name) => {
    if (!existsSync(changeDir(root, name))) throw new Error(`No such change: "${name}".`);
    const { claims } = loadClaims(root, name);
    const active = claims.filter((c) => c.status === "active");
    return {
      change: name,
      active: active.filter((c) => !isStale(c, config.stale_claim_minutes)),
      stale: active.filter((c) => isStale(c, config.stale_claim_minutes)),
      finished: claims.filter((c) => c.status !== "active"),
      oversized: findOversized(root, name, config.size_cap_kb),
    };
  });
}
