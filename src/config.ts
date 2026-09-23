import { readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";
import { configPath } from "./paths.js";

export const SCHEMA_VERSION = 1;

export interface JiraSettings {
  /** 2 works on both Jira Cloud and Server; 3 is Cloud-only and needs ADF. */
  api_version: number;
  /** Transition or target status used for the QC handoff. */
  qc_transition: string;
}

export type BranchMode = "single" | "multi";
export type Integration = "pull-request" | "merge" | "none";
/** What the change is: decides the branch prefix. */
export type ChangeType = "feature" | "fix";

export interface GitSettings {
  /** "multi" puts each change on its own branch; "single" works on the current one. */
  mode: BranchMode;
  /** Branch prefix per kind of work: feature/PROJ-42-… or fix/PROJ-51-… */
  branch_prefix: Record<ChangeType, string>;
  /** Branch that finished work integrates into. */
  base_branch: string;
  remote: string;
  /** What happens on ship: open a pull request, merge directly, or neither. */
  integration: Integration;
  /** Push the change branch when shipping. */
  push: boolean;
  /**
   * Commit only after a human runs `specocd approve`. Turning this off would let an
   * agent commit unreviewed work, so it stays on unless someone opts out knowingly.
   */
  require_approval_to_commit: boolean;
}

export interface SpecOCDConfig {
  schema_version: number;
  require_approval: boolean;
  size_cap_kb: number;
  stale_claim_minutes: number;
  enabled_bindings: string[];
  jira: JiraSettings;
  git: GitSettings;
}

export const DEFAULT_CONFIG: SpecOCDConfig = {
  schema_version: SCHEMA_VERSION,
  require_approval: false,
  size_cap_kb: 50,
  stale_claim_minutes: 60,
  enabled_bindings: [],
  jira: {
    api_version: 2,
    qc_transition: "QA",
  },
  git: {
    mode: "multi",
    branch_prefix: { feature: "feature", fix: "fix" },
    base_branch: "main",
    remote: "origin",
    // A pull request is reviewable and revertible; merging straight to the base
    // branch is not, so that stays opt-in.
    integration: "pull-request",
    push: true,
    require_approval_to_commit: true,
  },
};

export function loadConfig(root: string): SpecOCDConfig {
  const raw = YAML.parse(readFileSync(configPath(root), "utf8")) ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    jira: { ...DEFAULT_CONFIG.jira, ...(raw.jira ?? {}) },
    git: {
      ...DEFAULT_CONFIG.git,
      ...(raw.git ?? {}),
      // A bare string is accepted and applied to both kinds, so an older config
      // (or someone who wants one prefix everywhere) keeps working.
      branch_prefix:
        typeof raw.git?.branch_prefix === "string"
          ? { feature: raw.git.branch_prefix, fix: raw.git.branch_prefix }
          : { ...DEFAULT_CONFIG.git.branch_prefix, ...(raw.git?.branch_prefix ?? {}) },
    },
  };
}

export function saveConfig(root: string, config: SpecOCDConfig): void {
  writeFileSync(configPath(root), YAML.stringify(config), "utf8");
}
