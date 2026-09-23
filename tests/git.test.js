import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";

import { claimTask, loadClaims, releaseTask, updateClaims } from "../dist/core/claims.js";
import {
  changedFiles,
  currentBranch,
  headSha,
  isDirty,
  isRepo,
  repoState,
  shortSha,
} from "../dist/core/git.js";
import { appendEvent, readEvents } from "../dist/core/events.js";
import { findRoot } from "../dist/paths.js";
import { init } from "../dist/commands/init.js";
import { propose } from "../dist/commands/propose.js";
import { show } from "../dist/commands/show.js";
import {
  NotARepoError,
  createWorktree,
  dropWorktree,
  listTaskWorktrees,
  worktreePath,
} from "../dist/commands/worktree.js";

const roots = [];
function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * A real git repo with everything committed, since git behaviour is what is under
 * test. .specocd/ is committed too, so the tree starts genuinely clean.
 */
function repo({ git = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "specocd-git-"));
  roots.push(root);
  init(root);
  if (git) {
    run(root, ["init", "-q"]);
    run(root, ["config", "user.email", "t@example.com"]);
    run(root, ["config", "user.name", "Test"]);
    writeFileSync(path.join(root, "README.md"), "# app\n", "utf8");
    run(root, ["add", "-A"]);
    run(root, ["commit", "-qm", "initial"]);
  }
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function commit(root, file, contents) {
  writeFileSync(path.join(root, file), contents, "utf8");
  run(root, ["add", "-A"]);
  run(root, ["commit", "-qm", `add ${file}`]);
  return headSha(root);
}

describe("git helpers", () => {
  test("detects a repository", () => {
    assert.equal(isRepo(repo()), true);
    assert.equal(isRepo(repo({ git: false })), false);
  });

  test("reports branch, sha and dirtiness", () => {
    const root = repo();
    const state = repoState(root);
    assert.equal(state.isRepo, true);
    assert.ok(state.branch);
    assert.match(state.sha, /^[0-9a-f]{40}$/);
    assert.equal(state.dirty, false);

    writeFileSync(path.join(root, "scratch.txt"), "wip", "utf8");
    assert.equal(isDirty(root), true);
  });

  /** SpecOCD must work in a plain directory, so every helper degrades quietly. */
  test("degrades to nulls outside a repository instead of throwing", () => {
    const root = repo({ git: false });
    assert.deepEqual(repoState(root), { isRepo: false, branch: null, sha: null, dirty: false });
    assert.equal(currentBranch(root), null);
    assert.equal(headSha(root), null);
    assert.equal(isDirty(root), false);
    assert.deepEqual(changedFiles(root, "a", "b"), []);
  });

  test("lists files changed between two commits", () => {
    const root = repo();
    const before = headSha(root);
    const after = commit(root, "mw.js", "middleware");
    assert.deepEqual(changedFiles(root, before, after), ["mw.js"]);
  });

  test("shortSha tolerates a missing sha", () => {
    assert.equal(shortSha(null), null);
    assert.equal(shortSha("0123456789abcdef"), "0123456");
  });
});

describe("claim provenance", () => {
  test("records branch and start sha, then the end sha on release", () => {
    const root = repo();
    const { change } = propose(root, "rate limiting");
    const start = headSha(root);

    updateClaims(root, change, (d) =>
      claimTask(d, "T1", "claude-code", "A", 60, new Date(), {
        branch: currentBranch(root),
        start_sha: start,
      }),
    );
    const end = commit(root, "mw.js", "middleware");
    updateClaims(root, change, (d) => releaseTask(d, "T1", "completed", new Date(), end));

    const claim = loadClaims(root, change).claims[0];
    assert.equal(claim.git.start_sha, start);
    assert.equal(claim.git.end_sha, end);
    assert.ok(claim.git.branch);
    // The spec files land in the same commit, so assert the code file is covered
    // rather than pinning the exact set.
    assert.ok(changedFiles(root, claim.git.start_sha, claim.git.end_sha).includes("mw.js"));
  });

  test("a claim without git context stays valid", () => {
    const root = repo({ git: false });
    const { change } = propose(root, "no git");
    updateClaims(root, change, (d) => claimTask(d, "T1", "claude-code", "A", 60));
    const claim = loadClaims(root, change).claims[0];
    assert.equal(claim.git, undefined);
    assert.equal(show(root, change).repo.isRepo, false);
  });
});

describe("worktrees", () => {
  test("creates an isolated checkout on its own branch", () => {
    const root = repo();
    const { change } = propose(root, "rate limiting");
    updateClaims(root, change, (d) => claimTask(d, "T2", "claude-code", "A", 60));

    const result = createWorktree(root, change, "T2");
    assert.equal(result.existed, false);
    assert.equal(result.branch, "feature/rate-limiting-t2");
    assert.ok(existsSync(result.path));
    assert.equal(
      execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: result.path, encoding: "utf8" }).trim(),
      "feature/rate-limiting-t2",
      "the worktree must be on its own branch, not the main one",
    );
  });

  test("records the worktree on the claim and lists its owner", () => {
    const root = repo();
    const { change } = propose(root, "rate limiting");
    updateClaims(root, change, (d) => claimTask(d, "T2", "cursor", "B", 60));
    createWorktree(root, change, "T2");

    assert.ok(loadClaims(root, change).claims[0].git.worktree);
    const listing = listTaskWorktrees(root, [change]);
    assert.equal(listing.length, 1);
    assert.equal(listing[0].claim.session_id, "B");
    assert.equal(listing[0].change, change);
  });

  test("reuses an existing worktree rather than failing", () => {
    const root = repo();
    const { change } = propose(root, "reuse");
    createWorktree(root, change, "T1");
    assert.equal(createWorktree(root, change, "T1").existed, true);
  });

  test("removing clears the path from the claim", () => {
    const root = repo();
    const { change } = propose(root, "cleanup");
    updateClaims(root, change, (d) => claimTask(d, "T1", "claude-code", "A", 60));
    const { path: dir } = createWorktree(root, change, "T1");
    dropWorktree(root, change, "T1");
    assert.ok(!existsSync(dir));
    assert.equal(loadClaims(root, change).claims[0].git.worktree, null);
  });

  test("refuses outside a git repository", () => {
    const root = repo({ git: false });
    const { change } = propose(root, "no git");
    assert.throws(() => createWorktree(root, change, "T1"), NotARepoError);
    assert.deepEqual(listTaskWorktrees(root, [change]), []);
  });

  /**
   * A worktree checks out its own copy of .specocd/. If commands run from inside it
   * used that copy, every agent would hold a private claim registry and the whole
   * coordination guarantee would silently evaporate.
   */
  test("coordination state resolves to the main checkout, not the worktree's copy", () => {
    const root = repo();
    const { change } = propose(root, "feature x");
    run(root, ["add", "-A"]);
    run(root, ["commit", "-qm", "add change"]);

    updateClaims(root, change, (d) => claimTask(d, "T1", "claude-code", "A", 60));
    const { path: wt } = createWorktree(root, change, "T1");

    assert.ok(existsSync(path.join(wt, ".specocd")), "the worktree does carry its own copy");
    assert.equal(
      realpathSync(findRoot(wt)),
      realpathSync(root),
      "commands run inside the worktree must use the main repo's state",
    );

    // A decision logged from the worktree has to be visible in the main repo.
    appendEvent(findRoot(wt), change, {
      task_id: "T1", agent: "claude-code", session_id: "A",
      type: "decision", message: "from the worktree",
    });
    assert.ok(readEvents(root, change).some((e) => e.message === "from the worktree"));

    // And the claim held from the worktree must still block another agent.
    assert.throws(
      () => updateClaims(root, change, (d) => claimTask(d, "T1", "cursor", "B", 60)),
      /already claimed/,
    );
  });

  test("places worktrees beside the repo, never inside it", () => {
    const root = repo();
    const dir = worktreePath(root, "rate-limiting", "T2");
    assert.ok(!dir.startsWith(root + path.sep), "a nested worktree would pollute the repo's own status");
    assert.match(path.basename(dir), /^rate-limiting-t2$/);
  });
});
