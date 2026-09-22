import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import {
  CREDENTIALS_IGNORE_ENTRY,
  CREDENTIALS_TEMPLATE,
  assertCredentialsNotTracked,
  credentialsPath,
  ensureGitignored,
  loadCredentials,
  requireJiraCredentials,
} from "../credentials.js";
import { appendEvent, readEvents } from "../core/events.js";
import { updateFrontMatter, readFrontMatter } from "../core/markdown.js";
import { resolveIdentity } from "../core/session.js";
import { JiraClient, type FetchLike } from "../integrations/jira/client.js";
import {
  fallbackDocument,
  handoffComment,
  proposalFromTicket,
  renderTicket,
  ticketSlug,
} from "../integrations/jira/format.js";
import type { JiraTicket } from "../integrations/jira/types.js";
import { changeDir, changeFile, changesDir } from "../paths.js";
import { digestTemplate, specDeltaTemplate, tasksTemplate } from "../core/templates.js";
import { SCHEMA_VERSION } from "../config.js";
import { verify } from "./verify.js";
import { listChanges } from "./status.js";

export function makeClient(root: string, fetchImpl?: FetchLike): JiraClient {
  assertCredentialsNotTracked(root);
  const credentials = requireJiraCredentials(root);
  const { jira } = loadConfig(root);
  return new JiraClient(credentials, jira.api_version, fetchImpl);
}

export interface SetupResult {
  path: string;
  created: boolean;
  gitignoreUpdated: boolean;
  configured: boolean;
}

export function setup(root: string): SetupResult {
  const file = credentialsPath(root);
  const created = !existsSync(file);
  if (created) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, CREDENTIALS_TEMPLATE, "utf8");
  }
  const gitignoreUpdated = ensureGitignored(root);
  return { path: file, created, gitignoreUpdated, configured: Boolean(loadCredentials(root).jira) };
}

export async function show(root: string, key: string, fetchImpl?: FetchLike): Promise<JiraTicket> {
  return makeClient(root, fetchImpl).getTicket(key);
}

export interface StartResult {
  ticket: JiraTicket;
  change: string;
  dir: string;
  existed: boolean;
}

/** Fetches a ticket and scaffolds a change from it, linked back by key. */
export async function start(root: string, key: string, fetchImpl?: FetchLike): Promise<StartResult> {
  const ticket = await makeClient(root, fetchImpl).getTicket(key);
  const change = ticketSlug(ticket);
  const dir = changeDir(root, change);

  if (existsSync(dir)) {
    writeFileSync(changeFile(root, change, "jira-ticket.md"), renderTicket(ticket), "utf8");
    return { ticket, change, dir, existed: true };
  }

  mkdirSync(dir, { recursive: true });
  const createdAt = new Date().toISOString();
  const files: Array<[string, string]> = [
    ["proposal.md", proposalFromTicket(ticket, change, createdAt)],
    ["jira-ticket.md", renderTicket(ticket)],
    ["spec-delta.md", specDeltaTemplate(change)],
    ["tasks.md", tasksTemplate(change)],
    ["digest.md", digestTemplate(change)],
    ["claims.yaml", `schema_version: ${SCHEMA_VERSION}\nclaims: []\n`],
    ["events.jsonl", ""],
  ];
  for (const [file, contents] of files) writeFileSync(changeFile(root, change, file), contents, "utf8");

  const identity = resolveIdentity();
  appendEvent(root, change, {
    task_id: null,
    agent: identity.agent,
    session_id: identity.session_id,
    type: "status",
    message: `Change created from JIRA ${ticket.key}: ${ticket.summary}`,
  });

  return { ticket, change, dir, existed: false };
}

/** Finds the change linked to a ticket key via proposal front-matter. */
export function findChangeForTicket(root: string, key: string): string | null {
  const wanted = key.toUpperCase();
  for (const change of listChanges(root)) {
    const proposal = changeFile(root, change, "proposal.md");
    if (!existsSync(proposal)) continue;
    const jira = readFrontMatter(proposal).data.jira;
    if (typeof jira === "string" && jira.toUpperCase() === wanted) return change;
  }
  return null;
}

export function ticketForChange(root: string, change: string): string | null {
  const proposal = changeFile(root, change, "proposal.md");
  if (!existsSync(proposal)) return null;
  const jira = readFrontMatter(proposal).data.jira;
  return typeof jira === "string" && jira.trim() !== "" ? jira : null;
}

export interface HandoffResult {
  ticket: JiraTicket;
  change: string;
  comment: string;
  commented: boolean;
  transitioned: boolean;
  transitionedTo?: string;
  qcStage: string;
  failures: string[];
  fallbackPath?: string;
  blockers: string[];
}

/**
 * Post-verification handoff. Reads are required; writes are best-effort — any write
 * failure produces a local document the developer can paste by hand, so a permissions
 * or workflow problem never strands finished work.
 */
export async function handoff(
  root: string,
  opts: { change?: string; key?: string; qcStage?: string; skipVerify?: boolean; fetchImpl?: FetchLike },
): Promise<HandoffResult> {
  const config = loadConfig(root);
  const qcStage = opts.qcStage ?? config.jira.qc_transition;

  let change = opts.change;
  let key = opts.key;
  if (change && !key) key = ticketForChange(root, change) ?? undefined;
  if (key && !change) change = findChangeForTicket(root, key) ?? undefined;
  if (!key) throw new Error("No JIRA ticket given or linked. Pass --key PROJ-123, or add `jira: PROJ-123` to the change's proposal.md.");
  if (!change) throw new Error(`No change linked to ${key}. Pass --change <slug>, or run \`specdd jira start ${key}\` first.`);
  if (!existsSync(changeDir(root, change))) throw new Error(`No such change: "${change}".`);

  const report = verify(root, change);
  if (report.blockers.length > 0 && !opts.skipVerify) {
    return {
      ticket: { key } as JiraTicket,
      change,
      comment: "",
      commented: false,
      transitioned: false,
      qcStage,
      failures: [],
      blockers: report.blockers,
    };
  }

  // Read first: if this fails there is nothing to hand off, so it is a hard error.
  const client = makeClient(root, opts.fetchImpl);
  const ticket = await client.getTicket(key);

  const events = readEvents(root, change);
  const failures: string[] = [];

  let transitioned = false;
  let transitionedTo: string | undefined;
  let commented = false;

  // Transition first so the comment can state what actually happened — otherwise a
  // successful move still reads "please move this ticket".
  try {
    const applied = await client.transition(ticket.key, qcStage);
    transitioned = true;
    transitionedTo = applied.to || applied.name;
  } catch (error) {
    failures.push(`Could not move the ticket to "${qcStage}": ${(error as Error).message}`);
  }

  const comment = handoffComment(ticket, report, events, { qcStage, transitioned });

  try {
    await client.addComment(ticket.key, comment);
    commented = true;
  } catch (error) {
    failures.push(`Could not add the comment: ${(error as Error).message}`);
  }

  let fallbackPath: string | undefined;
  if (failures.length > 0) {
    fallbackPath = changeFile(root, change, "jira-handoff.md");
    writeFileSync(fallbackPath, fallbackDocument(ticket, comment, qcStage, failures, { commented, transitioned }), "utf8");
  }

  const identity = resolveIdentity();
  appendEvent(root, change, {
    task_id: null,
    agent: identity.agent,
    session_id: identity.session_id,
    type: "handoff",
    message:
      failures.length > 0
        ? `JIRA handoff for ${ticket.key} incomplete: ${failures.join(" | ")}`
        : `JIRA handoff for ${ticket.key} complete: commented and moved to ${transitionedTo ?? qcStage}`,
  });

  return {
    ticket,
    change,
    comment,
    commented,
    transitioned,
    transitionedTo,
    qcStage,
    failures,
    fallbackPath,
    blockers: [],
  };
}

export function linkChange(root: string, change: string, key: string): void {
  if (!existsSync(changeDir(root, change))) throw new Error(`No such change: "${change}".`);
  updateFrontMatter(changeFile(root, change, "proposal.md"), { jira: key.toUpperCase() });
}

export { CREDENTIALS_IGNORE_ENTRY, changesDir };
