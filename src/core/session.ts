import os from "node:os";

export interface Identity {
  agent: string;
  session_id: string;
}

/** Env markers set by each agent's CLI, checked in order. */
const AGENT_ENV_MARKERS: Array<[string, string]> = [
  ["CLAUDECODE", "claude-code"],
  ["CLAUDE_CODE", "claude-code"],
  ["CURSOR_TRACE_ID", "cursor"],
  ["COPILOT_AGENT", "copilot"],
  ["CODEX_SESSION", "codex"],
];

export function detectAgent(): string {
  if (process.env.SPECOCD_AGENT) return process.env.SPECOCD_AGENT;
  for (const [envVar, agent] of AGENT_ENV_MARKERS) {
    if (process.env[envVar]) return agent;
  }
  return "unknown";
}

/**
 * Session identity defaults to user@host per agent, which stays stable across
 * CLI invocations from the same terminal — enough to tell distinct agents and
 * machines apart without requiring the agent to thread an id through.
 */
export function resolveIdentity(overrides: Partial<Identity> = {}): Identity {
  const agent = overrides.agent ?? detectAgent();
  const session_id =
    overrides.session_id ??
    process.env.SPECOCD_SESSION_ID ??
    `${agent}:${os.userInfo().username}@${os.hostname()}`;
  return { agent, session_id };
}
