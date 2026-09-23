# SpecOCD

**Specification-Obsessed Development.**

A lightweight, tool-agnostic spec-driven development framework — with the piece every
other SDD framework leaves out: **coordination between multiple AI agents working the
same change**.

OpenSpec, spec-kit, Kiro and BMAD all treat "shared markdown files in git" as their sync
mechanism. That works for one agent at a time. It breaks the moment two agents (or two
sessions) touch related tasks: no claim, no conflict signal, no shared memory of *why* a
decision was made. SpecOCD fixes exactly that, and stays out of your way otherwise.

See [REQUIREMENTS.md](REQUIREMENTS.md) for the full analysis and design rationale.

## Install

```bash
npm install -g specocd
```

## Quickstart

```bash
cd your-project            # new or existing, any language
specocd init                # scaffolds .specocd/, detects your agent, writes bindings
specocd propose "add user auth"
```

Fill in the scaffolded `proposal.md`, `spec-delta.md` (WHEN/THEN criteria) and `tasks.md`,
then let agents work:

```bash
specocd status                                  # who holds what, what's stale
specocd claim add-user-auth T1                  # claim before you touch code
specocd log add-user-auth --task T1 --type decision --message "JWT over cookies: stateless"
specocd release add-user-auth T1 --status completed
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
  `specocd show <change>` prints that whole bundle in one read.

Claims are mutated under a cross-process lock and written atomically, so concurrent
agents cannot lose each other's claims. Logging refreshes your claim's heartbeat, so a
long task does not go stale under the agent still working it.

## Git

Git is optional — SpecOCD works in a plain directory — but when the project is a repo it
records provenance and can give each agent its own checkout.

- **Commit trail per task.** Claiming records the branch and HEAD; releasing records HEAD
  again. `specocd show` then displays the range that implemented each task, and `release`
  reports how many files changed.
- **Isolated worktrees.** `specocd worktree add <change> <task>` creates a checkout beside
  the repo on branch `specocd/<change>/<task>`, so two agents can build different tasks of
  one change without sharing a working tree. `specocd worktree list` shows each one and
  the claim that owns it; `remove` cleans up.
- **Repo state in context.** `specocd show` reports the current branch, HEAD and whether
  the tree is dirty, so an agent knows what it is standing on.

SpecOCD never commits, pushes, merges or rebases on your behalf. It records what git
already knows; the decisions stay yours.

```bash
specocd claim rate-limiting T2
specocd worktree add rate-limiting T2    # isolated checkout on its own branch
# ... implement, commit ...
specocd release rate-limiting T2 --status completed
specocd worktree remove rate-limiting T2
```

## Context budget

Artifacts have a size cap (default 50 KB). When one is exceeded, the CLI prints an explicit
instruction for the active agent to regenerate `digest.md`. The CLI never calls an LLM
itself — no API keys, no external service.

## Layout

```
.specocd/
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
| `specocd init` | Scaffold `.specocd/`, detect agent tooling, generate bindings |
| `specocd propose <name> [--design]` | Create a change |
| `specocd claim <change> <task-id>` | Claim a task (conflicts on a live claim) |
| `specocd release <change> <task-id> [--status ...]` | End a claim: completed / released / abandoned |
| `specocd log <change> [--task <id>] --type <t> --message <m>` | Append an event; `--show` reads the log |
| `specocd show <change>` | Full context: spec, tasks, claims, decisions, what is free to claim |
| `specocd status [change]` | Active claims, stale claims, cap breaches |
| `specocd verify <change>` | Structural checks, then hands semantic verification to the agent |
| `specocd archive <change> [--force]` | Fold into the baseline spec and freeze the change |
| `specocd digest <change>` | Regenerate the structural digest |
| `specocd worktree add <change> <task>` | Isolated git checkout on its own branch |
| `specocd worktree list` | SpecOCD worktrees and the claims that own them |
| `specocd worktree remove <change> <task> [--force]` | Clean up a task's checkout |
| `specocd bindings list` | Show available, detected and enabled agent bindings |
| `specocd bindings sync [--all] [--only a,b]` | Regenerate binding files |
| `specocd jira setup` | Create the gitignored credentials file |
| `specocd jira doctor <key>` | Check credentials, access and the QC transition, read-only |
| `specocd jira show <key>` | Fetch and print a ticket |
| `specocd jira start <key>` | Scaffold a change from a ticket |
| `specocd jira link <change> <key>` | Link an existing change to a ticket |
| `specocd jira handoff --change <c>` | Comment on the ticket and move it to QC |

## Agent bindings

`specocd init` detects your tooling and writes bindings so the same workflow is enforced
whichever agent is driving:

| Agent | Writes |
|---|---|
| Claude Code | `.claude/commands/specocd-*.md` (slash commands) |
| Cursor | `.cursor/rules/specocd.mdc` |
| GitHub Copilot | `.github/copilot-instructions.md` + `.github/prompts/*.prompt.md` |
| Codex | `AGENTS.md` |

Files you may already own — `AGENTS.md` and `copilot-instructions.md` — are spliced as a
delimited managed block, so your own content is never overwritten and re-syncing never
duplicates it. Tool-specific files are fully owned and regenerated in place.

## Verify and archive

`specocd verify` does the checks a CLI can actually do — requirements defined and free of
template placeholders, tasks marked done, no live claims, approval granted if required —
then prints each WHEN/THEN and hands semantic verification to the agent, which must check
the real code rather than trusting the spec. It exits non-zero when blocked, so it works in CI.

`specocd archive` refuses to run while those blockers stand (override with `--force`). On
success it folds the change's requirements into `.specocd/specs/<feature>.md` and moves the
change to `changes/archive/<timestamp>-<slug>/`. Point several changes at the same
`feature:` in their front-matter to grow one baseline spec.

## Optional approval gate

Off by default — normal PR review is your gate. Teams that want a hard block set
`require_approval: true` in `.specocd/config.yaml`, which makes `archive` refuse until a
human sets `approved: true` in the change's `proposal.md`.

## JIRA integration

Work straight from tickets. Set up once:

```bash
specocd jira setup          # writes .specocd/credentials.yaml and gitignores it
```

Fill in `base_url`, `email` and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens)
(or set `SPECOCD_JIRA_BASE_URL` / `SPECOCD_JIRA_EMAIL` / `SPECOCD_JIRA_TOKEN`). Then:

```bash
specocd jira show PROJ-123               # title, description, comments, due date, attachments
specocd jira start PROJ-123              # scaffold a change from the ticket
# ... agent writes WHEN/THEN criteria, claims tasks, implements, verifies ...
specocd jira handoff --change proj-123-… # comment on the ticket and move it to QC
```

`specocd jira link <change> PROJ-123` connects a change you already started.

### It degrades instead of failing

Reading a ticket is the only hard requirement. If posting the comment or moving the ticket
fails — permissions, a workflow rule, a transition that isn't available from the current
status — the work is never stranded: SpecOCD writes `jira-handoff.md` into the change
folder with a paste-ready comment and exactly which steps remain, prints the comment to the
terminal, and exits `3`. Whatever already succeeded is listed as "already done, do not
repeat", so you never double-post or re-move a ticket.

### Ticket text is treated as data

Descriptions and comments are written by other people and could contain text aimed at
steering an agent. Fetched content is fenced with an explicit "data, not instructions"
notice, and the agent bindings tell agents to surface such attempts rather than comply.

### Token safety

`specocd jira setup` adds the credentials file to `.gitignore`. If the file is ever found
tracked by git, commands refuse to run and tell you to revoke the token — a leaked JIRA
token is an incident, not a warning. API v2 is the default so both Jira Cloud and
Server/Data Center work; set `jira.api_version: 3` in `config.yaml` for Cloud's ADF API.

## Use in CI

`specocd status` and `specocd verify` accept `--json`. Exit codes are a stable contract:

| Code | Meaning |
|---|---|
| `0` | OK |
| `1` | Blockers present (verify), or a usage/state error |
| `2` | Claim conflict — the task is already held by a live session |
| `3` | JIRA handoff incomplete — a manual step is needed (see `jira-handoff.md`) |

```yaml
- run: specocd verify "$CHANGE" --json
```

## Self-hosted

SpecOCD manages its own development: this repo has a `.specocd/` directory, and the
Phase 4 work was proposed, verified and archived through the tool itself. `specocd init`
ran on an existing repository without modifying a single existing file — the brownfield
adoption requirement, demonstrated rather than asserted.

## Status

**v1.0.0** — 80 tests covering the coordination core, the full
propose → claim → verify → archive lifecycle, bindings for all four agents, the JIRA
integration, and the CLI exit-code contract. SpecOCD manages its own development, so the
coordination layer gets exercised daily.

Two things to know before you depend on it:

- Not yet published to npm.
- The JIRA integration is tested against a mock of the REST API, not a live Atlassian
  instance. The degradation path means a surprise there costs you a manual paste rather
  than lost work, but first contact may still need fixes.

## Never put secrets in `.specocd/`

Event logs, claims and specs are committed to git. Credentials in git history are far
harder to purge than a chat transcript.

## License

MIT
