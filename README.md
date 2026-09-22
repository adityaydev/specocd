# Spec-OCD

A lightweight, tool-agnostic spec-driven development framework — with the piece every
other SDD framework leaves out: **coordination between multiple AI agents working the
same change**.

OpenSpec, spec-kit, Kiro and BMAD all treat "shared markdown files in git" as their sync
mechanism. That works for one agent at a time. It breaks the moment two agents (or two
sessions) touch related tasks: no claim, no conflict signal, no shared memory of *why* a
decision was made. Spec-OCD fixes exactly that, and stays out of your way otherwise.

See [REQUIREMENTS.md](REQUIREMENTS.md) for the full analysis and design rationale.

## Install

```bash
npm install -g spec-ocd
```

## Quickstart

```bash
cd your-project            # new or existing, any language
specdd init                # scaffolds .specdd/, detects your agent, writes bindings
specdd propose "add user auth"
```

Fill in the scaffolded `proposal.md`, `spec-delta.md` (WHEN/THEN criteria) and `tasks.md`,
then let agents work:

```bash
specdd status                                  # who holds what, what's stale
specdd claim add-user-auth T1                  # claim before you touch code
specdd log add-user-auth --task T1 --type decision --message "JWT over cookies: stateless"
specdd release add-user-auth T1 --status completed
```

## How multi-agent coordination works

- **Claims** (`claims.yaml`) — an agent claims a task before working it. A second agent
  claiming the same task gets a hard conflict (exit code 2), not a silent overwrite.
- **Stale takeover** — claims carry a heartbeat. If a session dies mid-task, the claim goes
  stale after `stale_claim_minutes` and another agent can take it over cleanly; the old
  claim is marked `abandoned` rather than deleted.
- **Event log** (`events.jsonl`) — append-only decisions, blockers and state changes tagged
  by task. On claim, prior decisions for that task are printed automatically, so the next
  agent picks up *why* things were done, not just what.
- **Resumable from disk alone** — claim + spec + event log + digest is the whole context.
  No dependency on a chat transcript, so any agent or session can pick up cold.

## Context budget

Artifacts have a size cap (default 50 KB). When one is exceeded, the CLI prints an explicit
instruction for the active agent to regenerate `digest.md`. The CLI never calls an LLM
itself — no API keys, no external service.

## Layout

```
.specdd/
  config.yaml                  # caps, staleness window, approval gate, bindings
  specs/<feature>.md           # persistent baseline requirements
  changes/<slug>/
    proposal.md  spec-delta.md  tasks.md  design.md
    claims.yaml  events.jsonl  digest.md
  changes/archive/             # completed changes, frozen
```

## Commands

| Command | Purpose |
|---|---|
| `specdd init` | Scaffold `.specdd/`, detect agent tooling, generate bindings |
| `specdd propose <name> [--design]` | Create a change |
| `specdd claim <change> <task-id>` | Claim a task (conflicts on a live claim) |
| `specdd release <change> <task-id> [--status ...]` | End a claim: completed / released / abandoned |
| `specdd log <change> [--task <id>] --type <t> --message <m>` | Append an event; `--show` reads the log |
| `specdd status [change]` | Active claims, stale claims, cap breaches |

## Status

Phase 1 (core coordination + Claude Code bindings) is implemented and tested.
Phase 2 (`verify`, `archive`, approval gate), Phase 3 (Cursor/Copilot/Codex bindings) and
Phase 4 (polish, npm publish) are planned — see REQUIREMENTS.md §8.4.

## Never put secrets in `.specdd/`

Event logs, claims and specs are committed to git. Credentials in git history are far
harder to purge than a chat transcript.

## License

MIT
