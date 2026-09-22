import type { JiraCredentials } from "../../credentials.js";
import type { JiraAttachment, JiraComment, JiraTicket, JiraTransition } from "./types.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class JiraError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** True when retrying or re-authenticating cannot help. */
    public readonly permanent = false,
  ) {
    super(message);
  }
}

/** Atlassian Document Format wrapper — API v3 rejects plain strings. */
function toAdf(text: string): unknown {
  return {
    type: "doc",
    version: 1,
    content: text.split(/\n{2,}/).map((para) => ({
      type: "paragraph",
      content: [{ type: "text", text: para.replace(/\n/g, " ") }],
    })),
  };
}

/** API v2 renders plain text; v3 needs ADF. Both ship here so Cloud and Server both work. */
function commentBody(text: string, apiVersion: number): Record<string, unknown> {
  return apiVersion >= 3 ? { body: toAdf(text) } : { body: text };
}

/** v3 returns ADF for text fields; flatten it to something an agent can read. */
function flattenAdf(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flattenAdf).join("");

  const obj = node as Record<string, unknown>;
  if (obj.type === "text" && typeof obj.text === "string") return obj.text;
  const inner = flattenAdf(obj.content);
  const block = ["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(String(obj.type));
  return block ? inner + "\n" : inner;
}

function personName(field: unknown): string | null {
  if (!field || typeof field !== "object") return null;
  const person = field as Record<string, unknown>;
  return (person.displayName as string) ?? (person.name as string) ?? (person.emailAddress as string) ?? null;
}

export class JiraClient {
  private readonly auth: string;

  constructor(
    private readonly credentials: JiraCredentials,
    private readonly apiVersion = 2,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {
    this.auth = Buffer.from(`${credentials.email}:${credentials.api_token}`).toString("base64");
  }

  private url(pathname: string): string {
    return `${this.credentials.base_url}/rest/api/${this.apiVersion}${pathname}`;
  }

  private async request(pathname: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(pathname), {
        ...init,
        headers: {
          Authorization: `Basic ${this.auth}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (cause) {
      throw new JiraError(`Could not reach JIRA at ${this.credentials.base_url}: ${(cause as Error).message}`);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 400);
      const permanent = [400, 401, 403, 404].includes(response.status);
      const hint =
        response.status === 401 || response.status === 403
          ? " Check the email and API token in .specocd/credentials.yaml, and that the account can see this project."
          : response.status === 404
            ? " Check the ticket key and base_url."
            : "";
      throw new JiraError(`JIRA responded ${response.status}.${hint}${detail ? `\n${detail}` : ""}`, response.status, permanent);
    }

    if (response.status === 204) return null;
    return response.json().catch(() => null);
  }

  async getTicket(key: string): Promise<JiraTicket> {
    const raw = (await this.request(`/issue/${encodeURIComponent(key)}`)) as Record<string, unknown>;
    const fields = (raw.fields ?? {}) as Record<string, any>;

    const comments: JiraComment[] = (fields.comment?.comments ?? []).map((c: Record<string, any>) => ({
      author: personName(c.author) ?? "unknown",
      created: c.created ?? "",
      body: flattenAdf(c.body).trim(),
    }));

    const attachments: JiraAttachment[] = (fields.attachment ?? []).map((a: Record<string, any>) => ({
      filename: a.filename ?? "unnamed",
      mimeType: a.mimeType ?? "application/octet-stream",
      size: Number(a.size ?? 0),
      created: a.created ?? "",
      content: a.content ?? "",
    }));

    return {
      key: (raw.key as string) ?? key,
      summary: fields.summary ?? "",
      description: flattenAdf(fields.description).trim(),
      status: fields.status?.name ?? "unknown",
      issueType: fields.issuetype?.name ?? "unknown",
      priority: fields.priority?.name ?? null,
      assignee: personName(fields.assignee),
      reporter: personName(fields.reporter),
      dueDate: fields.duedate ?? null,
      labels: fields.labels ?? [],
      created: fields.created ?? "",
      updated: fields.updated ?? "",
      comments,
      attachments,
      url: `${this.credentials.base_url}/browse/${(raw.key as string) ?? key}`,
    };
  }

  async addComment(key: string, text: string): Promise<void> {
    await this.request(`/issue/${encodeURIComponent(key)}/comment`, {
      method: "POST",
      body: JSON.stringify(commentBody(text, this.apiVersion)),
    });
  }

  async getTransitions(key: string): Promise<JiraTransition[]> {
    const raw = (await this.request(`/issue/${encodeURIComponent(key)}/transitions`)) as Record<string, any>;
    return (raw?.transitions ?? []).map((t: Record<string, any>) => ({
      id: String(t.id),
      name: t.name ?? "",
      to: t.to?.name ?? "",
    }));
  }

  async transition(key: string, target: string): Promise<JiraTransition> {
    const available = await this.getTransitions(key);
    const wanted = target.trim().toLowerCase();
    const match =
      available.find((t) => t.name.toLowerCase() === wanted) ??
      available.find((t) => t.to.toLowerCase() === wanted) ??
      available.find((t) => t.id === target);

    if (!match) {
      throw new JiraError(
        `No transition matching "${target}". Available from the current status: ` +
          (available.map((t) => `"${t.name}" → ${t.to}`).join(", ") || "none") +
          ".",
        undefined,
        true,
      );
    }

    await this.request(`/issue/${encodeURIComponent(key)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: match.id } }),
    });
    return match;
  }
}
