import { readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";
import { configPath } from "./paths.js";

export const SCHEMA_VERSION = 1;

export interface SpecddConfig {
  schema_version: number;
  require_approval: boolean;
  size_cap_kb: number;
  stale_claim_minutes: number;
  enabled_bindings: string[];
}

export const DEFAULT_CONFIG: SpecddConfig = {
  schema_version: SCHEMA_VERSION,
  require_approval: false,
  size_cap_kb: 50,
  stale_claim_minutes: 60,
  enabled_bindings: [],
};

export function loadConfig(root: string): SpecddConfig {
  const raw = YAML.parse(readFileSync(configPath(root), "utf8")) ?? {};
  return { ...DEFAULT_CONFIG, ...raw };
}

export function saveConfig(root: string, config: SpecddConfig): void {
  writeFileSync(configPath(root), YAML.stringify(config), "utf8");
}
