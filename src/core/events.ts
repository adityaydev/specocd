import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { SCHEMA_VERSION } from "../config.js";
import { changeFile } from "../paths.js";

/** "handoff" covers integration mechanics (e.g. JIRA), kept distinct from implementation blockers. */
export type EventType = "decision" | "blocker" | "status" | "claim" | "release" | "handoff";

export interface SpecddEvent {
  schema_version: number;
  ts: string;
  task_id: string | null;
  agent: string;
  session_id: string;
  type: EventType;
  message: string;
}

function eventsPath(root: string, change: string): string {
  return changeFile(root, change, "events.jsonl");
}

export function appendEvent(
  root: string,
  change: string,
  event: Omit<SpecddEvent, "schema_version" | "ts"> & { ts?: string },
): SpecddEvent {
  const full: SpecddEvent = {
    schema_version: SCHEMA_VERSION,
    ts: event.ts ?? new Date().toISOString(),
    task_id: event.task_id,
    agent: event.agent,
    session_id: event.session_id,
    type: event.type,
    message: event.message,
  };
  appendFileSync(eventsPath(root, change), JSON.stringify(full) + "\n", "utf8");
  return full;
}

export function readEvents(root: string, change: string, taskId?: string): SpecddEvent[] {
  const file = eventsPath(root, change);
  if (!existsSync(file)) return [];
  const events = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as SpecddEvent);
  return taskId ? events.filter((e) => e.task_id === taskId) : events;
}
