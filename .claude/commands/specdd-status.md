---
description: Show Spec-OCD claims, stale claims and flagged conflicts
---

Run `specdd status $ARGUMENTS` and summarize: which tasks are actively claimed
and by whom, which claims have gone stale (owner likely died — safe to take over), and
anything flagged as conflicting.

## Spec-OCD workflow

Specs live in `.specdd/`. A change is the atomic unit of work; each holds a proposal,
requirement deltas (WHEN/THEN), tasks, a claim registry and an append-only event log.

Before working a task in a change, ALWAYS:
1. `specdd status <change>` — see who holds which task and what is stale.
2. `specdd log <change> --task <id> --show` — read prior decisions so you do not redo
   or contradict work another agent or session already did.
3. `specdd claim <change> <task-id>` — claim before editing code. If it reports a
   conflict, work a different task rather than the claimed one.

While working, record non-obvious decisions:
`specdd log <change> --task <id> --type decision --message "..."`
Use `--type blocker` when you are stuck, so the next agent inherits the context.

When done: `specdd release <change> <task-id> --status completed`.
If you stop early: `--status abandoned`, or `released` when handing off mid-task.

Before archiving: `specdd verify <change>`, then check each WHEN/THEN against the ACTUAL
implementation — read the code, run the tests. Never mark a requirement verified from the
spec or task list alone.

Keep ceremony proportional: a small fix needs a few lines, not a PRD.

NEVER write credentials, tokens or PII into events, specs or digests — these are committed
to git history.
