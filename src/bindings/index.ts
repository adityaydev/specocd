import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { claudeCodeBinding } from "./claude-code.js";
import { codexBinding } from "./codex.js";
import { copilotBinding } from "./copilot.js";
import { cursorBinding } from "./cursor.js";
import { applyManagedBlock } from "./merge.js";
import type { BindingGenerator } from "./types.js";

export type { BindingGenerator, GeneratedFile, WriteMode } from "./types.js";

export const BINDINGS: BindingGenerator[] = [
  claudeCodeBinding,
  cursorBinding,
  copilotBinding,
  codexBinding,
];

export const BINDING_NAMES = BINDINGS.map((b) => b.name);

export function detectBindings(root: string): string[] {
  return BINDINGS.filter((b) => b.detect(root)).map((b) => b.name);
}

export function unknownBindings(names: string[]): string[] {
  return names.filter((n) => !BINDING_NAMES.includes(n));
}

export function writeBindings(root: string, names: string[]): string[] {
  const written: string[] = [];
  for (const name of names) {
    const binding = BINDINGS.find((b) => b.name === name);
    if (!binding) continue;

    for (const file of binding.generate()) {
      const target = path.join(root, file.path);
      mkdirSync(path.dirname(target), { recursive: true });

      if (file.mode === "managed-block") {
        const existing = existsSync(target) ? readFileSync(target, "utf8") : null;
        writeFileSync(target, applyManagedBlock(existing, file.contents), "utf8");
      } else {
        writeFileSync(target, file.contents, "utf8");
      }
      written.push(file.path);
    }
  }
  return written;
}
