import { existsSync, readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";
import { SCHEMA_VERSION } from "../config.js";
import { changeFile } from "../paths.js";

export type ClaimStatus = "active" | "released" | "completed" | "abandoned";

export interface Claim {
  task_id: string;
  owner_agent: string;
  session_id: string;
  status: ClaimStatus;
  claimed_at: string;
  last_heartbeat: string;
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
  writeFileSync(claimsPath(root, change), YAML.stringify(data), "utf8");
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
): ClaimResult {
  const ts = now.toISOString();
  const existing = data.claims.find((c) => c.task_id === taskId && c.status === "active");

  if (existing) {
    if (existing.session_id === sessionId) {
      existing.last_heartbeat = ts;
      return { claim: existing };
    }
    if (!isStale(existing, staleMinutes, now)) {
      throw new ClaimConflictError(existing);
    }
    existing.status = "abandoned";
    const claim: Claim = {
      task_id: taskId,
      owner_agent: agent,
      session_id: sessionId,
      status: "active",
      claimed_at: ts,
      last_heartbeat: ts,
    };
    data.claims.push(claim);
    return { claim, tookOverFrom: existing };
  }

  const claim: Claim = {
    task_id: taskId,
    owner_agent: agent,
    session_id: sessionId,
    status: "active",
    claimed_at: ts,
    last_heartbeat: ts,
  };
  data.claims.push(claim);
  return { claim };
}

export function releaseTask(
  data: ClaimsFile,
  taskId: string,
  status: Exclude<ClaimStatus, "active">,
  now = new Date(),
): Claim {
  const claim = data.claims.find((c) => c.task_id === taskId && c.status === "active");
  if (!claim) throw new Error(`No active claim found for task ${taskId}.`);
  claim.status = status;
  claim.last_heartbeat = now.toISOString();
  return claim;
}
