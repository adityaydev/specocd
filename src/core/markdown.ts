import { existsSync, readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";

export interface FrontMatter {
  data: Record<string, unknown>;
  body: string;
}

const FM_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontMatter(contents: string): FrontMatter {
  const match = contents.match(FM_PATTERN);
  if (!match) return { data: {}, body: contents };
  return {
    data: (YAML.parse(match[1]) ?? {}) as Record<string, unknown>,
    body: contents.slice(match[0].length),
  };
}

export function stringifyFrontMatter({ data, body }: FrontMatter): string {
  return `---\n${YAML.stringify(data).trimEnd()}\n---\n\n${body.replace(/^\n+/, "")}`;
}

export function readFrontMatter(file: string): FrontMatter {
  return parseFrontMatter(readFileSync(file, "utf8"));
}

export function updateFrontMatter(file: string, patch: Record<string, unknown>): void {
  const parsed = readFrontMatter(file);
  parsed.data = { ...parsed.data, ...patch };
  writeFileSync(file, stringifyFrontMatter(parsed), "utf8");
}

export interface Requirement {
  id: string;
  title: string;
  whens: string[];
  thens: string[];
}

/** Parses `## R1: title` blocks with `- **WHEN** ...` / `- **THEN** ...` bullets. */
export function parseRequirements(file: string): Requirement[] {
  if (!existsSync(file)) return [];
  const requirements: Requirement[] = [];
  let current: Requirement | null = null;

  for (const line of readFileSync(file, "utf8").split("\n")) {
    const heading = line.match(/^##\s+(R\d+)\s*:\s*(.*)$/);
    if (heading) {
      current = { id: heading[1], title: heading[2].trim(), whens: [], thens: [] };
      requirements.push(current);
      continue;
    }
    if (!current) continue;
    const when = line.match(/^\s*[-*]\s*\*\*WHEN\*\*\s*(.*)$/i);
    if (when) current.whens.push(when[1].trim());
    const then = line.match(/^\s*[-*]\s*\*\*THEN\*\*\s*(.*)$/i);
    if (then) current.thens.push(then[1].trim());
  }
  return requirements;
}

export interface Task {
  id: string;
  title: string;
  done: boolean;
}

/** Parses `- [ ] T1: title` / `- [x] T1: title` checklist items. */
export function parseTasks(file: string): Task[] {
  if (!existsSync(file)) return [];
  const tasks: Task[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(T\d+)\s*:\s*(.*)$/);
    if (match) {
      tasks.push({ id: match[2], title: match[3].trim(), done: match[1].toLowerCase() === "x" });
    }
  }
  return tasks;
}

/** True when a requirement still has the scaffolded placeholder text. */
export function isPlaceholder(req: Requirement): boolean {
  const all = [req.title, ...req.whens, ...req.thens].join(" ");
  return /<[^>]*>/.test(all) || all.trim() === "";
}
