import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";
import { SCHEMA_VERSION } from "../config.js";
import { changeFile } from "../paths.js";
import { writeFileAtomic } from "./atomic.js";
import { withLock } from "./lock.js";

export type ClaimStatus = "active" | "released" | "completed" | "abandoned";

/** Git provenance, absent when the project is not a git repository. */
export interface ClaimGit {
  branch?: string | null;
  /** HEAD when the task was claimed, so the work can be diffed against it later. */
  start_sha?: string | null;
  /** HEAD when the claim ended. */
  end_sha?: string | null;
  /** Isolated checkout created for this task, when one was requested. */
  worktree?: string | null;
}

export interface Claim {
  task_id: string;
  owner_agent: string;
  session_id: string;
  status: ClaimStatus;
  claimed_at: string;
  last_heartbeat: string;
  git?: ClaimGit;
}

export interface ClaimsFile {
  schema_version: number;
  claims: Claim[];
}

const EMPTY: ClaimsFile = { schema_version: SCHEMA_VERSION, claims: [] };

function claimsPath(root: string, change: string): string {
  return changeFile(root, change, "claims.yaml");
}

export function loadClaims(root: string, change: string): ClaimsFile {
  const file = claimsPath(root, change);
  if (!existsSync(file)) return { ...EMPTY, claims: [] };
  const parsed = YAML.parse(readFileSync(file, "utf8")) ?? {};
  return {
    schema_version: parsed.schema_version ?? SCHEMA_VERSION,
    claims: parsed.claims ?? [],
  };
}

export function saveClaims(root: string, change: string, data: ClaimsFile): void {
  writeFileAtomic(claimsPath(root, change), YAML.stringify(data));
}

function lockPath(root: string, change: string): string {
  return changeFile(root, change, "claims.lock");
}

/**
 * Runs a load/mutate/save cycle under a cross-process lock. Every mutation of the
 * claim registry must go through this: reading and writing as separate steps lets
 * two concurrent agents each miss the other's claim.
 */
export function updateClaims<T>(
  root: string,
  change: string,
  mutate: (data: ClaimsFile) => T,
): T {
  return withLock(lockPath(root, change), function () {
    const data = loadClaims(root, change);
    const result = mutate(data);
    saveClaims(root, change, data);
    return result;
  });
}

export function isStale(claim: Claim, staleMinutes: number, now = new Date()): boolean {
  if (claim.status !== "active") return false;
  const age = now.getTime() - new Date(claim.last_heartbeat).getTime();
  return age > staleMinutes * 60_000;
}

export interface ClaimResult {
  claim: Claim;
  /** Set when an existing stale claim by another session was taken over. */
  tookOverFrom?: Claim;
}

export class ClaimConflictError extends Error {
  constructor(public readonly existing: Claim) {
    super(
      `Task ${existing.task_id} is already claimed by ${existing.owner_agent} ` +
        `(session ${existing.session_id}, last heartbeat ${existing.last_heartbeat}). ` +
        `Wait for it to be released, or let the claim go stale.`,
    );
  }
}

export function claimTask(
  data: ClaimsFile,
  taskId: string,
  agent: string,
  sessionId: string,
  staleMinutes: number,
  now = new Date(),
  gitContext?: ClaimGit,
): ClaimResult {
  const ts = now.toISOString();
  const existing = data.claims.find((c) => c.task_id === taskId && c.status === "active");

  const fresh = (): Claim => ({
    task_id: taskId,
    owner_agent: agent,
    session_id: sessionId,
    status: "active",
    claimed_at: ts,
    last_heartbeat: ts,
    ...(gitContext ? { git: gitContext } : {}),
  });

  if (existing) {
    if (existing.session_id === sessionId) {
      existing.last_heartbeat = ts;
      return { claim: existing };
    }
    if (!isStale(existing, staleMinutes, now)) {
      throw new ClaimConflictError(existing);
    }
    existing.status = "abandoned";
    const claim = fresh();
    data.claims.push(claim);
    return { claim, tookOverFrom: existing };
  }

  const claim = fresh();
  data.claims.push(claim);
  return { claim };
}

/**
 * Refreshes the heartbeat on a task this session already holds. Without this, a claim
 * only gets a timestamp when it is taken, so an agent working longer than the staleness
 * window has its task declared abandoned and reclaimed while it is still working.
 */
export function touchClaim(
  data: ClaimsFile,
  taskId: string,
  sessionId: string,
  now = new Date(),
): Claim | null {
  const claim = data.claims.find(
    (c) => c.task_id === taskId && c.status === "active" && c.session_id === sessionId,
  );
  if (!claim) return null;
  claim.last_heartbeat = now.toISOString();
  return claim;
}

export function releaseTask(
  data: ClaimsFile,
  taskId: string,
  status: Exclude<ClaimStatus, "active">,
  now = new Date(),
  endSha?: string | null,
): Claim {
  const claim = data.claims.find((c) => c.task_id === taskId && c.status === "active");
  if (!claim) throw new Error(`No active claim found for task ${taskId}.`);
  claim.status = status;
  claim.last_heartbeat = now.toISOString();
  if (endSha) claim.git = { ...(claim.git ?? {}), end_sha: endSha };
  return claim;
}
