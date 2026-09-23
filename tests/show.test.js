import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";

import { claimTask, updateClaims } from "../dist/core/claims.js";
import { appendEvent } from "../dist/core/events.js";
import { init } from "../dist/commands/init.js";
import { propose } from "../dist/commands/propose.js";
import { linkChange } from "../dist/commands/jira.js";
import { renderContext, show } from "../dist/commands/show.js";

const roots = [];
function project() {
  const root = mkdtempSync(path.join(tmpdir(), "specocd-show-"));
  roots.push(root);
  init(root);
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function populated(root) {
  const { change, dir } = propose(root, "rate limiting");
  writeFileSync(
    path.join(dir, "spec-delta.md"),
    "# d\n\n## R1: Throttling\n\n- **WHEN** an IP exceeds 100 requests\n- **THEN** the system shall respond 429\n",
    "utf8",
  );
  writeFileSync(
    path.join(dir, "tasks.md"),
    "- [x] T1: middleware\n- [ ] T2: response\n- [ ] T3: recovery\n",
    "utf8",
  );
  return change;
}

describe("show", () => {
  test("gathers spec, tasks, claims and decisions in one call", () => {
    const root = project();
    const change = populated(root);
    updateClaims(root, change, (d) => claimTask(d, "T2", "claude-code", "A", 60));
    appendEvent(root, change, {
      task_id: "T2", agent: "claude-code", session_id: "A",
      type: "decision", message: "sliding window",
    });

    const ctx = show(root, change);
    assert.equal(ctx.requirements.length, 1);
    assert.equal(ctx.tasks.length, 3);
    assert.equal(ctx.activeClaims.length, 1);
    assert.equal(ctx.decisions[0].message, "sliding window");
  });

  test("available excludes done and claimed tasks", () => {
    const root = project();
    const change = populated(root);
    updateClaims(root, change, (d) => claimTask(d, "T2", "claude-code", "A", 60));
    assert.deepEqual(show(root, change).available.map((t) => t.id), ["T3"]);
  });

  test("a stale claim leaves its task available to take over", () => {
    const root = project();
    const change = populated(root);
    updateClaims(root, change, (d) =>
      claimTask(d, "T2", "claude-code", "A", 60, new Date("2020-01-01T00:00:00Z")),
    );
    const ctx = show(root, change);
    assert.equal(ctx.staleClaims.length, 1);
    assert.deepEqual(ctx.available.map((t) => t.id), ["T2", "T3"]);
  });

  test("surfaces the linked JIRA ticket", () => {
    const root = project();
    const change = populated(root);
    linkChange(root, change, "PROJ-42");
    assert.equal(show(root, change).jira, "PROJ-42");
  });

  test("rejects an unknown change", () => {
    assert.throws(() => show(project(), "ghost"), /No such change/);
  });

  test("rendered output names the holder and what is free to claim", () => {
    const root = project();
    const change = populated(root);
    updateClaims(root, change, (d) => claimTask(d, "T2", "cursor", "B", 60));
    appendEvent(root, change, {
      task_id: "T3", agent: "cursor", session_id: "B",
      type: "blocker", message: "needs a Redis fixture",
    });

    const text = renderContext(show(root, change));
    assert.match(text, /T2: response — held by cursor \(B\)/);
    assert.match(text, /Claim one of: T3/);
    assert.match(text, /needs a Redis fixture/);
    assert.match(text, /WHEN an IP exceeds 100 requests/);
  });

  test("renders an empty change without throwing", () => {
    const root = project();
    const { change } = propose(root, "bare");
    const text = renderContext(show(root, change));
    assert.match(text, /## Requirements/);
  });
});
