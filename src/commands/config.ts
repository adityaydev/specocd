import { loadConfig, saveConfig, type SpecOCDConfig } from "../config.js";

interface Setting {
  describe: string;
  type: "string" | "boolean" | "number" | "enum";
  values?: Array<string | number>;
}

/**
 * The settings a person is expected to change, with the values each accepts. Driving
 * get/set from one table means a typo is rejected with the valid options rather than
 * silently falling back to a default, which is how `mode: mutli` would quietly leave
 * you on multi-branch behaviour.
 */
export const SETTINGS: Record<string, Setting> = {
  "git.mode": {
    describe: "multi = a branch per change; single = stay on the current branch",
    type: "enum",
    values: ["single", "multi"],
  },
  "git.branch_prefix.feature": { describe: "Prefix for feature branches", type: "string" },
  "git.branch_prefix.fix": { describe: "Prefix for bug fix branches", type: "string" },
  "git.base_branch": { describe: "Branch that finished work integrates into", type: "string" },
  "git.remote": { describe: "Remote to push to", type: "string" },
  "git.integration": {
    describe: "What happens on ship",
    type: "enum",
    values: ["pull-request", "merge", "none"],
  },
  "git.push": { describe: "Push the branch when shipping", type: "boolean" },
  "git.require_approval_to_commit": {
    describe: "Commit only via `specocd approve` (a human gate)",
    type: "boolean",
  },
  require_approval: { describe: "Archive requires approved: true", type: "boolean" },
  size_cap_kb: { describe: "Per-artifact context cap", type: "number" },
  stale_claim_minutes: { describe: "How long before an idle claim can be taken over", type: "number" },
  "jira.api_version": { describe: "2 (Cloud and Server) or 3 (Cloud, ADF)", type: "enum", values: [2, 3] },
  "jira.qc_transition": { describe: "Transition or status used for the QC handoff", type: "string" },
};

export class UnknownSettingError extends Error {
  constructor(key: string) {
    super(`Unknown setting "${key}".\n\nAvailable:\n${Object.keys(SETTINGS).map((k) => `  ${k}`).join("\n")}`);
  }
}

export class InvalidValueError extends Error {
  constructor(key: string, value: string, setting: Setting) {
    const allowed =
      setting.type === "enum"
        ? setting.values!.join(" | ")
        : setting.type === "boolean"
          ? "true | false"
          : setting.type;
    super(`"${value}" is not valid for ${key}. Expected: ${allowed}`);
  }
}

function read(config: SpecOCDConfig, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    return node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  }, config);
}

function write(config: SpecOCDConfig, key: string, value: unknown): void {
  const parts = key.split(".");
  const last = parts.pop() as string;
  const parent = parts.reduce<Record<string, unknown>>((node, part) => {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    return node[part] as Record<string, unknown>;
  }, config as unknown as Record<string, unknown>);
  parent[last] = value;
}

function coerce(key: string, raw: string, setting: Setting): unknown {
  switch (setting.type) {
    case "boolean": {
      if (["true", "yes", "on", "1"].includes(raw.toLowerCase())) return true;
      if (["false", "no", "off", "0"].includes(raw.toLowerCase())) return false;
      throw new InvalidValueError(key, raw, setting);
    }
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new InvalidValueError(key, raw, setting);
      return n;
    }
    case "enum": {
      const numeric = setting.values!.every((v) => typeof v === "number");
      const candidate: string | number = numeric ? Number(raw) : raw;
      if (!setting.values!.includes(candidate)) throw new InvalidValueError(key, raw, setting);
      return candidate;
    }
    default:
      return raw;
  }
}

export interface SettingView {
  key: string;
  value: unknown;
  describe: string;
  /** Set when the stored value is not one this setting accepts. */
  problem?: string;
}

export function listSettings(root: string): SettingView[] {
  const config = loadConfig(root);
  return Object.entries(SETTINGS).map(function ([key, setting]) {
    const value = read(config, key);
    let problem: string | undefined;
    if (setting.type === "enum" && !setting.values!.includes(value as string | number)) {
      problem = `not one of ${setting.values!.join(" | ")}`;
    } else if (setting.type === "boolean" && typeof value !== "boolean") {
      problem = "not a boolean";
    } else if (setting.type === "number" && typeof value !== "number") {
      problem = "not a number";
    }
    return { key, value, describe: setting.describe, problem };
  });
}

export function getSetting(root: string, key: string): unknown {
  if (!SETTINGS[key]) throw new UnknownSettingError(key);
  return read(loadConfig(root), key);
}

export function setSetting(root: string, key: string, raw: string): unknown {
  const setting = SETTINGS[key];
  if (!setting) throw new UnknownSettingError(key);

  const value = coerce(key, raw, setting);
  const config = loadConfig(root);
  write(config, key, value);
  saveConfig(root, config);
  return value;
}
