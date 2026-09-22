import { existsSync } from "node:fs";
import path from "node:path";
import type { BindingGenerator, GeneratedFile } from "./types.js";
import { WORKFLOW } from "./workflow.js";

function command(name: string, description: string, body: string): GeneratedFile {
  return {
    path: path.join(".claude", "commands", `specocd-${name}.md`),
    contents: `---\ndescription: ${description}\n---\n\n${body}\n`,
    mode: "replace",
  };
}

export const claudeCodeBinding: BindingGenerator = {
  name: "claude-code",

  detect(root: string): boolean {
    return (
      existsSync(path.join(root, ".claude")) ||
      Boolean(process.env.CLAUDECODE || process.env.CLAUDE_CODE)
    );
  },

  generate(): GeneratedFile[] {
    return [
      command(
        "propose",
        "Create a new SpecOCD change (proposal + requirement deltas + tasks)",
        `Create a new change for: $ARGUMENTS

Run \`specocd propose <slug>\` to scaffold the change folder, then fill in:
- \`proposal.md\` — why this change, what is in and out of scope
- \`spec-delta.md\` — acceptance criteria as WHEN/THEN requirements with ids (R1, R2...)
- \`tasks.md\` — implementation tasks with stable ids (T1, T2...)

${WORKFLOW}`,
      ),
      command(
        "work",
        "Claim and implement a task from a SpecOCD change",
        `Work on: $ARGUMENTS

${WORKFLOW}

Implement only what the claimed task covers. If the task needs to change scope, log it
as a decision rather than silently expanding the work.`,
      ),
      command(
        "status",
        "Show SpecOCD claims, stale claims and flagged conflicts",
        `Run \`specocd status $ARGUMENTS\` and summarize: which tasks are actively claimed
and by whom, which claims have gone stale (owner likely died — safe to take over), and
anything flagged as conflicting.

${WORKFLOW}`,
      ),
      command(
        "verify",
        "Verify a SpecOCD change against its WHEN/THEN acceptance criteria",
        `Verify: $ARGUMENTS

Run \`specocd verify <change>\`, then check each WHEN/THEN requirement against the actual
implementation. Report per-requirement pass/fail with evidence (file:line, test output).

${WORKFLOW}`,
      ),
    ];
  },
};
