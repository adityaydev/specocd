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
        path: path.join(".cursor", "rules", "specocd.mdc"),
        mode: "replace",
        contents: `---
description: ${SHORT_SUMMARY}
globs:
  - ".specocd/**"
alwaysApply: true
---

${WORKFLOW}

## Commands

- \`specocd propose <name>\` — scaffold a change
- \`specocd status [change]\` — claims, stale claims, cap breaches
- \`specocd claim <change> <task-id>\` / \`specocd release <change> <task-id> --status completed\`
- \`specocd log <change> --task <id> --type decision --message "..."\` (\`--show\` to read)
- \`specocd verify <change>\` / \`specocd archive <change>\`
`,
      },
    ];
  },
};
