import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { specddPath } from "./paths.js";

export const CREDENTIALS_FILE = "credentials.yaml";
/** Path as it appears in .gitignore — relative to the repo root. */
export const CREDENTIALS_IGNORE_ENTRY = ".specdd/credentials.yaml";

export interface JiraCredentials {
  base_url: string;
  email: string;
  api_token: string;
}

export interface Credentials {
  jira?: JiraCredentials;
}

export function credentialsPath(root: string): string {
  return path.join(specddPath(root), CREDENTIALS_FILE);
}

export const CREDENTIALS_TEMPLATE = `# Spec-OCD credentials — NEVER commit this file.
# It is added to .gitignore automatically by \`specdd jira setup\`.
#
# Create a JIRA API token at:
#   https://id.atlassian.com/manage-profile/security/api-tokens
#
# Environment variables override these values:
#   SPECDD_JIRA_BASE_URL, SPECDD_JIRA_EMAIL, SPECDD_JIRA_TOKEN

jira:
  base_url: https://your-company.atlassian.net
  email: you@your-company.com
  api_token: ""
`;

export function loadCredentials(root: string): Credentials {
  const file = credentialsPath(root);
  const fromFile: Credentials = existsSync(file) ? ((YAML.parse(readFileSync(file, "utf8")) ?? {}) as Credentials) : {};

  const base_url = process.env.SPECDD_JIRA_BASE_URL ?? fromFile.jira?.base_url;
  const email = process.env.SPECDD_JIRA_EMAIL ?? fromFile.jira?.email;
  const api_token = process.env.SPECDD_JIRA_TOKEN ?? fromFile.jira?.api_token;

  if (!base_url || !email || !api_token) return {};
  return { jira: { base_url: base_url.replace(/\/+$/, ""), email, api_token } };
}

export class MissingCredentialsError extends Error {
  constructor() {
    super(
      "No JIRA credentials found. Run `specdd jira setup`, then fill in " +
        `${CREDENTIALS_IGNORE_ENTRY} (or set SPECDD_JIRA_BASE_URL, SPECDD_JIRA_EMAIL, SPECDD_JIRA_TOKEN).`,
    );
  }
}

export function requireJiraCredentials(root: string): JiraCredentials {
  const creds = loadCredentials(root).jira;
  if (!creds || creds.api_token.trim() === "") throw new MissingCredentialsError();
  return creds;
}

/** Appends the credentials path to .gitignore unless it is already covered. */
export function ensureGitignored(root: string): boolean {
  const file = path.join(root, ".gitignore");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (existing.split("\n").some((line) => line.trim() === CREDENTIALS_IGNORE_ENTRY)) return false;
  const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${existing}${prefix}\n# Spec-OCD credentials — never commit\n${CREDENTIALS_IGNORE_ENTRY}\n`, "utf8");
  return true;
}

/**
 * A tracked credentials file means the token is in git history already — that is an
 * incident, not a warning, so callers stop rather than pushing more commits over it.
 */
export function isTrackedByGit(root: string): boolean {
  try {
    const out = execFileSync("git", ["ls-files", "--error-unmatch", CREDENTIALS_IGNORE_ENTRY], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return out.trim() !== "";
  } catch {
    return false;
  }
}

export function assertCredentialsNotTracked(root: string): void {
  if (isTrackedByGit(root)) {
    throw new Error(
      `${CREDENTIALS_IGNORE_ENTRY} is tracked by git — your API token may already be in history.\n` +
        "Remove it from tracking (`git rm --cached .specdd/credentials.yaml`), revoke that token,\n" +
        "issue a new one, and only then re-run this command.",
    );
  }
}
