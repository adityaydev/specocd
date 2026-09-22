# SpecOCD: Application Requirements Plan

Status: v1.0 (finalized for development)
Date: 2026-09-23
Owner: adityay

## 1. Purpose

Design a lightweight, tool-agnostic Spec-Driven Development (SDD) framework that:

- Drops into any project (new or existing, any language/stack) in minutes, not hours.
- Works with any AI coding agent (Claude Code, Cursor, Copilot, Codex, etc.) without hard vendor lock-in.
- Keeps multiple AI agents/sessions working on related tasks in sync — this is the gap every existing framework leaves open.

This document analyzes four existing SDD frameworks, extracts what to keep/avoid, and defines the requirements for the new framework ("SpecOCD").

## 2. Competitive Analysis

### 2.1 OpenSpec (Fission-AI/OpenSpec)

- **Model**: Action-based, not phase-gated. `explore → propose → apply → archive`. Changes are "delta specs" in `openspec/changes/<name>/` merged into a persistent `openspec/specs/` baseline on archive.
- **Integration**: Pure Node CLI (`openspec init`), ~5 min setup, no SaaS keys, auto-generates the right slash-command syntax per agent (20-30+ agents supported).
- **Multi-agent story (best-in-class, still beta)**: (a) "Stores" — a shared `openspec/` repo multiple codebases reference for cross-repo spec consistency; (b) per-change git worktrees + subagents + a `/verify` step before merge; (c) a hard ~50KB context cap per spec to stop concurrent agents blowing their context budget.
- **Strengths**: low ceremony, brownfield-friendly, artifacts editable anytime, fast onboarding.
- **Weaknesses**: needs high-reasoning models and manual context hygiene per its own docs; Stores feature is explicitly beta; smaller ecosystem (~70k stars) than spec-kit.

### 2.2 GitHub spec-kit

- **Model**: Phase-gated. `constitution → specify → plan → tasks → implement → converge`. Explicitly framed by GitHub as an experiment, not a finished product.
- **Integration**: Python/uv CLI, `.specify/` directory, numbered feature folders (`001-feature-name/`), slash commands as "agent skills."
- **Multi-agent story**: none. Docs and third-party comparisons confirm `implement` "does not manage parallelism or agent isolation." Only benefit is that persisted Markdown lets a single agent resume across sessions.
- **Strengths**: strong governance via "constitution," mature extension ecosystem, GitHub-backed credibility, very active.
- **Weaknesses**: heavy ceremony — independently benchmarked at ~9x slower than plain iterative prompting for the same feature; one case produced 2,100 lines of spec for 600 lines of resulting code; public complaints (GitHub Discussion #1784) that it ignores existing project structure, pushes unwanted refactors, and large spec volume can *degrade* output accuracy; poor fit for small/brownfield changes.

### 2.3 Kiro (AWS)

- **Model**: Phase-gated per feature. `.kiro/specs/<feature>/{requirements.md, design.md, tasks.md}`, requirements in EARS format ("WHEN [condition], THE SYSTEM SHALL [behavior]"). Persistent `.kiro/steering/*.md` for project-wide context with Always/Conditional/Manual/Auto inclusion modes. `.kiro/hooks` for event-triggered automation.
- **Integration**: Not a plugin — Kiro *is* the IDE (VS Code fork), plus a CLI and web client, all reading the same `.kiro/` directory.
- **Multi-agent story**: none — single generalist agent per session; "sync" is passive, via the shared git-tracked folder plus hooks reacting to file changes.
- **Strengths**: clear approval gates keep the agent on-rails, EARS format is genuinely testable, steering docs cut repeated context-setting.
- **Weaknesses**: hard vendor lock-in (AWS/Bedrock, proprietary IDE fork — not tool-agnostic), per-seat subscription cost, a 2026 security flaw let a poisoned webpage rewrite Kiro config, reported production incidents.

### 2.4 BMAD-METHOD

- **Model**: Simulated agile team — 19+ persona agents (Analyst, PM, Architect, Scrum Master, Dev, QA, ...) with sequential document handoff: Project Brief → PRD → Architecture → Stories → Dev → QA. Scale-adaptive tracks (Quick Flow / full Method / Enterprise).
- **Integration**: Tech-stack agnostic, installed as a Claude Code/Codex plugin or generic "skills" CLI; works with Copilot/Cursor too. No runtime dependency.
- **Multi-agent story**: sequential relay only. Each persona produces one versioned document consumed by the next; workflows embed handoff prompts. This is **not concurrent multi-agent sync** — it's single-active-agent-at-a-time with files as shared memory, and users report friction switching between a planning web UI and a dev IDE.
- **Strengths**: distinct personas keep each agent's effective context small and focused; scale-adaptive; free/open, very large community (53k+ stars).
- **Weaknesses**: steep learning curve (~2 months cited to master), ~19 roles/YAML configs to learn, prescriptive even for small changes, v6 rewrite drew complaints about regressed architecture-doc quality.

### 2.5 Cross-cutting findings

| Dimension | OpenSpec | spec-kit | Kiro | BMAD |
|---|---|---|---|---|
| Ceremony | Low | High | Medium | High (scale-adaptive) |
| Tech-stack agnostic | Yes | Yes | No (AWS/Bedrock IDE) | Yes |
| Agent-tool agnostic | Yes (20-30+) | Yes (~30+) | No (own IDE) | Yes |
| Brownfield-friendly | Yes | Weak | Medium | Medium |
| Real concurrent multi-agent sync | Partial (beta) | No | No | No (sequential only) |
| Context-size discipline | Explicit (50KB cap) | Not addressed (root cause of bloat complaints) | Steering doc scoping | Persona scoping only |

**The single clearest gap across all four**: none has a production-grade mechanism for multiple agents (or multiple sessions of the same agent) to work on the same or related tasks *concurrently* without stepping on each other or silently diverging. Every framework's "sync" is really just "shared markdown files in git" — which works for sequential/single-agent use but breaks down for concurrency (race conditions on task claims, no conflict signaling, no shared short-term memory of *why* a decision was made).

## 3. Design Principles for SpecOCD

Derived directly from the above:

1. **Action-based, not phase-gated** (like OpenSpec, unlike spec-kit/Kiro). No forced waterfall; specify/plan/implement/verify can be invoked in any order that makes sense for the change size.
2. **Proportional ceremony.** A one-line copy fix should not require a PRD. Ceremony should scale with change size/risk, not be fixed per framework.
3. **Plain files, plain git.** No proprietary IDE, no SaaS backend, no required language runtime beyond what the target project already has. Everything is Markdown/YAML in the repo, human-readable and diffable.
4. **Agent-agnostic core.** The spec format and directory layout are the product; slash-command/agent bindings are a thin adapter layer generated per tool, not the core.
5. **Context budget as a first-class constraint.** Every artifact has a size/summary discipline (cap + auto-digest) so agents don't degrade from spec bloat — directly addressing the spec-kit complaint.
6. **Concurrency-safe by design, not by convention.** This is the differentiator: explicit task claiming, an append-only decision/event log, and conflict surfacing, so 2+ agents (or 2+ sessions) can work on related tasks without silent divergence.
7. **5-minute adoption.** Init on an existing repo without requiring restructuring, a specific language, or a constitution ceremony before the first spec can be written.

## 4. Functional Requirements

### FR1 — Init & Adoption
- FR1.1: A single init command scaffolds a `.specocd/` (or similar) directory into any existing repo without touching existing files.
- FR1.2: Init auto-detects the project's primary AI agent tooling (Claude Code, Cursor, Copilot, etc., via config files present) and generates the matching slash-command/skill bindings.
- FR1.3: No required external service, API key, or paid dependency for core usage.

### FR2 — Spec Artifacts
- FR2.1: A "change" is the atomic unit of work: a folder containing a proposal, requirement deltas, an optional design note, and a task list — Markdown, human- and agent-editable.
- FR2.2: Requirements are written in a testable, structured format (EARS-style WHEN/THEN) so acceptance criteria are unambiguous to both humans and agents.
- FR2.3: Completed changes archive/fold into a persistent baseline spec per feature area, so the repo always has one current source of truth, separate from in-flight proposals.
- FR2.4: Every artifact enforces a soft size cap (e.g. ~50KB) with an auto-generated digest/summary version for agents operating under tight context budgets. Digest content is generated by the agent, not the CLI (no framework-level LLM calls/API keys required); the default digest is deterministic structural truncation/extraction, and the CLI detects cap breaches during any framework command and emits an explicit instruction telling the active agent to regenerate `digest.md` next.

### FR3 — Multi-Agent Context Coordination (core differentiator)
- FR3.1: **Task claiming** — an agent/session must claim a task before starting work (owner id, timestamp, status). Claims live in a sibling registry file, `.specocd/changes/<name>/claims.yaml`, scoped to the change (not global) — keeps coordination metadata out of the task content itself, avoiding merge-conflict noise and letting any agent scan claims without opening every task file.
- FR3.2: **Append-only event/decision log**, one `events.jsonl` per change (not per-task), with every entry tagged by `task_id`. Every agent appends key decisions, blockers, and state transitions instead of overwriting shared context; other agents/sessions read this log (optionally filtered by task) to catch up before acting.
- FR3.3: **Conflict surfacing, not silent overwrite** — if two agents produce divergent edits to the same requirement/task, the framework detects and flags it (git-merge-conflict-style) rather than letting the last write win silently. The claiming agent/session is the default owner of resolution; if that owner is gone (stale claim, per FR3.6), resolution falls to whichever agent/human picks the task up next. The framework's job is limited to detection and flagging — it does not attempt automated resolution.
- FR3.4: **Resumability** — any agent/session can reconstruct full current context for a task from the files on disk alone (claim + spec + event log + digest), with no reliance on a specific chat history.
- FR3.5: Works across both (a) multiple agents in parallel worktrees/branches and (b) multiple sessions of the same agent over time — both are the same underlying mechanism.
- FR3.6: **Claim lifecycle** — a claim has an explicit status beyond just "claimed": `active`, `released` (work handed off cleanly), `completed`, or `abandoned`. Claims carry a `heartbeat`/`last-updated` timestamp; a claim not refreshed within a configurable staleness window (default guidance, exact value TBD in design) is treated as stale and eligible for another agent/session to reclaim. Prevents a crashed or orphaned session from permanently locking a task.
- FR3.7: **Cross-change file overlap is out of scope for v1 automatic detection.** Claims and conflict detection operate within a single change's task set; if two different changes touch the same underlying files, the framework does not detect that overlap automatically — this is a known v1 limitation (see §6 Non-Goals), not a silent gap.

### FR4 — Workflow Actions
- FR4.1: Propose (create/update a change), Plan (optional design note for non-trivial changes), Implement, Verify, Archive — invokable independently, any order, any subset.
- FR4.2: Verify step checks implementation against the WHEN/THEN acceptance criteria before archive.
- FR4.3: Bulk/lightweight mode for trivial changes that skips proposal ceremony entirely (single-command "just fix it" path).

### FR5 — Tooling Integration
- FR5.1: CLI ships as a single dependency-light binary/package (no heavyweight runtime requirement beyond what's common, e.g. Node or a static binary).
- FR5.2: Generates per-agent binding files (slash commands, skills, MCP config) without duplicating the spec content itself.
- FR5.3: Update command refreshes generated bindings when the framework itself updates, without touching user-authored spec content.
- FR5.4: Launch (v1) agent bindings cover Claude Code, Cursor, GitHub Copilot, and Codex/OpenAI CLI. Binding generation is pluggable so additional agents can be added without core changes.

## 5. Non-Functional Requirements

- **NFR1 Lightweight**: init-to-first-spec in under 5 minutes; no mandatory constitution/governance step blocking first use.
- **NFR2 Portable**: 100% plain-text artifacts, fully git-diffable, no lock-in to any AI vendor or IDE.
- **NFR3 Stack-agnostic**: no assumption about target project's language, framework, or build system.
- **NFR4 Low context overhead**: spec-to-code ratio should stay reasonable (avoid the spec-kit bloat failure mode); auto-digests keep agent-facing context small.
- **NFR5 Concurrency-safe**: no data loss or silent overwrite when 2+ agents touch the same change.
- **NFR6 Incremental adoption**: usable on a single feature/module of an existing large codebase without requiring a full-repo buy-in.
- **NFR7 Transparent**: all state (claims, logs, digests) is human-readable and human-editable; the framework is a convention over files, not an opaque service.
- **NFR8 No secrets in persisted artifacts**: event logs, claims, and digests must never be assumed safe for secrets — framework docs/templates explicitly warn agents against logging credentials, tokens, or PII into `events.jsonl` or spec files, since these are committed to git history and are harder to purge than a chat transcript.

## 6. Non-Goals (v1)

- Not a project-management/ticketing replacement (no Jira-style UI).
- Not an IDE — remains an adapter layer over existing agent tools.
- Not attempting real-time (sub-second) multi-agent locking/CRDT sync — git-speed (seconds/minutes) coordination is the target, matching how agents actually operate.
- Not mandating a specific agent persona system (BMAD-style) — persona conventions can be layered on top later, not baked into core.
- Not detecting file-level overlap *between different changes* in v1 (FR3.7) — coordination guarantees apply within a single change's task set only.

## 7. Decisions Log

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Claim/lock file format | Separate `claims.yaml` per change (`.specocd/changes/<name>/claims.yaml`), scoped to the change, not global | Keeps coordination metadata out of task content (avoids diff noise / merge conflicts on files agents read for requirements); fast to scan without opening every task file |
| 2 | Event log granularity | One `events.jsonl` per change, entries tagged by `task_id` | Preserves the full narrative of a change; still filterable per-task; avoids file-per-task sprawl |
| 3 | Digest aggressiveness | Deterministic structural truncation by default; regeneration is agent-driven (not a framework-level LLM call), triggered explicitly by the CLI when it detects a cap breach during any command | No required API key/external service (keeps NFR1/NFR7 intact); framework provides the trigger + slot, the active agent does the summarization with its own model access |
| 4 | Distribution model | npm CLI for v1 | Target users already run Node-based agent tooling; matches the adoption speed that made OpenSpec's ~5-minute setup work. Dependency-free static binary deferred to a possible v2 for CI-only/non-Node environments |
| 5 | Launch agent bindings | Claude Code, Cursor, GitHub Copilot, Codex/OpenAI CLI — all four at v1 | User priority; binding generation is pluggable (FR5.4) so this list can grow without core changes |
| 6 | Human approval/review gate | No gate by default. Optional per-change marker: `archive` checks `approved: true` in `proposal.md` front-matter only when `config.yaml` sets `require_approval: true`; otherwise normal git PR review is the approval mechanism | Matches design principle #2 (proportional ceremony) — most teams already gate via PR review, so the framework shouldn't force a second gate. Teams that want an explicit block get an opt-in switch, not a default |
| 7 | Schema/artifact versioning | Every artifact (`proposal.md` front-matter, `claims.yaml`, each `events.jsonl` line) carries a `schema_version` integer. No migration tooling in v1; `specocd migrate` reserved as a command name for when it's needed | Cheap to add now, expensive to retrofit later; avoids blocking v1 on building migration tooling nothing yet needs |
| 8 | Target audience/scope | Build to OSS quality (portable, documented, no hard-coded assumptions about your setup) but develop incrementally: core + Claude Code binding first (your own daily driver, fastest feedback loop), then Cursor/Copilot/Codex bindings once the core is proven | De-risks the build — validates the concurrency/claim mechanics (the hard, novel part) against real usage before spending effort on binding breadth across 4 tools |

All decisions final for v1.0. New questions surfaced during implementation should be appended as additional rows rather than replacing this table.

## 8. Concrete Artifact & CLI Specification

This section makes §4's FRs literal — this is what gets built.

### 8.1 Directory layout

```
.specocd/
  config.yaml                    # schema_version, require_approval, size_cap_kb, enabled_bindings
  specs/
    <feature-slug>.md            # persistent baseline requirements (source of truth)
  changes/
    <change-slug>/
      proposal.md                # rationale + scope; front-matter: schema_version, status, approved
      spec-delta.md               # WHEN/THEN requirement deltas for this change
      design.md                    # optional, non-trivial changes only
      tasks.md                     # checklist, each task has a stable task_id
      claims.yaml                  # per-task claim registry (FR3.1, FR3.6)
      events.jsonl                  # append-only decision/event log (FR3.2)
      digest.md                     # auto-regenerated condensed context (FR2.4)
    archive/
      <YYYYMMDD-HHMMSS>-<change-slug>/   # frozen copy of the change folder above, post-archive
  bindings/
    claude-code/ | cursor/ | copilot/ | codex/   # generated slash-command/skill files (FR5.2)
```

### 8.2 Artifact schemas

`proposal.md` front-matter:
```yaml
schema_version: 1
change: add-user-auth
status: draft            # draft | in-progress | in-review | archived
approved: false           # only checked if config.yaml: require_approval: true
created_at: 2026-09-23T10:00:00Z
```

`claims.yaml`:
```yaml
schema_version: 1
claims:
  - task_id: T1
    owner_agent: claude-code
    session_id: sess_abc123
    status: active          # active | released | completed | abandoned
    claimed_at: 2026-09-23T10:05:00Z
    last_heartbeat: 2026-09-23T10:20:00Z
```

`events.jsonl` (one JSON object per line, append-only):
```json
{"schema_version":1,"ts":"2026-09-23T10:06:00Z","task_id":"T1","agent":"claude-code","session_id":"sess_abc123","type":"decision","message":"Chose JWT over session cookies: stateless, matches existing gateway"}
```

`tasks.md`:
```markdown
- [ ] T1: Implement JWT signing util
- [ ] T2: Add login endpoint
```

### 8.3 CLI command surface (v1)

| Command | Purpose | Maps to |
|---|---|---|
| `specocd init` | Scaffold `.specocd/`, detect installed agent tooling, generate bindings | FR1 |
| `specocd propose <name>` | Create a new change folder with templates | FR4.1 |
| `specocd claim <change> <task_id>` | Claim a task (writes/updates `claims.yaml`) | FR3.1 |
| `specocd release <change> <task_id> [--status completed\|abandoned]` | End a claim cleanly | FR3.6 |
| `specocd log <change> --task <task_id> --type <decision\|blocker\|status> --message "..."` | Append a structured event | FR3.2 |
| `specocd status [<change>]` | Show claims, staleness, flagged conflicts across the project or one change | FR3.3, FR3.6 |
| `specocd verify <change>` | Check implementation against WHEN/THEN acceptance criteria | FR4.2 |
| `specocd archive <change>` | Fold change into baseline `specs/`, move to `archive/`; enforces `require_approval` if set | FR2.3, decision #6 |
| `specocd digest <change>` | Force-regenerate `digest.md` (also auto-triggered on cap breach) | FR2.4 |
| `specocd bindings sync` | Refresh generated per-agent binding files after a framework update | FR5.3 |

### 8.4 Implementation phasing (per decision #8)

All four phases are implemented as of 2026-09-23 (53 tests passing). The framework is
self-hosted — this repo's own `.specocd/` directory tracks its development.

- **Phase 1 — Core + Claude Code binding**: `init`, `propose`, `claim`/`release`, `log`, `status`, directory/schema scaffolding, Claude Code slash-command bindings. This is where the concurrency-safety mechanics (the novel part) get validated against real use.
- **Phase 2 — Verify/Archive loop**: `verify`, `archive`, digest auto-regeneration, `require_approval` gate.
- **Phase 3 — Binding breadth**: Cursor, Copilot, Codex bindings via the pluggable binding-generator interface (FR5.4).
- **Phase 4 — Polish**: `specocd status` conflict/staleness reporting UX, documentation, packaging for npm publish.

## 9. Sources

- https://github.com/Fission-AI/OpenSpec
- https://github.com/Fission-AI/OpenSpec/blob/main/docs/cli.md
- https://openspec.pro/
- https://ranthebuilder.cloud/blog/i-tested-three-spec-driven-ai-tools-here-s-my-honest-take/
- https://github.com/github/spec-kit
- https://github.com/github/spec-kit/blob/main/spec-driven.md
- https://github.com/github/spec-kit/discussions/1784
- https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html
- https://hiddedesmet.com/speckit-vs-openspec
- https://learn.microsoft.com/en-us/training/modules/spec-driven-development-github-spec-kit-enterprise-developers/
- https://kiro.dev/docs/specs/, https://kiro.dev/docs/steering/, https://kiro.dev/docs/hooks/, https://kiro.dev/faq/
- https://thehackernews.com/2026/07/aws-kiro-flaw-let-poisoned-web-page.html
- https://github.com/bmad-code-org/BMAD-METHOD
- https://docs.bmad-method.org/
- https://github.com/bmad-code-org/BMAD-METHOD/discussions/979
- https://dev.to/bspann/bmad-method-claude-code-how-i-actually-ship-projects-with-spec-driven-ai-development-1eei
