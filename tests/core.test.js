import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";

import { ClaimConflictError, claimTask, isStale, loadClaims, releaseTask, saveClaims } from "../dist/core/claims.js";
import { appendEvent, readEvents } from "../dist/core/events.js";
import { findOversized } from "../dist/core/digest.js";
import { init } from "../dist/commands/init.js";
import { propose, slugify } from "../dist/commands/propose.js";
import { status } from "../dist/commands/status.js";

const roots = [];
function tempProject() {
  const root = mkdtempSync(path.join(tmpdir(), "specdd-test-"));
  roots.push(root);
  init(root);
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const emptyClaims = () => ({ schema_version: 1, claims: [] });

describe("slugify", () => {
  test("normalizes arbitrary names", () => {
    assert.equal(slugify("Add User Auth"), "add-user-auth");
    assert.equal(slugify("  Fix: the __thing!  "), "fix-the-thing");
  });
});

describe("claims", () => {
  test("claims an unclaimed task", () => {
    const data = emptyClaims();
    const { claim } = claimTask(data, "T1", "claude-code", "sess1", 60);
    assert.equal(claim.status, "active");
    assert.equal(data.claims.length, 1);
  });

  test("rejects a second session claiming a live task", () => {
    const data = emptyClaims();
    claimTask(data, "T1", "claude-code", "sess1", 60);
    assert.throws(() => claimTask(data, "T1", "cursor", "sess2", 60), ClaimConflictError);
  });

  test("same session re-claiming refreshes the heartbeat instead of conflicting", () => {
    const data = emptyClaims();
    const t0 = new Date("2026-01-01T00:00:00Z");
    claimTask(data, "T1", "claude-code", "sess1", 60, t0);
    const t1 = new Date("2026-01-01T00:10:00Z");
    const { claim } = claimTask(data, "T1", "claude-code", "sess1", 60, t1);
    assert.equal(claim.last_heartbeat, t1.toISOString());
    assert.equal(data.claims.length, 1);
  });

  test("takes over a stale claim and marks the old one abandoned", () => {
    const data = emptyClaims();
    const t0 = new Date("2026-01-01T00:00:00Z");
    claimTask(data, "T1", "claude-code", "sess1", 60, t0);
    const later = new Date("2026-01-01T02:00:00Z");
    const { claim, tookOverFrom } = claimTask(data, "T1", "cursor", "sess2", 60, later);
    assert.equal(tookOverFrom.status, "abandoned");
    assert.equal(claim.session_id, "sess2");
    assert.equal(data.claims.filter((c) => c.status === "active").length, 1);
  });

  test("isStale only applies to active claims", () => {
    const old = { status: "completed", last_heartbeat: "2020-01-01T00:00:00Z" };
    assert.equal(isStale(old, 1), false);
  });

  test("release ends the active claim", () => {
    const data = emptyClaims();
    claimTask(data, "T1", "claude-code", "sess1", 60);
    const released = releaseTask(data, "T1", "completed");
    assert.equal(released.status, "completed");
    assert.throws(() => releaseTask(data, "T1", "completed"), /No active claim/);
  });

  test("claims round-trip through disk", () => {
    const root = tempProject();
    propose(root, "round trip");
    const data = loadClaims(root, "round-trip");
    claimTask(data, "T1", "claude-code", "sess1", 60);
    saveClaims(root, "round-trip", data);
    assert.equal(loadClaims(root, "round-trip").claims[0].task_id, "T1");
  });
});

describe("events", () => {
  test("appends and filters by task", () => {
    const root = tempProject();
    propose(root, "events demo");
    appendEvent(root, "events-demo", {
      task_id: "T1", agent: "claude-code", session_id: "s1", type: "decision", message: "chose JWT",
    });
    appendEvent(root, "events-demo", {
      task_id: "T2", agent: "cursor", session_id: "s2", type: "blocker", message: "missing config",
    });
    assert.equal(readEvents(root, "events-demo").length, 2);
    assert.equal(readEvents(root, "events-demo", "T1")[0].message, "chose JWT");
  });

  test("log is append-only — a second write preserves the first", () => {
    const root = tempProject();
    propose(root, "append only");
    const base = { agent: "a", session_id: "s", type: "status", task_id: null };
    appendEvent(root, "append-only", { ...base, message: "first" });
    appendEvent(root, "append-only", { ...base, message: "second" });
    const events = readEvents(root, "append-only");
    assert.deepEqual(events.map((e) => e.message), ["first", "second"]);
  });
});

describe("propose + status", () => {
  test("scaffolds all change artifacts", () => {
    const root = tempProject();
    const result = propose(root, "New Feature", { design: true });
    assert.equal(result.change, "new-feature");
    for (const f of ["proposal.md", "spec-delta.md", "tasks.md", "claims.yaml", "events.jsonl", "design.md"]) {
      assert.ok(result.files.includes(f), `${f} missing`);
    }
    assert.match(readFileSync(path.join(result.dir, "proposal.md"), "utf8"), /schema_version: 1/);
  });

  test("refuses a duplicate change", () => {
    const root = tempProject();
    propose(root, "dupe");
    assert.throws(() => propose(root, "dupe"), /already exists/);
  });

  test("status separates active from stale claims", () => {
    const root = tempProject();
    propose(root, "statuscheck");
    const data = loadClaims(root, "statuscheck");
    claimTask(data, "T1", "claude-code", "sess1", 60, new Date("2020-01-01T00:00:00Z"));
    saveClaims(root, "statuscheck", data);
    const [report] = status(root, "statuscheck");
    assert.equal(report.stale.length, 1);
    assert.equal(report.active.length, 0);
  });
});

describe("digest cap", () => {
  test("flags artifacts over the cap and ignores those under it", () => {
    const root = tempProject();
    propose(root, "capcheck");
    assert.deepEqual(findOversized(root, "capcheck", 50), []);
    const flagged = findOversized(root, "capcheck", 0.05).map((a) => a.file);
    assert.ok(flagged.includes("proposal.md"));
  });
});

describe("init", () => {
  test("is idempotent and preserves config", () => {
    const root = tempProject();
    const second = init(root);
    assert.equal(second.alreadyInitialized, true);
    assert.match(readFileSync(path.join(root, ".specdd", "config.yaml"), "utf8"), /schema_version: 1/);
  });
});
