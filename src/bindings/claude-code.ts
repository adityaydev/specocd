import { existsSync } from "node:fs";
import path from "node:path";
import type { BindingGenerator, GeneratedFile } from "./types.js";

const WORKFLOW = `## Spec-OCD workflow

Specs live in \`.specdd/\`. Changes are the atomic unit of work; each holds a
proposal, requirement deltas (WHEN/THEN), tasks, a claim registry and an event log.

Before working on a task in a change, ALWAYS:
1. \`specdd status <change>\` — see who holds which task and whether anything is flagged.
2. \`specdd log <change> --task <id> --type status\` output — read prior decisions so you
   do not redo or contradict work another agent/session already did.
3. \`specdd claim <change> <task-id>\` — claim before editing code. If it reports a
   conflict, pick a different task rather than working the claimed one.

While working, record non-obvious decisions:
\`specdd log <change> --task <id> --type decision --message "..."\`

When done: \`specdd release <change> <task-id> --status completed\`.
If you stop early: \`--status abandoned\` (or \`released\` if handing off mid-task).

NEVER write credentials, tokens or PII into events, specs or digests — these are
committed to git history.`;

function command(name: string, description: string, body: string): GeneratedFile {
  return {
    path: path.join(".claude", "commands", `specdd-${name}.md`),
    contents: `---\ndescription: ${description}\n---\n\n${body}\n`,
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
        "Create a new Spec-OCD change (proposal + requirement deltas + tasks)",
        `Create a new change for: $ARGUMENTS

Run \`specdd propose <slug>\` to scaffold the change folder, then fill in:
- \`proposal.md\` — why this change, what is in and out of scope
- \`spec-delta.md\` — acceptance criteria as WHEN/THEN requirements with ids (R1, R2...)
- \`tasks.md\` — implementation tasks with stable ids (T1, T2...)

Keep ceremony proportional to the change: a small fix needs a few lines, not a PRD.

${WORKFLOW}`,
      ),
      command(
        "work",
        "Claim and implement a task from a Spec-OCD change",
        `Work on: $ARGUMENTS

${WORKFLOW}

Implement only what the claimed task covers. If you discover the task needs to
change scope, log it as a decision rather than silently expanding the work.`,
      ),
      command(
        "status",
        "Show Spec-OCD claims, stale claims and flagged conflicts",
        `Run \`specdd status $ARGUMENTS\` and summarize:
- which tasks are actively claimed and by whom
- which claims have gone stale (owner likely died — safe to take over)
- anything flagged as conflicting

${WORKFLOW}`,
      ),
      command(
        "verify",
        "Verify a Spec-OCD change against its WHEN/THEN acceptance criteria",
        `Verify: $ARGUMENTS

Run \`specdd verify <change>\`, then check each WHEN/THEN requirement in
\`spec-delta.md\` against the actual implementation. Report per-requirement
pass/fail with evidence (file:line, test output). Do not mark a requirement
verified on the basis of the spec alone — check the code.

${WORKFLOW}`,
      ),
    ];
  },
};
