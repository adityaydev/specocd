import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";

import { BINDINGS, BINDING_NAMES, detectBindings, writeBindings } from "../dist/bindings/index.js";
import { BLOCK_END, BLOCK_START, applyManagedBlock } from "../dist/bindings/merge.js";
import { listBindings, syncBindings } from "../dist/commands/bindings.js";
import { loadConfig } from "../dist/config.js";
import { init } from "../dist/commands/init.js";

const roots = [];
function tempProject() {
  const root = mkdtempSync(path.join(tmpdir(), "specdd-b-"));
  roots.push(root);
  init(root);
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe("applyManagedBlock", () => {
  test("creates the block when there is no existing file", () => {
    const out = applyManagedBlock(null, "generated");
    assert.ok(out.includes(BLOCK_START) && out.includes(BLOCK_END));
    assert.match(out, /generated/);
  });

  test("appends below hand-written content", () => {
    const out = applyManagedBlock("# Mine\n\nkeep me\n", "generated");
    assert.match(out, /keep me/);
    assert.ok(out.indexOf("keep me") < out.indexOf(BLOCK_START));
  });

  test("replaces only the block on re-run, leaving user text intact", () => {
    const first = applyManagedBlock("# Mine\n\nkeep me\n", "v1 content");
    const second = applyManagedBlock(first, "v2 content");
    assert.match(second, /keep me/);
    assert.match(second, /v2 content/);
    assert.ok(!second.includes("v1 content"));
    assert.equal(second.split(BLOCK_START).length - 1, 1, "block must not duplicate");
  });

  test("preserves user content written after the block", () => {
    const withBlock = applyManagedBlock(null, "generated");
    const out = applyManagedBlock(withBlock + "\n## My section\n\ntrailing\n", "regenerated");
    assert.match(out, /trailing/);
    assert.match(out, /regenerated/);
  });

  test("treats a whitespace-only file as empty", () => {
    assert.equal(applyManagedBlock("   \n", "generated").split(BLOCK_START).length - 1, 1);
  });
});

describe("binding generators", () => {
  test("every binding declares a name, detect and generate", () => {
    assert.deepEqual(BINDING_NAMES, ["claude-code", "cursor", "copilot", "codex"]);
    for (const binding of BINDINGS) {
      assert.equal(typeof binding.detect, "function");
      const files = binding.generate();
      assert.ok(files.length > 0, `${binding.name} generated nothing`);
      for (const file of files) {
        assert.ok(file.path && file.contents, `${binding.name} produced an incomplete file`);
        assert.match(file.contents, /specdd/, `${binding.name} omits workflow instructions`);
      }
    }
  });

  test("files that may pre-exist use managed-block mode", () => {
    const managed = BINDINGS.flatMap((b) => b.generate()).filter((f) => f.mode === "managed-block");
    const paths = managed.map((f) => f.path);
    assert.ok(paths.includes("AGENTS.md"));
    assert.ok(paths.includes(path.join(".github", "copilot-instructions.md")));
  });

  test("detects tooling from project directories", () => {
    const root = tempProject();
    assert.ok(!detectBindings(root).includes("cursor"));
    mkdirSync(path.join(root, ".cursor"), { recursive: true });
    assert.ok(detectBindings(root).includes("cursor"));
  });
});

describe("writeBindings", () => {
  test("writes files and never clobbers hand-written AGENTS.md content", () => {
    const root = tempProject();
    writeFileSync(path.join(root, "AGENTS.md"), "# House rules\n\nno force pushes\n", "utf8");
    writeBindings(root, ["codex"]);
    const agents = readFileSync(path.join(root, "AGENTS.md"), "utf8");
    assert.match(agents, /no force pushes/);
    assert.match(agents, /SpecOCD/);
  });

  test("replace-mode files are fully owned", () => {
    const root = tempProject();
    writeBindings(root, ["cursor"]);
    const rule = path.join(root, ".cursor", "rules", "specdd.mdc");
    writeFileSync(rule, "stale content", "utf8");
    writeBindings(root, ["cursor"]);
    assert.ok(!readFileSync(rule, "utf8").includes("stale content"));
  });

  test("ignores unknown binding names", () => {
    const root = tempProject();
    assert.deepEqual(writeBindings(root, ["not-a-tool"]), []);
  });
});

describe("bindings command", () => {
  test("sync --all writes every binding and persists them to config", () => {
    const root = tempProject();
    const result = syncBindings(root, { all: true });
    assert.deepEqual(result.bindings, BINDING_NAMES);
    assert.deepEqual(loadConfig(root).enabled_bindings, BINDING_NAMES);
    assert.ok(existsSync(path.join(root, ".cursor", "rules", "specdd.mdc")));
    assert.ok(existsSync(path.join(root, ".github", "prompts", "specdd-work.prompt.md")));
  });

  test("sync --only restricts to the named bindings", () => {
    const root = tempProject();
    const result = syncBindings(root, { only: ["cursor"] });
    assert.deepEqual(result.bindings, ["cursor"]);
    assert.ok(!existsSync(path.join(root, "AGENTS.md")));
  });

  test("sync rejects unknown names", () => {
    const root = tempProject();
    assert.throws(() => syncBindings(root, { only: ["nonsense"] }), /Unknown binding/);
  });

  test("default sync picks up newly added tooling", () => {
    const root = tempProject();
    syncBindings(root, { only: ["claude-code"] });
    mkdirSync(path.join(root, ".cursor"), { recursive: true });
    const result = syncBindings(root);
    assert.ok(result.bindings.includes("cursor"));
    assert.ok(result.bindings.includes("claude-code"), "previously enabled bindings must be kept");
  });

  test("list reports available, detected and enabled", () => {
    const root = tempProject();
    syncBindings(root, { only: ["codex"] });
    const listing = listBindings(root);
    assert.deepEqual(listing.available, BINDING_NAMES);
    assert.deepEqual(listing.enabled, ["codex"]);
  });
});
