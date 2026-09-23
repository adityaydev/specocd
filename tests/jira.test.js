import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

import { JiraClient, JiraError } from "../dist/integrations/jira/client.js";
import { UNTRUSTED_NOTICE, renderTicket, ticketSlug } from "../dist/integrations/jira/format.js";
import { ensureGitignored, loadCredentials, requireJiraCredentials } from "../dist/credentials.js";
import { doctor, findChangeForTicket, handoff, linkChange, setup, start } from "../dist/commands/jira.js";
import { init } from "../dist/commands/init.js";
import { propose } from "../dist/commands/propose.js";
import { readFrontMatter } from "../dist/core/markdown.js";
import { readEvents } from "../dist/core/events.js";

const CREDS = { base_url: "https://example.atlassian.net", email: "dev@example.com", api_token: "secret-token" };

const roots = [];
function tempProject() {
  const root = mkdtempSync(path.join(tmpdir(), "specocd-jira-"));
  roots.push(root);
  init(root);
  writeFileSync(
    path.join(root, ".specocd", "credentials.yaml"),
    `jira:\n  base_url: ${CREDS.base_url}\n  email: ${CREDS.email}\n  api_token: ${CREDS.api_token}\n`,
    "utf8",
  );
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

// Env vars would override the credentials file, so keep the test env clean.
const savedEnv = {};
before(() => {
  for (const key of ["SPECOCD_JIRA_BASE_URL", "SPECOCD_JIRA_EMAIL", "SPECOCD_JIRA_TOKEN"]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
after(() => {
  for (const [key, value] of Object.entries(savedEnv)) if (value !== undefined) process.env[key] = value;
});

const RAW_TICKET = {
  key: "PROJ-42",
  fields: {
    summary: "Login times out after 30 seconds",
    description: "Users are logged out mid-session.",
    status: { name: "In Progress" },
    issuetype: { name: "Bug" },
    priority: { name: "High" },
    assignee: { displayName: "Dev One" },
    reporter: { displayName: "QA Two" },
    duedate: "2026-10-01",
    labels: ["auth", "urgent"],
    created: "2026-09-01T10:00:00.000Z",
    updated: "2026-09-20T10:00:00.000Z",
    comment: { comments: [{ author: { displayName: "QA Two" }, created: "2026-09-02T09:00:00.000Z", body: "Repros on staging." }] },
    attachment: [{ filename: "trace.har", mimeType: "application/json", size: 20480, created: "2026-09-02T09:00:00.000Z", content: "https://example.atlassian.net/attachment/1" }],
  },
};

const TRANSITIONS = [
  { id: "31", name: "Ready for QA", to: { name: "QA" } },
  { id: "41", name: "Done", to: { name: "Done" } },
];

/** Minimal fake JIRA. `fail` names the operations that should error. */
function mockJira({ fail = [], transitions = TRANSITIONS, ticket = RAW_TICKET } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });

    if (method === "GET" && /\/issue\/[^/]+$/.test(url)) {
      if (fail.includes("get")) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(ticket), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/comment")) {
      if (fail.includes("comment")) return new Response("no permission", { status: 403 });
      return new Response(JSON.stringify({ id: "1" }), { status: 201 });
    }
    if (method === "GET" && url.endsWith("/transitions")) {
      if (fail.includes("transitions")) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ transitions }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/transitions")) {
      if (fail.includes("transition")) return new Response("workflow error", { status: 400 });
      return new Response(null, { status: 204 });
    }
    return new Response("unexpected", { status: 500 });
  };
  return { fetchImpl, calls };
}

/** A change that passes verification, linked to the ticket. */
function readyChange(root, key = "PROJ-42") {
  const { change, dir } = propose(root, "login timeout");
  writeFileSync(
    path.join(dir, "spec-delta.md"),
    "# d\n\n## R1: Session persists\n\n- **WHEN** a user is idle for 29 minutes\n- **THEN** the system shall keep the session alive\n",
    "utf8",
  );
  writeFileSync(path.join(dir, "tasks.md"), "- [x] T1: extend session TTL\n", "utf8");
  linkChange(root, change, key);
  return change;
}

describe("credentials", () => {
  test("loads from file and normalizes a trailing slash", () => {
    const root = tempProject();
    writeFileSync(
      path.join(root, ".specocd", "credentials.yaml"),
      `jira:\n  base_url: ${CREDS.base_url}/\n  email: ${CREDS.email}\n  api_token: t\n`,
      "utf8",
    );
    assert.equal(requireJiraCredentials(root).base_url, CREDS.base_url);
  });

  test("errors with guidance when the token is blank", () => {
    const root = tempProject();
    writeFileSync(path.join(root, ".specocd", "credentials.yaml"), `jira:\n  base_url: x\n  email: y\n  api_token: ""\n`, "utf8");
    assert.throws(() => requireJiraCredentials(root), /specocd jira setup/);
  });

  test("env vars override the file", () => {
    const root = tempProject();
    process.env.SPECOCD_JIRA_TOKEN = "from-env";
    try {
      assert.equal(loadCredentials(root).jira.api_token, "from-env");
    } finally {
      delete process.env.SPECOCD_JIRA_TOKEN;
    }
  });

  test("setup writes a template and gitignores it", () => {
    const root = mkdtempSync(path.join(tmpdir(), "specocd-setup-"));
    roots.push(root);
    init(root);
    const result = setup(root);
    assert.ok(result.created);
    assert.ok(result.gitignoreUpdated);
    assert.match(readFileSync(path.join(root, ".gitignore"), "utf8"), /\.specocd\/credentials\.yaml/);
    assert.equal(result.configured, false, "template alone must not count as configured");
  });

  test("gitignore entry is not duplicated", () => {
    const root = tempProject();
    ensureGitignored(root);
    assert.equal(ensureGitignored(root), false);
    const ignore = readFileSync(path.join(root, ".gitignore"), "utf8");
    assert.equal(ignore.split("\n").filter((l) => l.trim() === ".specocd/credentials.yaml").length, 1);
  });
});

describe("client", () => {
  test("parses a ticket into the fields an agent needs", async () => {
    const { fetchImpl, calls } = mockJira();
    const ticket = await new JiraClient(CREDS, 2, fetchImpl).getTicket("PROJ-42");
    assert.equal(ticket.summary, "Login times out after 30 seconds");
    assert.equal(ticket.dueDate, "2026-10-01");
    assert.equal(ticket.comments[0].body, "Repros on staging.");
    assert.equal(ticket.attachments[0].filename, "trace.har");
    assert.equal(ticket.url, "https://example.atlassian.net/browse/PROJ-42");
    assert.match(calls[0].url, /\/rest\/api\/2\/issue\/PROJ-42/);
  });

  test("flattens ADF description and comments from API v3", async () => {
    const adfTicket = {
      key: "PROJ-9",
      fields: {
        ...RAW_TICKET.fields,
        description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "ADF body" }] }] },
        comment: { comments: [{ author: { displayName: "A" }, created: "", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ADF comment" }] }] } }] },
      },
    };
    const { fetchImpl } = mockJira({ ticket: adfTicket });
    const ticket = await new JiraClient(CREDS, 3, fetchImpl).getTicket("PROJ-9");
    assert.equal(ticket.description, "ADF body");
    assert.equal(ticket.comments[0].body, "ADF comment");
  });

  test("sends a plain body on v2 and an ADF doc on v3", async () => {
    const v2 = mockJira();
    await new JiraClient(CREDS, 2, v2.fetchImpl).addComment("PROJ-42", "hello");
    assert.equal(v2.calls.at(-1).body.body, "hello");

    const v3 = mockJira();
    await new JiraClient(CREDS, 3, v3.fetchImpl).addComment("PROJ-42", "hello");
    assert.equal(v3.calls.at(-1).body.body.type, "doc");
  });

  test("matches a transition by name, by target status, or by id", async () => {
    for (const target of ["Ready for QA", "QA", "31"]) {
      const { fetchImpl, calls } = mockJira();
      const applied = await new JiraClient(CREDS, 2, fetchImpl).transition("PROJ-42", target);
      assert.equal(applied.id, "31", `failed for ${target}`);
      assert.equal(calls.at(-1).body.transition.id, "31");
    }
  });

  test("lists the available transitions when none match", async () => {
    const { fetchImpl } = mockJira();
    await assert.rejects(
      () => new JiraClient(CREDS, 2, fetchImpl).transition("PROJ-42", "Nonexistent"),
      (error) => error instanceof JiraError && /Ready for QA/.test(error.message),
    );
  });

  test("explains auth failures rather than dumping a raw status", async () => {
    const fetchImpl = async () => new Response("denied", { status: 401 });
    await assert.rejects(
      () => new JiraClient(CREDS, 2, fetchImpl).getTicket("PROJ-42"),
      /credentials\.yaml/,
    );
  });

  test("reports an unreachable host without leaking the token", async () => {
    const fetchImpl = async () => { throw new Error("ENOTFOUND"); };
    await assert.rejects(
      () => new JiraClient(CREDS, 2, fetchImpl).getTicket("PROJ-42"),
      (error) => /Could not reach JIRA/.test(error.message) && !error.message.includes(CREDS.api_token),
    );
  });
});

describe("formatting", () => {
  test("renders the ticket with the untrusted-content fence", async () => {
    const { fetchImpl } = mockJira();
    const ticket = await new JiraClient(CREDS, 2, fetchImpl).getTicket("PROJ-42");
    const rendered = renderTicket(ticket);
    assert.ok(rendered.includes(UNTRUSTED_NOTICE), "ticket text must be fenced as data");
    assert.match(rendered, /due: 2026-10-01/);
    assert.match(rendered, /trace\.har/);
    assert.match(rendered, /Repros on staging/);
  });

  test("builds a readable change slug from key and summary", async () => {
    const { fetchImpl } = mockJira();
    const ticket = await new JiraClient(CREDS, 2, fetchImpl).getTicket("PROJ-42");
    assert.equal(ticketSlug(ticket), "proj-42-login-times-out-after-30-seconds");
  });
});

describe("jira start", () => {
  test("scaffolds a change linked back to the ticket", async () => {
    const root = tempProject();
    const { fetchImpl } = mockJira();
    const result = await start(root, "PROJ-42", fetchImpl);

    assert.equal(result.existed, false);
    const front = readFrontMatter(path.join(result.dir, "proposal.md")).data;
    assert.equal(front.jira, "PROJ-42");
    assert.ok(existsSync(path.join(result.dir, "jira-ticket.md")));
    assert.match(readFileSync(path.join(result.dir, "jira-ticket.md"), "utf8"), /External content/);
    assert.equal(findChangeForTicket(root, "proj-42"), result.change);
    assert.match(readEvents(root, result.change)[0].message, /created from JIRA PROJ-42/);
  });

  test("refreshes the ticket instead of failing when the change exists", async () => {
    const root = tempProject();
    const { fetchImpl } = mockJira();
    await start(root, "PROJ-42", fetchImpl);
    const second = await start(root, "PROJ-42", fetchImpl);
    assert.equal(second.existed, true);
  });
});

describe("jira doctor", () => {
  const failed = (checks) => checks.filter((c) => !c.ok);

  test("passes when credentials, read access and the transition all work", async () => {
    const root = tempProject();
    const { fetchImpl } = mockJira();
    const checks = await doctor(root, "PROJ-42", { qcStage: "Ready for QA", fetchImpl });
    assert.deepEqual(failed(checks), [], JSON.stringify(checks, null, 2));
  });

  test("names the available transitions when the QC stage does not exist", async () => {
    const root = tempProject();
    const { fetchImpl } = mockJira();
    const checks = await doctor(root, "PROJ-42", { qcStage: "Nowhere", fetchImpl });
    const bad = failed(checks);
    assert.equal(bad.length, 1);
    assert.match(bad[0].detail, /Ready for QA/, "must list what is actually available");
  });

  test("stops at the read check when the ticket cannot be fetched", async () => {
    const root = tempProject();
    const { fetchImpl } = mockJira({ fail: ["get"] });
    const checks = await doctor(root, "PROJ-42", { fetchImpl });
    assert.equal(checks.at(-1).ok, false);
    assert.match(checks.at(-1).name, /read PROJ-42/);
  });

  test("reports missing credentials without attempting a request", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "specocd-nocreds-"));
    roots.push(root);
    init(root);
    let called = false;
    const checks = await doctor(root, "PROJ-42", {
      fetchImpl: async () => { called = true; return new Response("{}", { status: 200 }); },
    });
    assert.equal(checks.length, 1);
    assert.equal(checks[0].ok, false);
    assert.equal(called, false, "must not call JIRA without credentials");
  });

  test("never writes to the ticket", async () => {
    const root = tempProject();
    const { fetchImpl, calls } = mockJira();
    await doctor(root, "PROJ-42", { qcStage: "Ready for QA", fetchImpl });
    assert.deepEqual(calls.filter((c) => c.method === "POST"), [], "doctor must be read-only");
  });
});

describe("jira handoff", () => {
  test("comments and transitions on the happy path", async () => {
    const root = tempProject();
    const change = readyChange(root);
    const { fetchImpl, calls } = mockJira();

    const result = await handoff(root, { change, fetchImpl });
    assert.equal(result.commented, true);
    assert.equal(result.transitioned, true);
    assert.equal(result.transitionedTo, "QA");
    assert.deepEqual(result.failures, []);
    assert.equal(result.fallbackPath, undefined);

    const posted = calls.find((c) => c.method === "POST" && c.url.endsWith("/comment")).body.body;
    assert.match(posted, /R1 Session persists/);
    assert.match(posted, /Tasks completed: 1\/1/);
  });

  test("refuses while verification blockers stand", async () => {
    const root = tempProject();
    const { change } = propose(root, "unfinished");
    linkChange(root, change, "PROJ-42");
    const { fetchImpl, calls } = mockJira();

    const result = await handoff(root, { change, fetchImpl });
    assert.ok(result.blockers.length > 0);
    assert.equal(calls.length, 0, "must not touch JIRA while blocked");
  });

  test("writes a paste-ready fallback when commenting is forbidden", async () => {
    const root = tempProject();
    const change = readyChange(root);
    const { fetchImpl } = mockJira({ fail: ["comment"] });

    const result = await handoff(root, { change, fetchImpl });
    assert.equal(result.commented, false);
    assert.equal(result.transitioned, true, "a failed comment must not block the transition");
    assert.equal(result.failures.length, 1);
    assert.ok(existsSync(result.fallbackPath));
    const doc = readFileSync(result.fallbackPath, "utf8");
    assert.match(doc, /manual step needed/);
    assert.match(doc, /R1 Session persists/);
    assert.match(doc, /browse\/PROJ-42/);
  });

  test("a successful move is never reported as still pending", async () => {
    const root = tempProject();
    const change = readyChange(root);
    const { fetchImpl } = mockJira({ fail: ["comment"] });

    const result = await handoff(root, { change, fetchImpl });
    assert.equal(result.transitioned, true);
    assert.ok(!/Please move this ticket/.test(result.comment), "comment must reflect that the move already happened");
    const doc = readFileSync(result.fallbackPath, "utf8");
    assert.match(doc, /Already done, do not repeat/);
    assert.ok(!/Move the ticket to/.test(doc), "must not ask for a move that already succeeded");
  });

  test("asks the developer to move the ticket when the transition fails", async () => {
    const root = tempProject();
    const change = readyChange(root);
    const { fetchImpl } = mockJira({ fail: ["transition"] });

    const result = await handoff(root, { change, fetchImpl });
    assert.equal(result.commented, true);
    assert.equal(result.transitioned, false);
    assert.match(readFileSync(result.fallbackPath, "utf8"), /Move the ticket to \*\*QA\*\*/);
    assert.match(result.comment, /Please move this ticket to QA/);
  });

  test("still produces the fallback when both writes fail", async () => {
    const root = tempProject();
    const change = readyChange(root);
    const { fetchImpl } = mockJira({ fail: ["comment", "transition"] });

    const result = await handoff(root, { change, fetchImpl });
    assert.equal(result.failures.length, 2);
    assert.ok(existsSync(result.fallbackPath));
    assert.match(readEvents(root, change).at(-1).message, /incomplete/);
  });

  test("a previous JIRA failure is not reported to QC as an implementation blocker", async () => {
    const root = tempProject();
    const change = readyChange(root);

    // First attempt fails and records the failure.
    await handoff(root, { change, fetchImpl: mockJira({ fail: ["comment"] }).fetchImpl });
    // Retry succeeds; the earlier tooling failure must not appear in the posted comment.
    const retry = mockJira();
    const result = await handoff(root, { change, fetchImpl: retry.fetchImpl });

    const posted = retry.calls.find((c) => c.method === "POST" && c.url.endsWith("/comment")).body.body;
    assert.ok(!/Blockers raised/.test(posted), "JIRA mechanics must not read as implementation blockers");
    assert.ok(!/403/.test(posted));
    assert.equal(result.commented, true);
  });

  test("a failed read is fatal — there is nothing to hand off", async () => {
    const root = tempProject();
    const change = readyChange(root);
    const { fetchImpl } = mockJira({ fail: ["get"] });
    await assert.rejects(() => handoff(root, { change, fetchImpl }), /JIRA responded 404/);
  });

  test("resolves the change from the ticket key alone", async () => {
    const root = tempProject();
    readyChange(root);
    const { fetchImpl } = mockJira();
    const result = await handoff(root, { key: "PROJ-42", fetchImpl });
    assert.equal(result.commented, true);
  });

  test("explains what to pass when nothing links the ticket", async () => {
    const root = tempProject();
    propose(root, "orphan");
    await assert.rejects(() => handoff(root, { change: "orphan" }), /--key PROJ-123/);
  });

  test("honours an explicit target stage", async () => {
    const root = tempProject();
    const change = readyChange(root);
    const { fetchImpl, calls } = mockJira();
    const result = await handoff(root, { change, qcStage: "Done", fetchImpl });
    assert.equal(result.transitionedTo, "Done");
    const applied = calls.find((c) => c.method === "POST" && c.url.endsWith("/transitions"));
    assert.equal(applied.body.transition.id, "41");
  });
});
