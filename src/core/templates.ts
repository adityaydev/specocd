import { SCHEMA_VERSION } from "../config.js";

export function proposalTemplate(change: string, createdAt: string): string {
  return `---
schema_version: ${SCHEMA_VERSION}
change: ${change}
feature: ${change}
status: draft
approved: false
created_at: ${createdAt}
---

<!-- feature: which baseline spec in .specocd/specs/ this folds into on archive. -->
<!-- Point several changes at the same feature to grow one baseline spec. -->

# ${change}

## Why

<!-- What problem does this solve? Why now? -->

## Scope

<!-- What is in scope. Just as importantly: what is explicitly out of scope. -->

## Impact

<!-- Which parts of the codebase this touches. -->
`;
}

export function specDeltaTemplate(change: string): string {
  return `# Requirement deltas: ${change}

<!--
Write acceptance criteria as WHEN/THEN so both humans and agents can verify them.
Each requirement gets a stable id (R1, R2, ...) referenced by tasks.
-->

## R1: <requirement name>

- **WHEN** <condition or trigger>
- **THEN** <the system shall do X>
`;
}

export function tasksTemplate(change: string): string {
  return `# Tasks: ${change}

<!-- Each task needs a stable id (T1, T2, ...). Agents claim tasks by id. -->

- [ ] T1: <first task>
`;
}

export function designTemplate(change: string): string {
  return `# Design: ${change}

<!-- Optional. Only for changes where the approach is not obvious from the requirements. -->

## Approach

## Alternatives considered

## Trade-offs
`;
}

export function digestTemplate(change: string): string {
  return `# Digest: ${change}

<!--
Auto-managed condensed context for agents working under a tight context budget.
Regenerate with \`specocd digest ${change}\` when the CLI reports a size cap breach.
-->

_No digest generated yet._
`;
}
