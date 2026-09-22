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

export interface SpecddConfig {
  schema_version: number;
  require_approval: boolean;
  size_cap_kb: number;
  stale_claim_minutes: number;
  enabled_bindings: string[];
  jira: JiraSettings;
}

export const DEFAULT_CONFIG: SpecddConfig = {
  schema_version: SCHEMA_VERSION,
  require_approval: false,
  size_cap_kb: 50,
  stale_claim_minutes: 60,
  enabled_bindings: [],
  jira: {
    api_version: 2,
    qc_transition: "QA",
  },
};

export function loadConfig(root: string): SpecddConfig {
  const raw = YAML.parse(readFileSync(configPath(root), "utf8")) ?? {};
  return { ...DEFAULT_CONFIG, ...raw, jira: { ...DEFAULT_CONFIG.jira, ...(raw.jira ?? {}) } };
}

export function saveConfig(root: string, config: SpecddConfig): void {
  writeFileSync(configPath(root), YAML.stringify(config), "utf8");
}
