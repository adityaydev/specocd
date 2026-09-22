import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG, saveConfig, type SpecddConfig } from "../config.js";
import { detectBindings, writeBindings } from "../bindings/index.js";
import { archiveDir, changesDir, configPath, specocdPath, specsDir, bindingsDir } from "../paths.js";

const README = `# .specocd/

Spec-driven development artifacts for this project.

- \`specs/\` — persistent baseline requirements (source of truth)
- \`changes/<slug>/\` — in-flight changes: proposal, requirement deltas, tasks,
  claim registry (\`claims.yaml\`) and append-only event log (\`events.jsonl\`)
- \`changes/archive/\` — completed changes, frozen
- \`config.yaml\` — size caps, staleness window, approval gate, enabled bindings

Everything here is plain text and meant to be committed. Never put credentials,
tokens or PII in these files.
`;

export interface InitResult {
  root: string;
  alreadyInitialized: boolean;
  bindings: string[];
  bindingFiles: string[];
}

export function init(root: string): InitResult {
  const alreadyInitialized = existsSync(configPath(root));

  for (const dir of [specocdPath(root), specsDir(root), changesDir(root), archiveDir(root), bindingsDir(root)]) {
    mkdirSync(dir, { recursive: true });
  }

  const bindings = detectBindings(root);

  if (!alreadyInitialized) {
    const config: SpecddConfig = { ...DEFAULT_CONFIG, enabled_bindings: bindings };
    saveConfig(root, config);
    writeFileSync(path.join(specocdPath(root), "README.md"), README, "utf8");
  }

  const bindingFiles = writeBindings(root, bindings);
  return { root, alreadyInitialized, bindings, bindingFiles };
}
