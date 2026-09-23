import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, describe } from "node:test";

import { claimTask, loadClaims, touchClaim, updateClaims } from "../dist/core/claims.js";
import { LockTimeoutError, withLock } from "../dist/core/lock.js";
import { init } from "../dist/commands/init.js";
import { propose } from "../dist/commands/propose.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const roots = [];

function project() {
  const root = mkdtempSync(path.join(tmpdir(), "specocd-conc-"));
  roots.push(root);
  init(root);
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** Runs N CLI claims genuinely in parallel and reports each exit code. */
function claimInParallel(root, specs) {
  const children = specs.map((spec) =>
    spawnSync(
      process.execPath,
      [
        "-e",
        `const {spawnSync}=require("child_process");
         const r=spawnSync(process.execPath,[${JSON.stringify(CLI)},"claim",${JSON.stringify(spec.change)},${JSON.stringify(spec.task)}],
           {cwd:${JSON.stringify(root)},env:{...process.env,SPECOCD_SESSION_ID:${JSON.stringify(spec.session)},SPECOCD_AGENT:"test"}});
         process.exit(r.status);`,
      ],
      { encoding: "utf8" },
    ),
  );
  return children.map((c) => c.status);
}

describe("withLock", () => {
  test("only one holder at a time, and the lock is released afterwards", () => {
    const root = project();
    const lock = path.join(root, "test.lock");
    let inside = 0;
    withLock(lock, () => {
      inside++;
      assert.ok(existsSync(lock), "lock directory should exist while held");
    });
    assert.equal(inside, 1);
    assert.ok(!existsSync(lock), "lock must be released");
  });

  test("releases the lock even when the body throws", () => {
    const root = project();
    const lock = path.join(root, "boom.lock");
    assert.throws(() => withLock(lock, () => { throw new Error("boom"); }), /boom/);
    assert.ok(!existsSync(lock), "a thrown body must not strand the lock");
  });

  test("times out rather than hanging when the lock is held", () => {
    const root = project();
    const lock = path.join(root, "held.lock");
    mkdirSync(lock);
    assert.throws(() => withLock(lock, () => "never", 120), LockTimeoutError);
    rmSync(lock, { recursive: true, force: true });
  });

  test("breaks a lock abandoned by a crashed process", () => {
    const root = project();
    const lock = path.join(root, "stale.lock");
    mkdirSync(lock);
    // Backdate past the staleness window, as a crashed holder's lock would be.
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    assert.equal(withLock(lock, () => "recovered", 500), "recovered");
  });
});

describe("touchClaim", () => {
  test("refreshes the heartbeat for a task the session owns", () => {
    const data = { schema_version: 1, claims: [] };
    const t0 = new Date("2026-01-01T00:00:00Z");
    claimTask(data, "T1", "claude-code", "S1", 60, t0);
    const later = new Date("2026-01-01T00:40:00Z");
    assert.ok(touchClaim(data, "T1", "S1", later));
    assert.equal(data.claims[0].last_heartbeat, later.toISOString());
  });

  test("refuses to refresh a claim held by another session", () => {
    const data = { schema_version: 1, claims: [] };
    claimTask(data, "T1", "claude-code", "S1", 60);
    assert.equal(touchClaim(data, "T1", "someone-else"), null);
  });

  test("a refreshed claim no longer reads as stale", () => {
    const root = project();
    const { change } = propose(root, "long task");
    const t0 = new Date("2026-01-01T00:00:00Z");
    updateClaims(root, change, (d) => claimTask(d, "T1", "claude-code", "S1", 60, t0));
    // Half an hour of work later, inside the 60 minute window.
    updateClaims(root, change, (d) => touchClaim(d, "T1", "S1", new Date("2026-01-01T00:30:00Z")));
    const claim = loadClaims(root, change).claims[0];
    assert.equal(claim.last_heartbeat, "2026-01-01T00:30:00.000Z");
  });
});

/** The product's core promise, exercised with real concurrent processes. */
describe("concurrent claims", () => {
  test("parallel claims on different tasks are all preserved", () => {
    const root = project();
    const { change } = propose(root, "parallel");
    const specs = [1, 2, 3, 4, 5, 6].map((n) => ({
      change,
      task: `T${n}`,
      session: `S${n}`,
    }));

    const codes = claimInParallel(root, specs);
    assert.deepEqual(codes, specs.map(() => 0), "every claim on a distinct task should succeed");

    const active = loadClaims(root, change).claims.filter((c) => c.status === "active");
    assert.equal(active.length, specs.length, "no claim may be lost to a concurrent write");
    assert.deepEqual(
      active.map((c) => c.task_id).sort(),
      specs.map((s) => s.task).sort(),
    );
  });

  test("parallel claims on one task yield exactly one winner", () => {
    const root = project();
    const { change } = propose(root, "contested");
    const specs = [1, 2, 3, 4, 5, 6].map((n) => ({ change, task: "T1", session: `S${n}` }));

    const codes = claimInParallel(root, specs);
    assert.equal(codes.filter((c) => c === 0).length, 1, "exactly one agent may win");
    assert.equal(codes.filter((c) => c === 2).length, specs.length - 1, "the rest must see a conflict");

    const active = loadClaims(root, change).claims.filter((c) => c.status === "active");
    assert.equal(active.length, 1);
  });
});
