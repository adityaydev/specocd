import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";

import { loadConfig, saveConfig } from "../dist/config.js";
import { currentBranch, isDirty } from "../dist/core/git.js";
import { readFrontMatter } from "../dist/core/markdown.js";
import { NotVerifiedError, approve, commitMessage } from "../dist/commands/approve.js";
import { changeBranch, useBranch } from "../dist/commands/branch.js";
import { init } from "../dist/commands/init.js";
import { propose } from "../dist/commands/propose.js";
import { NotApprovedError, prBody, ship } from "../dist/commands/ship.js";

const roots = [];
const run = (cwd, args) => execFileSync("git", args, { cwd, stdio: "ignore" });

/** A clone with a real (bare) remote, so push is genuinely exercised. */
function project({ remote = true, config = {} } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "specocd-flow-"));
  roots.push(base);
  const root = path.join(base, "app");

  if (remote) {
    run(base, ["init", "-q", "--bare", path.join(base, "origin.git")]);
    run(base, ["clone", "-q", path.join(base, "origin.git"), root]);
  } else {
    run(base, ["init", "-q", root]);
  }
  run(root, ["config", "user.email", "t@example.com"]);
  run(root, ["config", "user.name", "Test"]);

  init(root);
  saveConfig(root, { ...loadConfig(root), git: { ...loadConfig(root).git, ...config } });
  run(root, ["add", "-A"]);
  run(root, ["commit", "-qm", "initial"]);
  run(root, ["branch", "-M", "main"]);
  if (remote) run(root, ["push", "-q", "-u", "origin", "main"]);
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A change that passes verification, with a code file to commit. */
function ready(root, name = "rate limiting") {
  const { change, dir } = propose(root, name);
  writeFileSync(
    path.join(dir, "spec-delta.md"),
    "# d\n\n## R1: Throttle\n\n- **WHEN** an IP exceeds 100 rps\n- **THEN** the system shall respond 429\n",
    "utf8",
  );
  writeFileSync(path.join(dir, "tasks.md"), "- [x] T1: middleware\n", "utf8");
  writeFileSync(path.join(root, "mw.js"), "middleware\n", "utf8");
  return change;
}

describe("branching", () => {
  test("multi mode puts each change on its own prefixed branch", () => {
    const root = project();
    const change = ready(root);
    const result = useBranch(root, change);
    assert.equal(result.branch, "feature/rate-limiting");
    assert.equal(result.created, true);
    assert.equal(currentBranch(root), "feature/rate-limiting");
  });

  test("single mode stays on the current branch", () => {
    const root = project({ config: { mode: "single" } });
    const change = ready(root);
    const result = useBranch(root, change);
    assert.equal(result.mode, "single");
    assert.equal(result.branch, "main");
    assert.equal(currentBranch(root), "main");
  });

  test("the branch is recorded on the proposal and reused", () => {
    const root = project();
    const change = ready(root);
    useBranch(root, change);
    assert.equal(readFrontMatter(path.join(root, ".specocd", "changes", change, "proposal.md")).data.branch,
      "feature/rate-limiting");
    assert.equal(useBranch(root, change).created, false, "must not recreate an existing branch");
  });

  test("bug fixes take the fix prefix, features take feature", () => {
    const git = loadConfig(project()).git;
    assert.equal(changeBranch({ git }, "rate-limiting", { type: "feature" }), "feature/rate-limiting");
    assert.equal(changeBranch({ git }, "null-crash", { type: "fix" }), "fix/null-crash");
  });

  test("a JIRA key keeps its upper case, so the ticket auto-links", () => {
    const git = loadConfig(project()).git;
    assert.equal(
      changeBranch({ git }, "proj-42-login-timeout", { ticket: "PROJ-42", type: "fix" }),
      "fix/PROJ-42-login-timeout",
    );
    // The key is prepended when the slug does not already carry it.
    assert.equal(
      changeBranch({ git }, "login-timeout", { ticket: "PROJ-42", type: "feature" }),
      "feature/PROJ-42-login-timeout",
    );
  });

  test("long branch names are trimmed on a word boundary", () => {
    const git = loadConfig(project()).git;
    const branch = changeBranch({ git }, "a-really-quite-extraordinarily-long-change-name-that-runs-on", {});
    assert.ok(branch.length <= 48, branch);
    assert.ok(!branch.endsWith("-"), "must not end mid-word");
  });
});

describe("approve", () => {
  test("refuses to approve work that does not verify", () => {
    const root = project();
    const { change } = propose(root, "unfinished");
    assert.throws(() => approve(root, change), NotVerifiedError);
  });

  test("--force approves anyway", () => {
    const root = project();
    const { change } = propose(root, "unfinished");
    assert.equal(approve(root, change, { force: true }).change, change);
  });

  test("commits the work and leaves the tree clean", () => {
    const root = project();
    const change = ready(root);
    useBranch(root, change);

    const result = approve(root, change);
    assert.equal(result.committed, true);
    assert.ok(result.sha);
    assert.equal(isDirty(root), false, "approval must not leave its own metadata uncommitted");
  });

  test("marks the proposal approved", () => {
    const root = project();
    const change = ready(root);
    approve(root, change);
    const front = readFrontMatter(path.join(root, ".specocd", "changes", change, "proposal.md")).data;
    assert.equal(front.approved, true);
    assert.ok(front.approved_at);
  });

  test("the commit message names the requirements and tasks", () => {
    const root = project();
    const change = ready(root);
    const message = commitMessage(root, change);
    assert.match(message, /R1: Throttle/);
    assert.match(message, /T1: middleware/);
  });
});

describe("ship", () => {
  test("refuses to ship anything a human has not approved", async () => {
    const root = project();
    const change = ready(root);
    useBranch(root, change);
    await assert.rejects(() => ship(root, change), NotApprovedError);
  });

  test("a dry run touches nothing", async () => {
    const root = project();
    const change = ready(root);
    useBranch(root, change);
    approve(root, change);

    const before = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
    const result = await ship(root, change, { dryRun: true });
    assert.equal(result.pushed, false);
    assert.match(result.steps[0].detail, /would push/);
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }), before);
  });

  test("pushes the change branch to the remote", async () => {
    const root = project({ config: { integration: "none" } });
    const change = ready(root);
    useBranch(root, change);
    approve(root, change);

    const result = await ship(root, change);
    assert.equal(result.pushed, true);
    assert.ok(result.steps.every((s) => s.ok), JSON.stringify(result.steps));
    // The branch really exists on the remote.
    const remote = execFileSync("git", ["ls-remote", "--heads", "origin", "feature/rate-limiting"], {
      cwd: root, encoding: "utf8",
    });
    assert.match(remote, /feature\/rate-limiting/);
  });

  /**
   * A merge that only lands locally has shipped nothing, and the ticket would still be
   * moved to QA on work no one else can see.
   */
  test("merge mode pushes the base branch, not just the local one", async () => {
    const root = project({ config: { integration: "merge" } });
    const change = ready(root);
    useBranch(root, change);
    approve(root, change);

    const result = await ship(root, change);
    assert.equal(result.merged, true);
    assert.ok(result.steps.every((s) => s.ok), JSON.stringify(result.steps));
    assert.match(
      execFileSync("git", ["show", "origin/main:mw.js"], { cwd: root, encoding: "utf8" }),
      /middleware/,
      "the base branch must reach the remote",
    );
  });

  test("merge mode integrates into the base branch", async () => {
    const root = project({ config: { integration: "merge" } });
    const change = ready(root);
    useBranch(root, change);
    approve(root, change);

    const result = await ship(root, change);
    assert.equal(result.merged, true);
    assert.equal(currentBranch(root), "main");
    assert.match(
      execFileSync("git", ["show", "main:mw.js"], { cwd: root, encoding: "utf8" }),
      /middleware/,
      "the work must be on main after a merge",
    );
  });

  test("writes a manual document when a step cannot complete", async () => {
    // No remote, so the push step has nowhere to go.
    const root = project({ remote: false, config: { integration: "none" } });
    const change = ready(root);
    useBranch(root, change);
    approve(root, change);

    const result = await ship(root, change);
    assert.ok(result.steps.some((s) => !s.ok));
    assert.ok(existsSync(result.manualPath));
    assert.match(readFileSync(result.manualPath, "utf8"), /manual steps needed/);
  });

  test("the pull request body carries the criteria and decisions", () => {
    const root = project();
    const change = ready(root);
    const body = prBody(root, change);
    assert.match(body, /WHEN an IP exceeds 100 rps/);
    assert.match(body, /T1: middleware/);
    assert.match(body, /approved by a developer/);
  });
});
