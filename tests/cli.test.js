import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, describe } from "node:test";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const roots = [];

function project() {
  const root = mkdtempSync(path.join(tmpdir(), "specdd-cli-"));
  roots.push(root);
  run(root, ["init"]);
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function run(cwd, args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Exit codes are the CI contract, so they are asserted explicitly. */
describe("cli exit codes", () => {
  test("verify exits 1 while blockers stand, in both output modes", () => {
    const root = project();
    run(root, ["propose", "blocked"]);
    assert.equal(run(root, ["verify", "blocked"]).code, 1);
    const json = run(root, ["verify", "blocked", "--json"]);
    assert.equal(json.code, 1);
    assert.ok(JSON.parse(json.stdout).blockers.length > 0);
  });

  test("verify exits 0 once the change is complete", () => {
    const root = project();
    run(root, ["propose", "clean"]);
    const dir = path.join(root, ".specdd", "changes", "clean");
    writeFileSync(
      path.join(dir, "spec-delta.md"),
      "# d\n\n## R1: Works\n\n- **WHEN** invoked\n- **THEN** the system shall respond\n",
      "utf8",
    );
    writeFileSync(path.join(dir, "tasks.md"), "- [x] T1: done\n", "utf8");
    assert.equal(run(root, ["verify", "clean"]).code, 0);
  });

  test("a second session claiming a live task exits 2", () => {
    const root = project();
    run(root, ["propose", "contested"]);
    assert.equal(run(root, ["claim", "contested", "T1"], { SPECDD_SESSION_ID: "a" }).code, 0);
    const conflict = run(root, ["claim", "contested", "T1"], { SPECDD_SESSION_ID: "b" });
    assert.equal(conflict.code, 2);
    assert.match(conflict.stderr, /CONFLICT/);
  });

  test("operating outside an initialized project exits 1 with guidance", () => {
    const bare = mkdtempSync(path.join(tmpdir(), "specdd-bare-"));
    roots.push(bare);
    const result = run(bare, ["status"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /specdd init/);
  });

  test("an unknown change exits 1 rather than throwing", () => {
    const root = project();
    const result = run(root, ["claim", "ghost", "T1"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No such change/);
  });
});

describe("cli output", () => {
  test("status --json is parseable and reflects claims", () => {
    const root = project();
    run(root, ["propose", "jsonic"]);
    run(root, ["claim", "jsonic", "T1"], { SPECDD_AGENT: "cursor", SPECDD_SESSION_ID: "s1" });
    const report = JSON.parse(run(root, ["status", "--json"]).stdout);
    assert.equal(report[0].change, "jsonic");
    assert.equal(report[0].active[0].owner_agent, "cursor");
  });

  test("claiming surfaces prior decisions so context carries across agents", () => {
    const root = project();
    run(root, ["propose", "handoff"]);
    run(root, ["claim", "handoff", "T1"], { SPECDD_AGENT: "claude-code", SPECDD_SESSION_ID: "s1" });
    run(root, ["log", "handoff", "--task", "T1", "--type", "decision", "--message", "picked approach X"],
      { SPECDD_AGENT: "claude-code", SPECDD_SESSION_ID: "s1" });
    run(root, ["release", "handoff", "T1", "--status", "released"], { SPECDD_SESSION_ID: "s1" });

    const pickup = run(root, ["claim", "handoff", "T1"], { SPECDD_AGENT: "cursor", SPECDD_SESSION_ID: "s2" });
    assert.match(pickup.stdout, /Prior decisions/);
    assert.match(pickup.stdout, /picked approach X/);
  });
});
