import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { claudeCodeBinding } from "./claude-code.js";
import type { BindingGenerator } from "./types.js";

export type { BindingGenerator, GeneratedFile } from "./types.js";

export const BINDINGS: BindingGenerator[] = [claudeCodeBinding];

export function detectBindings(root: string): string[] {
  return BINDINGS.filter((b) => b.detect(root)).map((b) => b.name);
}

export function writeBindings(root: string, names: string[]): string[] {
  const written: string[] = [];
  for (const name of names) {
    const binding = BINDINGS.find((b) => b.name === name);
    if (!binding) continue;
    for (const file of binding.generate()) {
      const target = path.join(root, file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.contents, "utf8");
      written.push(file.path);
    }
  }
  return written;
}
