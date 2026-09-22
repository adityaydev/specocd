import { existsSync } from "node:fs";
import path from "node:path";
import type { BindingGenerator, GeneratedFile } from "./types.js";
import { SHORT_SUMMARY, WORKFLOW } from "./workflow.js";

function prompt(name: string, description: string, body: string): GeneratedFile {
  return {
    path: path.join(".github", "prompts", `specdd-${name}.prompt.md`),
    mode: "replace",
    contents: `---\nmode: agent\ndescription: ${description}\n---\n\n${body}\n`,
  };
}

/**
 * Copilot reads repo-wide instructions from .github/copilot-instructions.md — a file
 * users often already own, so that one is spliced as a managed block.
 */
export const copilotBinding: BindingGenerator = {
  name: "copilot",

  detect(root: string): boolean {
    return (
      existsSync(path.join(root, ".github", "copilot-instructions.md")) ||
      existsSync(path.join(root, ".github", "prompts")) ||
      Boolean(process.env.COPILOT_AGENT)
    );
  },

  generate(): GeneratedFile[] {
    return [
      {
        path: path.join(".github", "copilot-instructions.md"),
        mode: "managed-block",
        contents: `# SpecOCD\n\n${SHORT_SUMMARY}\n\n${WORKFLOW}`,
      },
      prompt(
        "work",
        "Claim and implement a task from a SpecOCD change",
        `Claim and implement a task from a SpecOCD change.

Run \`specdd status\` first, claim the task you intend to work, then implement only what
that task covers.

${WORKFLOW}`,
      ),
      prompt(
        "verify",
        "Verify a SpecOCD change against its WHEN/THEN acceptance criteria",
        `Run \`specdd verify <change>\`, then check each WHEN/THEN requirement against the
actual implementation. Report per-requirement pass/fail with evidence (file:line, test
output). Never mark a requirement verified from the spec alone.

${WORKFLOW}`,
      ),
    ];
  },
};
