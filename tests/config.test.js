import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";

import { loadConfig } from "../dist/config.js";
import {
  InvalidValueError,
  UnknownSettingError,
  getSetting,
  listSettings,
  setSetting,
} from "../dist/commands/config.js";
import { init } from "../dist/commands/init.js";

const roots = [];
function project(opts) {
  const root = mkdtempSync(path.join(tmpdir(), "specocd-cfg-"));
  roots.push(root);
  init(root, opts);
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe("init --mode", () => {
  test("defaults to multi-branch", () => {
    assert.equal(loadConfig(project()).git.mode, "multi");
  });

  test("records single when asked", () => {
    assert.equal(loadConfig(project({ mode: "single" })).git.mode, "single");
  });
});

describe("config get and set", () => {
  test("round-trips a value through the file", () => {
    const root = project();
    setSetting(root, "git.mode", "single");
    assert.equal(getSetting(root, "git.mode"), "single");
    assert.equal(loadConfig(root).git.mode, "single", "must persist, not just return");
  });

  test("writes nested keys without discarding their siblings", () => {
    const root = project();
    setSetting(root, "git.branch_prefix.fix", "bugfix");
    const config = loadConfig(root);
    assert.equal(config.git.branch_prefix.fix, "bugfix");
    assert.equal(config.git.branch_prefix.feature, "feature", "sibling must survive");
  });

  test("coerces booleans and numbers from their string form", () => {
    const root = project();
    assert.equal(setSetting(root, "git.push", "false"), false);
    assert.equal(setSetting(root, "stale_claim_minutes", "15"), 15);
    assert.equal(setSetting(root, "jira.api_version", "3"), 3);
    const config = loadConfig(root);
    assert.equal(config.git.push, false);
    assert.equal(config.stale_claim_minutes, 15);
  });

  /** A silently accepted typo would leave the project on a mode nobody chose. */
  test("rejects a value outside the allowed set and names the options", () => {
    const root = project();
    assert.throws(() => setSetting(root, "git.mode", "mutli"), (error) => {
      assert.ok(error instanceof InvalidValueError);
      assert.match(error.message, /single \| multi/);
      return true;
    });
    assert.equal(loadConfig(root).git.mode, "multi", "the bad value must not be written");
  });

  test("rejects a non-boolean for a boolean setting", () => {
    const root = project();
    assert.throws(() => setSetting(root, "git.push", "sometimes"), InvalidValueError);
  });

  test("an unknown key lists the keys that exist", () => {
    const root = project();
    assert.throws(() => setSetting(root, "git.branchmode", "multi"), (error) => {
      assert.ok(error instanceof UnknownSettingError);
      assert.match(error.message, /git\.mode/);
      return true;
    });
    assert.throws(() => getSetting(root, "nope"), UnknownSettingError);
  });
});

describe("config listing", () => {
  test("shows every documented setting with its value", () => {
    const settings = listSettings(project());
    const byKey = Object.fromEntries(settings.map((s) => [s.key, s]));
    assert.equal(byKey["git.mode"].value, "multi");
    assert.equal(byKey["git.integration"].value, "pull-request");
    assert.ok(settings.every((s) => s.describe.length > 0), "every setting needs a description");
    assert.ok(settings.every((s) => !s.problem), "a fresh project must be valid");
  });

  test("flags a value hand-edited into the file that is not valid", () => {
    const root = project();
    const file = path.join(root, ".specocd", "config.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace("mode: multi", "mode: mutli"), "utf8");

    const bad = listSettings(root).find((s) => s.key === "git.mode");
    assert.equal(bad.value, "mutli");
    assert.match(bad.problem, /single \| multi/);
  });
});

describe("init --integration", () => {
  test("defaults to pull requests, the reversible option", () => {
    assert.equal(loadConfig(project()).git.integration, "pull-request");
  });

  test("records direct merge when chosen", () => {
    assert.equal(loadConfig(project({ integration: "merge" })).git.integration, "merge");
  });

  test("the two modes are mutually exclusive in config", () => {
    const root = project({ integration: "merge" });
    setSetting(root, "git.integration", "pull-request");
    assert.equal(loadConfig(root).git.integration, "pull-request");
    assert.throws(() => setSetting(root, "git.integration", "both"), InvalidValueError);
  });
});
