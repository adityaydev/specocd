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
| `specdd verify <change>` | Structural checks, then hands semantic verification to the agent |
| `specdd archive <change> [--force]` | Fold into the baseline spec and freeze the change |
| `specdd digest <change>` | Regenerate the structural digest |
| `specdd bindings list` | Show available, detected and enabled agent bindings |
| `specdd bindings sync [--all] [--only a,b]` | Regenerate binding files |

## Agent bindings

`specdd init` detects your tooling and writes bindings so the same workflow is enforced
whichever agent is driving:

| Agent | Writes |
|---|---|
| Claude Code | `.claude/commands/specdd-*.md` (slash commands) |
| Cursor | `.cursor/rules/specdd.mdc` |
| GitHub Copilot | `.github/copilot-instructions.md` + `.github/prompts/*.prompt.md` |
| Codex | `AGENTS.md` |

Files you may already own — `AGENTS.md` and `copilot-instructions.md` — are spliced as a
delimited managed block, so your own content is never overwritten and re-syncing never
duplicates it. Tool-specific files are fully owned and regenerated in place.

## Verify and archive

`specdd verify` does the checks a CLI can actually do — requirements defined and free of
template placeholders, tasks marked done, no live claims, approval granted if required —
then prints each WHEN/THEN and hands semantic verification to the agent, which must check
the real code rather than trusting the spec. It exits non-zero when blocked, so it works in CI.

`specdd archive` refuses to run while those blockers stand (override with `--force`). On
success it folds the change's requirements into `.specdd/specs/<feature>.md` and moves the
change to `changes/archive/<timestamp>-<slug>/`. Point several changes at the same
`feature:` in their front-matter to grow one baseline spec.

## Optional approval gate

Off by default — normal PR review is your gate. Teams that want a hard block set
`require_approval: true` in `.specdd/config.yaml`, which makes `archive` refuse until a
human sets `approved: true` in the change's `proposal.md`.

## Use in CI

`specdd status` and `specdd verify` accept `--json`. Exit codes are a stable contract:

| Code | Meaning |
|---|---|
| `0` | OK |
| `1` | Blockers present (verify), or a usage/state error |
| `2` | Claim conflict — the task is already held by a live session |

```yaml
- run: specdd verify "$CHANGE" --json
```

## Self-hosted

Spec-OCD manages its own development: this repo has a `.specdd/` directory, and the
Phase 4 work was proposed, verified and archived through the tool itself. `specdd init`
ran on an existing repository without modifying a single existing file — the brownfield
adoption requirement, demonstrated rather than asserted.

## Status

All four phases are implemented and tested (53 tests, incl. CLI exit-code contract):
core coordination, the full propose → claim → verify → archive lifecycle, bindings for all
four launch agents, and CI/packaging polish. Not yet published to npm.

## Never put secrets in `.specdd/`

Event logs, claims and specs are committed to git. Credentials in git history are far
harder to purge than a chat transcript.

## License

MIT
