import { existsSync } from "node:fs";
import path from "node:path";
import type { BindingGenerator, GeneratedFile } from "./types.js";
import { SHORT_SUMMARY, WORKFLOW } from "./workflow.js";

/**
 * Codex reads AGENTS.md at the repo root. That file is commonly hand-written and shared
 * with other tools, so it is spliced as a managed block rather than overwritten.
 */
export const codexBinding: BindingGenerator = {
  name: "codex",

  detect(root: string): boolean {
    return (
      existsSync(path.join(root, "AGENTS.md")) ||
      existsSync(path.join(root, ".codex")) ||
      Boolean(process.env.CODEX_SESSION)
    );
  },

  generate(): GeneratedFile[] {
    return [
      {
        path: "AGENTS.md",
        mode: "managed-block",
        contents: `## Spec-OCD

${SHORT_SUMMARY}

${WORKFLOW}`,
      },
    ];
  },
};
