#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { ClaimConflictError, claimTask, loadClaims, releaseTask, saveClaims } from "./core/claims.js";
import { digestInstruction, findOversized } from "./core/digest.js";
import { appendEvent, readEvents, type EventType } from "./core/events.js";
import { resolveIdentity } from "./core/session.js";
import { init } from "./commands/init.js";
import { propose } from "./commands/propose.js";
import { status } from "./commands/status.js";
import { changeDir, requireRoot } from "./paths.js";

const program = new Command();
program.name("specdd").description("Spec-driven development with multi-agent context coordination").version("0.1.0");

function requireChange(root: string, change: string): void {
  if (!existsSync(changeDir(root, change))) {
    throw new Error(`No such change: "${change}". Run \`specdd propose ${change}\` first.`);
  }
}

/** Surface a cap breach as an explicit instruction for the active agent (decision #3). */
function reportOversized(root: string, change: string): void {
  const config = loadConfig(root);
  const oversized = findOversized(root, change, config.size_cap_kb);
  if (oversized.length > 0) console.warn("\n" + digestInstruction(change, oversized));
}

program
  .command("init")
  .description("Scaffold .specdd/ and generate agent bindings")
  .action(() => {
    const root = process.cwd();
    const result = init(root);
    console.log(result.alreadyInitialized ? "Refreshed .specdd/" : `Initialized .specdd/ in ${root}`);
    console.log(
      result.bindings.length > 0
        ? `Bindings: ${result.bindings.join(", ")}\n  ${result.bindingFiles.join("\n  ")}`
        : "No agent tooling detected — bindings skipped (run `specdd bindings sync` later).",
    );
  });

program
  .command("propose")
  .argument("<name>", "change name (slugified)")
  .option("--design", "also scaffold design.md")
  .description("Create a new change")
  .action((name: string, opts: { design?: boolean }) => {
    const root = requireRoot();
    const result = propose(root, name, opts);
    console.log(`Created change "${result.change}" at ${path.relative(root, result.dir)}/`);
    console.log(`  ${result.files.join("\n  ")}`);
  });

program
  .command("claim")
  .argument("<change>")
  .argument("<task-id>")
  .option("--agent <name>", "override detected agent")
  .option("--session <id>", "override session id")
  .description("Claim a task before working on it")
  .action((change: string, taskId: string, opts: { agent?: string; session?: string }) => {
    const root = requireRoot();
    requireChange(root, change);
    const config = loadConfig(root);
    const identity = resolveIdentity({ agent: opts.agent, session_id: opts.session });
    const data = loadClaims(root, change);

    const result = claimTask(data, taskId, identity.agent, identity.session_id, config.stale_claim_minutes);
    saveClaims(root, change, data);

    if (result.tookOverFrom) {
      console.log(
        `Took over stale claim on ${taskId} from ${result.tookOverFrom.owner_agent} ` +
          `(session ${result.tookOverFrom.session_id}, last heartbeat ${result.tookOverFrom.last_heartbeat}).`,
      );
    } else {
      console.log(`Claimed ${taskId} in "${change}" as ${identity.agent} (${identity.session_id}).`);
    }

    appendEvent(root, change, {
      task_id: taskId,
      agent: identity.agent,
      session_id: identity.session_id,
      type: "claim",
      message: result.tookOverFrom
        ? `Took over stale claim from ${result.tookOverFrom.session_id}`
        : "Claimed task",
    });

    const prior = readEvents(root, change, taskId).filter((e) => e.type === "decision");
    if (prior.length > 0) {
      console.log(`\nPrior decisions on ${taskId} (read before you start):`);
      for (const e of prior) console.log(`  [${e.ts}] ${e.agent}: ${e.message}`);
    }
    reportOversized(root, change);
  });

program
  .command("release")
  .argument("<change>")
  .argument("<task-id>")
  .option("--status <status>", "completed | released | abandoned", "completed")
  .description("End a claim")
  .action((change: string, taskId: string, opts: { status: string }) => {
    const root = requireRoot();
    requireChange(root, change);
    const valid = ["completed", "released", "abandoned"] as const;
    if (!valid.includes(opts.status as (typeof valid)[number])) {
      throw new Error(`--status must be one of: ${valid.join(", ")}`);
    }
    const identity = resolveIdentity();
    const data = loadClaims(root, change);
    releaseTask(data, taskId, opts.status as "completed" | "released" | "abandoned");
    saveClaims(root, change, data);
    appendEvent(root, change, {
      task_id: taskId,
      agent: identity.agent,
      session_id: identity.session_id,
      type: "release",
      message: `Claim ended: ${opts.status}`,
    });
    console.log(`Released ${taskId} in "${change}" (${opts.status}).`);
  });

program
  .command("log")
  .argument("<change>")
  .option("--task <id>", "task id this entry belongs to")
  .option("--type <type>", "decision | blocker | status", "decision")
  .option("--message <text>", "what to record")
  .option("--show", "print the log instead of appending")
  .description("Append to or read the change's event log")
  .action((change: string, opts: { task?: string; type: string; message?: string; show?: boolean }) => {
    const root = requireRoot();
    requireChange(root, change);

    if (opts.show) {
      const events = readEvents(root, change, opts.task);
      if (events.length === 0) {
        console.log("No events recorded yet.");
        return;
      }
      for (const e of events) {
        console.log(`[${e.ts}] ${e.type.padEnd(8)} ${e.task_id ?? "-"} ${e.agent}: ${e.message}`);
      }
      return;
    }

    if (!opts.message) throw new Error("--message is required (or pass --show to read the log).");
    const valid = ["decision", "blocker", "status"];
    if (!valid.includes(opts.type)) throw new Error(`--type must be one of: ${valid.join(", ")}`);

    const identity = resolveIdentity();
    appendEvent(root, change, {
      task_id: opts.task ?? null,
      agent: identity.agent,
      session_id: identity.session_id,
      type: opts.type as EventType,
      message: opts.message,
    });
    console.log(`Logged ${opts.type} on ${opts.task ?? "change"} in "${change}".`);
    reportOversized(root, change);
  });

program
  .command("status")
  .argument("[change]")
  .description("Show claims, stale claims and cap breaches")
  .action((change?: string) => {
    const root = requireRoot();
    const report = status(root, change);
    if (report.length === 0) {
      console.log("No changes yet. Create one with `specdd propose <name>`.");
      return;
    }
    for (const s of report) {
      console.log(`\n${s.change}`);
      if (s.active.length === 0 && s.stale.length === 0) console.log("  no active claims");
      for (const c of s.active) console.log(`  ACTIVE   ${c.task_id} — ${c.owner_agent} (${c.session_id})`);
      for (const c of s.stale) {
        console.log(`  STALE    ${c.task_id} — ${c.owner_agent} (${c.session_id}), last heartbeat ${c.last_heartbeat}`);
      }
      for (const c of s.finished) console.log(`  ${c.status.toUpperCase().padEnd(9)}${c.task_id}`);
      if (s.oversized.length > 0) {
        console.log("  " + digestInstruction(s.change, s.oversized).split("\n").join("\n  "));
      }
    }
  });

try {
  program.parse();
} catch (error) {
  if (error instanceof ClaimConflictError) {
    console.error(`CONFLICT: ${error.message}`);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
