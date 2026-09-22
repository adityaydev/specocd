import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";

import { loadConfig, saveConfig } from "../dist/config.js";
import { claimTask, loadClaims, saveClaims } from "../dist/core/claims.js";
import { appendEvent } from "../dist/core/events.js";
import { generateDigest } from "../dist/core/digest.js";
import {
  parseFrontMatter,
  parseRequirements,
  parseTasks,
  readFrontMatter,
  stringifyFrontMatter,
  updateFrontMatter,
} from "../dist/core/markdown.js";
import { archive, extractRequirementBlocks } from "../dist/commands/archive.js";
import { init } from "../dist/commands/init.js";
import { propose } from "../dist/commands/propose.js";
import { verify } from "../dist/commands/verify.js";

const roots = [];
function tempProject() {
  const root = mkdtempSync(path.join(tmpdir(), "specdd-p2-"));
  roots.push(root);
  init(root);
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const SPEC_DELTA = `# Requirement deltas: demo

## R1: Throttling

- **WHEN** an IP exceeds 100 requests in 60s
- **THEN** the system shall respond 429

## R2: Persistence

- **WHEN** the service restarts
- **THEN** the system shall restore counters
`;

/** A change that passes every structural check. */
function completeChange(root, name = "demo", opts = {}) {
  const { change, dir } = propose(root, name);
  writeFileSync(path.join(dir, "spec-delta.md"), SPEC_DELTA, "utf8");
  writeFileSync(path.join(dir, "tasks.md"), `# Tasks\n\n- [x] T1: build it\n- [x] T2: test it\n`, "utf8");
  if (opts.feature) updateFrontMatter(path.join(dir, "proposal.md"), { feature: opts.feature });
  if (opts.approved) updateFrontMatter(path.join(dir, "proposal.md"), { approved: true });
  return change;
}

describe("markdown parsing", () => {
  test("round-trips front matter and preserves the body", () => {
    const parsed = parseFrontMatter("---\na: 1\nb: two\n---\n\n# Title\n\nbody\n");
    assert.equal(parsed.data.a, 1);
    assert.match(parsed.body, /# Title/);
    assert.match(stringifyFrontMatter(parsed), /^---\na: 1/);
  });

  test("treats a document without front matter as all body", () => {
    const parsed = parseFrontMatter("# Just a title\n");
    assert.deepEqual(parsed.data, {});
    assert.equal(parsed.body, "# Just a title\n");
  });

  test("updateFrontMatter patches keys without losing the body", () => {
    const root = tempProject();
    const { dir } = propose(root, "patch me");
    const file = path.join(dir, "proposal.md");
    updateFrontMatter(file, { status: "in-progress" });
    const after = readFrontMatter(file);
    assert.equal(after.data.status, "in-progress");
    assert.equal(after.data.change, "patch-me");
    assert.match(after.body, /## Why/);
  });

  test("parses requirements and tasks", () => {
    const root = tempProject();
    const { dir } = propose(root, "parse me");
    writeFileSync(path.join(dir, "spec-delta.md"), SPEC_DELTA, "utf8");
    const reqs = parseRequirements(path.join(dir, "spec-delta.md"));
    assert.deepEqual(reqs.map((r) => r.id), ["R1", "R2"]);
    assert.equal(reqs[0].thens[0], "the system shall respond 429");

    writeFileSync(path.join(dir, "tasks.md"), "- [x] T1: done one\n- [ ] T2: not yet\n", "utf8");
    const tasks = parseTasks(path.join(dir, "tasks.md"));
    assert.deepEqual(tasks.map((t) => t.done), [true, false]);
  });
});

describe("verify", () => {
  test("blocks on placeholders, incomplete tasks and live claims", () => {
    const root = tempProject();
    const { change } = propose(root, "fresh");
    const data = loadClaims(root, change);
    claimTask(data, "T1", "claude-code", "sess1", 60);
    saveClaims(root, change, data);

    const report = verify(root, change);
    assert.equal(report.blockers.length, 3);
    assert.ok(report.blockers.some((b) => /placeholders/.test(b)));
    assert.ok(report.blockers.some((b) => /not marked done/.test(b)));
    assert.ok(report.blockers.some((b) => /actively claimed/.test(b)));
  });

  test("passes on a complete change", () => {
    const root = tempProject();
    const change = completeChange(root);
    const report = verify(root, change);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.requirements.length, 2);
  });

  test("blocks when require_approval is set and approval is missing", () => {
    const root = tempProject();
    const change = completeChange(root);
    saveConfig(root, { ...loadConfig(root), require_approval: true });
    assert.ok(verify(root, change).blockers.some((b) => /require_approval/.test(b)));
  });

  test("passes once approval is granted", () => {
    const root = tempProject();
    const change = completeChange(root, "approved demo", { approved: true });
    saveConfig(root, { ...loadConfig(root), require_approval: true });
    const report = verify(root, change);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.approved, true);
  });

  test("a stale claim does not block archiving", () => {
    const root = tempProject();
    const change = completeChange(root);
    const data = loadClaims(root, change);
    claimTask(data, "T9", "cursor", "sess2", 60, new Date("2020-01-01T00:00:00Z"));
    saveClaims(root, change, data);
    const report = verify(root, change);
    assert.equal(report.staleClaims.length, 1);
    assert.deepEqual(report.blockers, []);
  });
});

describe("archive", () => {
  test("folds requirements into the baseline spec and freezes the change", () => {
    const root = tempProject();
    const change = completeChange(root);
    const result = archive(root, change);

    assert.equal(result.foldedRequirements, 2);
    assert.ok(existsSync(result.archivedTo), "archived folder missing");
    assert.ok(!existsSync(path.join(root, ".specdd", "changes", change)), "change folder should be moved");

    const spec = readFileSync(result.specFile, "utf8");
    assert.match(spec, /## R1: Throttling/);
    assert.match(spec, /from change: demo/);
    assert.equal(readFrontMatter(path.join(result.archivedTo, "proposal.md")).data.status, "archived");
  });

  test("refuses to archive a change with blockers, unless forced", () => {
    const root = tempProject();
    const { change } = propose(root, "incomplete");
    assert.throws(() => archive(root, change), /Cannot archive/);
    const result = archive(root, change, { force: true });
    assert.ok(existsSync(result.archivedTo));
  });

  test("several changes fold into one shared feature spec", () => {
    const root = tempProject();
    const first = completeChange(root, "auth login", { feature: "auth" });
    const second = completeChange(root, "auth logout", { feature: "auth" });
    archive(root, first);
    const result = archive(root, second);

    assert.equal(result.feature, "auth");
    const spec = readFileSync(result.specFile, "utf8");
    assert.match(spec, /from change: auth-login/);
    assert.match(spec, /from change: auth-logout/);
  });

  test("extractRequirementBlocks drops the preamble", () => {
    assert.match(extractRequirementBlocks(SPEC_DELTA), /^## R1: Throttling/);
    assert.equal(extractRequirementBlocks("# Title only\n\nno requirements\n"), "");
  });
});

describe("digest", () => {
  test("captures requirements, task state, claims and recent decisions", () => {
    const root = tempProject();
    const change = completeChange(root);
    const data = loadClaims(root, change);
    claimTask(data, "T1", "claude-code", "sess1", 60);
    saveClaims(root, change, data);
    appendEvent(root, change, {
      task_id: "T1", agent: "claude-code", session_id: "sess1",
      type: "decision", message: "sliding window over fixed bucket",
    });

    const digest = generateDigest(root, change);
    assert.match(digest, /requirements: 2/);
    assert.match(digest, /tasks: 2\/2 done/);
    assert.match(digest, /R1\*\* Throttling/);
    assert.match(digest, /sliding window over fixed bucket/);
    assert.match(digest, /T1 — claude-code/);
  });

  test("handles an empty change without throwing", () => {
    const root = tempProject();
    const { change } = propose(root, "empty");
    const digest = generateDigest(root, change);
    assert.match(digest, /## Requirements/);
    assert.match(digest, /_none recorded_/);
  });
});
