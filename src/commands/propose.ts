import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { SCHEMA_VERSION } from "../config.js";
import { changeDir, changeFile } from "../paths.js";
import {
  designTemplate,
  digestTemplate,
  proposalTemplate,
  specDeltaTemplate,
  tasksTemplate,
} from "../core/templates.js";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface ProposeResult {
  change: string;
  dir: string;
  files: string[];
}

export function propose(
  root: string,
  name: string,
  opts: { design?: boolean; type?: "feature" | "fix" } = {},
): ProposeResult {
  const change = slugify(name);
  if (!change) throw new Error(`"${name}" does not produce a usable change slug.`);

  const dir = changeDir(root, change);
  if (existsSync(dir)) throw new Error(`Change "${change}" already exists at ${dir}.`);
  mkdirSync(dir, { recursive: true });

  const createdAt = new Date().toISOString();
  const files: Array<[string, string]> = [
    ["proposal.md", proposalTemplate(change, createdAt, opts.type ?? "feature")],
    ["spec-delta.md", specDeltaTemplate(change)],
    ["tasks.md", tasksTemplate(change)],
    ["digest.md", digestTemplate(change)],
    ["claims.yaml", `schema_version: ${SCHEMA_VERSION}\nclaims: []\n`],
    ["events.jsonl", ""],
  ];
  if (opts.design) files.push(["design.md", designTemplate(change)]);

  for (const [file, contents] of files) {
    writeFileSync(changeFile(root, change, file), contents, "utf8");
  }

  return { change, dir, files: files.map(([f]) => f) };
}
