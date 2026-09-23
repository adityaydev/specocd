# Changelog

## 1.0.1

- `specocd show` no longer renders `detached at null` in a repository with no
  commits yet. An unborn HEAD has neither a branch nor a sha, which is a plausible
  first run: `git init`, `specocd init`, `propose`, `show`.
- Fixed the test script, which relied on a recursive glob that zsh expands and `sh`
  does not, so every CI job failed before running a test.
- `specocd --version` reads the version from the manifest rather than a hardcoded
  copy, which had already drifted a release behind.
- Source maps are no longer published. They were half the package and are of no
  use to anyone installing the CLI: 46 KB packed, down from 68 KB.

## 1.0.0

First release.

### Coordination

- **Task claims with conflict detection.** An agent claims a task before editing code.
  A second agent claiming a task another live session holds gets exit code 2, not a
  silent overwrite. Claim mutations run under a cross-process lock and are written
  atomically, so concurrent agents cannot lose each other's claims.
- **Heartbeat recovery.** Claims carry a heartbeat that logging refreshes. A session that
  dies goes stale after `stale_claim_minutes` and its task can be reclaimed; the old claim
  is marked `abandoned` rather than deleted.
- **Append-only decision log.** Decisions and blockers are recorded per change, tagged by
  task, and replayed to whichever agent picks the task up next.
- **`specocd show`** prints the whole context for a change in one read: requirements, task
  states, who holds what, prior decisions, open blockers and what is free to claim.

### Specs

- WHEN/THEN acceptance criteria, with `verify` running the structural checks and handing
  semantic verification to the agent, which must check the real code.
- `archive` folds a completed change into a per-feature baseline spec.
- Per-artifact context cap with an agent-regenerated digest. The CLI never calls a model
  itself, so it needs no API key.

### Git

- Single or multi-branch mode, chosen with `specocd init --mode`.
- Branch naming: `feature/{TICKET-ID}-{kebab-desc}` and `fix/{TICKET-ID}-{kebab-desc}`,
  with the prefix taken from the JIRA issue type and ticket keys kept upper case so
  Atlassian and CI can link a branch to its ticket.
- **Approval gate.** Agents implement and verify, then stop. `specocd approve` is a human
  step that re-runs verification and only then commits. `specocd ship` refuses on any
  change that has not been approved.
- `specocd ship` pushes, opens a pull request or merges, and updates the ticket last, so a
  ticket is never told work is ready that never left the machine. Merge mode pushes the
  base branch too. Failures write `ship-manual.md` and exit 4.
- Isolated worktrees per task, sharing one claim registry with the main checkout.
- Commit provenance: each task records the branch and the commit range that implemented it.

### JIRA

- `jira start` scaffolds a change from a ticket's title, description, comments, due date
  and attachments. `jira handoff` posts a verification summary and moves the ticket to QC.
- Any write failure produces a paste-ready `jira-handoff.md` and exits 3, listing what
  already succeeded so nothing is double-posted.
- `jira doctor` checks credentials, access and the configured QC transition, read-only.
- Ticket text reaches agents fenced as data, not instructions.

### Agents

- Generated bindings for Claude Code, Cursor, GitHub Copilot and Codex. Files users may
  already own (`AGENTS.md`, `copilot-instructions.md`) are spliced as a managed block.

### Exit codes

`0` ok · `1` blocked or usage error · `2` claim conflict · `3` JIRA handoff incomplete ·
`4` ship incomplete
