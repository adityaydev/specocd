import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appendEvent } from "../core/events.js";
import { withLock } from "../core/lock.js";
import { updateFrontMatter, readFrontMatter } from "../core/markdown.js";
import { resolveIdentity } from "../core/session.js";
import { archiveDir, changeDir, changeFile, specsDir } from "../paths.js";
import { verify } from "./verify.js";

function timestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/** Everything from the first `## R<n>` heading onward — the requirement blocks themselves. */
export function extractRequirementBlocks(specDelta: string): string {
  const index = specDelta.search(/^##\s+R\d+\s*:/m);
  return index === -1 ? "" : specDelta.slice(index).trim();
}

export interface ArchiveResult {
  change: string;
  feature: string;
  specFile: string;
  archivedTo: string;
  foldedRequirements: number;
}

export function archive(root: string, change: string, opts: { force?: boolean } = {}): ArchiveResult {
  const report = verify(root, change);
  if (report.blockers.length > 0 && !opts.force) {
    throw new Error(
      `Cannot archive "${change}":\n` +
        report.blockers.map((b) => `  - ${b}`).join("\n") +
        "\nResolve these, or pass --force to archive anyway.",
    );
  }

  const now = new Date();
  const proposalPath = changeFile(root, change, "proposal.md");
  const front = readFrontMatter(proposalPath).data;
  const feature = typeof front.feature === "string" && front.feature.trim() !== "" ? front.feature : change;

  const identity = resolveIdentity();
  appendEvent(root, change, {
    task_id: null,
    agent: identity.agent,
    session_id: identity.session_id,
    type: "status",
    message: `Archived into baseline spec "${feature}"${opts.force ? " (forced)" : ""}`,
  });
  updateFrontMatter(proposalPath, { status: "archived", archived_at: now.toISOString() });

  const specFile = path.join(specsDir(root), `${feature}.md`);
  const blocks = extractRequirementBlocks(readFileSync(changeFile(root, change, "spec-delta.md"), "utf8"));

  // Several changes can target one baseline spec, so the fold is serialised per
  // feature; the rename joins it so a change cannot be archived twice.
  const archivedTo = withLock(path.join(specsDir(root), `${feature}.lock`), function () {
    if (blocks !== "") {
      if (!existsSync(specFile)) {
        writeFileSync(specFile, `# ${feature}\n\nBaseline requirements. Folded in from changes on archive.\n`, "utf8");
      }
      appendFileSync(specFile, `\n<!-- from change: ${change}, archived ${now.toISOString()} -->\n\n${blocks}\n`, "utf8");
    }

    mkdirSync(archiveDir(root), { recursive: true });
    const target = path.join(archiveDir(root), `${timestamp(now)}-${change}`);
    renameSync(changeDir(root, change), target);
    return target;
  });

  return {
    change,
    feature,
    specFile,
    archivedTo,
    foldedRequirements: report.requirements.length,
  };
}
