import { existsSync } from "node:fs";
import path from "node:path";
import type { BindingGenerator, GeneratedFile } from "./types.js";
import { SHORT_SUMMARY, WORKFLOW } from "./workflow.js";

/** Cursor reads project rules from .cursor/rules/*.mdc. */
export const cursorBinding: BindingGenerator = {
  name: "cursor",

  detect(root: string): boolean {
    return existsSync(path.join(root, ".cursor")) || Boolean(process.env.CURSOR_TRACE_ID);
  },

  generate(): GeneratedFile[] {
    return [
      {
        path: path.join(".cursor", "rules", "specdd.mdc"),
        mode: "replace",
        contents: `---
description: ${SHORT_SUMMARY}
globs:
  - ".specdd/**"
alwaysApply: true
---

${WORKFLOW}

## Commands

- \`specdd propose <name>\` — scaffold a change
- \`specdd status [change]\` — claims, stale claims, cap breaches
- \`specdd claim <change> <task-id>\` / \`specdd release <change> <task-id> --status completed\`
- \`specdd log <change> --task <id> --type decision --message "..."\` (\`--show\` to read)
- \`specdd verify <change>\` / \`specdd archive <change>\`
`,
      },
    ];
  },
};
