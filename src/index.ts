#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Version is read at runtime from package.json so there is exactly one place
// to bump on each release. Works both from `dist/` during local dev and from
// `node_modules/@mnemoverse/mcp-memory-server/dist/` after an npm install.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const API_URL =
  process.env.MNEMOVERSE_API_URL || "https://core.mnemoverse.com/api/v1";
const API_KEY = process.env.MNEMOVERSE_API_KEY || "";

// Hard cap on tool result size — required by Claude Connectors Directory
// (https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide).
// Approximate token count = chars / 4. Cap at 24,000 tokens to leave headroom under the 25K limit.
const MAX_RESULT_CHARS = 24_000 * 4;

// The API key is validated lazily — inside apiFetch, on the first tool call —
// rather than at startup. This lets the server START WITHOUT a key so that
// `tools/list` and other introspection work key-free. MCP directories and
// registries (e.g. Glama) boot the server to enumerate and score its tools,
// and clients may browse capabilities before sign-in; a startup exit on a
// missing key blocks all of that. A tool *invocation* without a key returns a
// clear, actionable error instead (see apiFetch).

/**
 * Fetch from the Mnemoverse core API with authentication.
 *
 * Generic so call sites can declare the expected response shape:
 *
 *     const r = await apiFetch<{ stored: boolean; atom_id: string }>("/memory/write", { ... });
 *
 * Handles 204 No Content and empty bodies defensively — FastAPI DELETE
 * handlers may switch to 204 in the future even though today they return
 * a JSON body.
 *
 * @throws Error with message `Mnemoverse API error {status}: {body}` on non-2xx.
 */
async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!API_KEY) {
    throw new Error(
      "MNEMOVERSE_API_KEY is required for this operation. Get a free key at " +
        "https://console.mnemoverse.com and set it in your MCP client config.",
    );
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mnemoverse API error ${res.status}: ${text}`);
  }

  // 204 No Content or empty body — return an empty object cast as T so
  // call sites using optional chaining still work without crashing.
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return {} as T;
  }

  return (await res.json()) as T;
}

/**
 * Truncate a result string to MAX_RESULT_CHARS, appending a notice if truncated.
 * Required by Claude Connectors Directory submission policy.
 *
 * Defensive against splitting UTF-16 surrogate pairs: if the character right
 * before the cut point is a high surrogate (U+D800–U+DBFF), drop it so the
 * result stays well-formed. Otherwise an emoji or non-BMP character at the
 * boundary can produce a lone surrogate and corrupt downstream JSON encoding.
 */
function capResult(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  let truncated = text.slice(0, MAX_RESULT_CHARS - 200);
  const lastCode = truncated.charCodeAt(truncated.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  return (
    truncated +
    `\n\n[…truncated to fit 25K token limit. Use a more specific query or smaller top_k to see all results.]`
  );
}

// --- Server setup ---

const server = new McpServer({
  name: "mnemoverse-memory",
  version: pkg.version,
});

// --- Tool: memory_write ---

server.registerTool(
  "memory_write",
  {
    description:
      "Store a long-term memory that persists across sessions AND across every AI tool the user has connected to Mnemoverse (Claude, ChatGPT, Cursor, VS Code) — write once, recall everywhere. Call this PROACTIVELY the moment the user states a preference, makes a decision, or you learn a durable fact (people, roles, project setup, a lesson). Don't wait to be asked. Do NOT use it for transient chatter, secrets, or anything only relevant to the current turn. Behavior: an importance gate may filter low-value writes, so the result tells you whether the memory was stored or filtered. Write `content` as a self-contained statement that still makes sense when recalled out of context.",
    inputSchema: {
      content: z
        .string()
        .min(1)
        .max(10000)
        .describe(
          "The memory to store as a self-contained statement, e.g. 'User prefers TypeScript strict mode' or 'Decided to deploy the API on Cloudflare Workers (2026-06)'.",
        ),
      concepts: z
        .array(z.string())
        .optional()
        .describe(
          "Key concepts for linking related memories (e.g. ['deploy', 'friday', 'staging'])",
        ),
      domain: z
        .string()
        .optional()
        .describe(
          "Namespace to organize memories (e.g. 'engineering', 'user:alice', 'project:acme')",
        ),
    },
    annotations: {
      title: "Store Memory",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ content, concepts, domain }) => {
    const r = await apiFetch<{
      stored?: boolean;
      atom_id?: string | null;
      importance?: number;
      reason?: string;
    }>("/memory/write", {
      method: "POST",
      body: JSON.stringify({
        content,
        concepts: concepts || [],
        domain: domain || "general",
      }),
    });

    const importance = (r?.importance ?? 0).toFixed(2);

    if (r?.stored) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Stored (importance: ${importance}). ID: ${r.atom_id ?? "unknown"}`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `Filtered — ${r?.reason ?? "unknown reason"} (importance: ${importance})`,
        },
      ],
    };
  },
);

// --- Tool: memory_read ---

server.registerTool(
  "memory_read",
  {
    description:
      "Search your long-term memory before answering anything that may have come up before — user preferences, past decisions, project setup, people, or earlier context. This memory is shared: it persists across sessions and across every AI tool the user has connected (Claude, ChatGPT, Cursor, VS Code). ALWAYS check here first when you're unsure whether you already know something; no need to call it for general world knowledge you already hold. Returns matches ranked by relevance (semantic similarity plus learned concept associations); each result carries an id you can pass to memory_feedback or memory_delete.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .max(5000)
        .describe(
          "Natural-language description of what you're looking for, e.g. 'database choice for the API' or 'user's preferred testing framework'.",
        ),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results to return (default: 5)"),
      domain: z
        .string()
        .optional()
        .describe(
          "Restrict the search to one domain namespace (e.g. 'project:acme'); omit to search across all domains.",
        ),
    },
    annotations: {
      title: "Search Memories",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ query, top_k, domain }) => {
    // CN-001 server-stamped authorship, returned nested on each read item.
    type Provenance = {
      principal?: string | null;
      agent?: string | null;
      agent_name?: string | null;
      client_env?: string | null;
      is_external?: boolean | null;
    };
    const r = await apiFetch<{
      items?: Array<{
        content?: string;
        relevance?: number;
        concepts?: string[];
        domain?: string;
        provenance?: Provenance | null;
      }>;
      search_time_ms?: number;
    }>("/memory/read", {
      method: "POST",
      body: JSON.stringify({
        query,
        top_k: top_k || 5,
        domain: domain || undefined,
        include_associations: true,
      }),
    });

    const items = Array.isArray(r?.items) ? r.items : [];

    if (items.length === 0) {
      return {
        content: [
          { type: "text" as const, text: "No memories found for this query." },
        ],
      };
    }

    // Surface server-stamped authorship (CN-001) so the reader knows WHO wrote each
    // memory — essential for shared rooms (Mnemoverse A2A Rooms), where atoms come from
    // different agents/vendors. The core REST response already carries `provenance`;
    // we just render it. Omitted cleanly for legacy atoms that have no author.
    const formatAuthorTag = (p?: Provenance | null): string => {
      if (!p) return "";
      // Surface only the agent identity / client env — never the human `principal`
      // (it may be an email / PII), even though it's present in the response.
      const raw = p.agent_name || p.agent || p.client_env || "";
      // Sanitize before interpolating into tool output: a hostile connector can
      // choose its own agent_name - keep only a safe charset so a value can't break
      // the tag format or inject into a client LLM (CN-032). Brackets/control dropped.
      const who = raw.replace(/[^\w .@:+/-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
      if (!who) return "";
      return p.is_external ? ` [by ${who} · external]` : ` [by ${who}]`;
    };

    const lines = items.map((item, i) => {
      const relevance = ((item?.relevance ?? 0) * 100).toFixed(0);
      const content = item?.content ?? "(empty)";
      const concepts = Array.isArray(item?.concepts) && item.concepts.length > 0
        ? ` (${item.concepts.join(", ")})`
        : "";
      return `${i + 1}. [${relevance}%] ${content}${concepts}${formatAuthorTag(item?.provenance)}`;
    });

    const searchMs = (r?.search_time_ms ?? 0).toFixed(0);
    const text = lines.join("\n\n") + `\n\n(${searchMs}ms)`;

    return {
      content: [
        {
          type: "text" as const,
          text: capResult(text),
        },
      ],
    };
  },
);

// --- Tool: memory_feedback ---

server.registerTool(
  "memory_feedback",
  {
    description:
      "Report whether memories returned by memory_read were actually helpful. This is a learning signal, not a log: positive feedback raises a memory's ranking so it surfaces faster next time (across all of the user's tools), negative feedback lets it fade. Call it right after you act on (or reject) recalled memories, passing the ids from the memory_read results.",
    inputSchema: {
      atom_ids: z
        .array(z.string())
        .min(1)
        .describe("IDs of memories to give feedback on (from memory_read results)"),
      outcome: z
        .number()
        .min(-1)
        .max(1)
        .describe("How helpful was this? 1.0 = very helpful, 0 = neutral, -1.0 = harmful/wrong"),
    },
    annotations: {
      title: "Rate Memory Helpfulness",
      readOnlyHint: false,
      // Feedback permanently mutates the memory's valence and importance
      // scores on the backend — per MCP spec, that is a destructive update
      // to the stored state (cf. ToolAnnotations.destructiveHint), even
      // though the caller intends it as quality signal rather than delete.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ atom_ids, outcome }) => {
    const r = await apiFetch<{ updated_count?: number }>("/memory/feedback", {
      method: "POST",
      body: JSON.stringify({ atom_ids, outcome }),
    });

    const count = r?.updated_count ?? 0;

    return {
      content: [
        {
          type: "text" as const,
          text: `Feedback recorded for ${count} memor${count === 1 ? "y" : "ies"}.`,
        },
      ],
    };
  },
);

// --- Tool: memory_stats ---

server.registerTool(
  "memory_stats",
  {
    description:
      "Get an overview of the stored memory: total count, episodes vs consolidated prototypes, number of learned associations, the list of domains, and average quality scores. This memory is shared across all AI tools the user has connected to Mnemoverse. Use it to orient yourself, to confirm the exact domain name before a delete, or when the user asks what you remember. Read-only — changes nothing.",
    inputSchema: {},
    annotations: {
      title: "Memory Statistics",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const r = await apiFetch<{
      total_atoms?: number;
      episodes?: number;
      prototypes?: number;
      hebbian_edges?: number;
      domains?: string[];
      avg_valence?: number;
      avg_importance?: number;
    }>("/memory/stats");

    const domains = Array.isArray(r?.domains) && r.domains.length > 0
      ? r.domains.join(", ")
      : "general";

    const text = [
      `Memories: ${r?.total_atoms ?? 0} (${r?.episodes ?? 0} episodes, ${r?.prototypes ?? 0} prototypes)`,
      `Associations: ${r?.hebbian_edges ?? 0} Hebbian edges`,
      `Domains: ${domains}`,
      `Avg quality: valence ${(r?.avg_valence ?? 0).toFixed(2)}, importance ${(r?.avg_importance ?? 0).toFixed(2)}`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  },
);

// --- Tool: memory_delete ---

server.registerTool(
  "memory_delete",
  {
    description:
      "Permanently delete ONE memory by its atom_id — irreversible, the memory is gone for good. Use only when the user explicitly asks to forget something specific, or to correct a fact you stored wrongly. Get the atom_id from a memory_read result. To clear an entire topic at once, use memory_delete_domain instead. Never delete on your own initiative — require an explicit user request.",
    inputSchema: {
      atom_id: z
        .string()
        .min(1)
        .describe(
          "The atom_id of the memory to delete (from memory_read results — each item has an id)",
        ),
    },
    annotations: {
      title: "Delete a Memory",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ atom_id }) => {
    // Core API returns { deleted: <count>, atom_id }. count == 0 means
    // the atom didn't exist (or was already removed). count >= 1 means
    // it was deleted.
    const r = await apiFetch<{ deleted?: number; atom_id?: string }>(
      `/memory/atoms/${encodeURIComponent(atom_id)}`,
      { method: "DELETE" },
    );

    if (!r?.deleted) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No memory found with id ${atom_id}.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Deleted memory ${atom_id}.`,
        },
      ],
    };
  },
);

// --- Tool: memory_delete_domain ---

server.registerTool(
  "memory_delete_domain",
  {
    description:
      "Permanently delete EVERY memory in one domain — irreversible, and far more destructive than memory_delete. Use only on an explicit user request to wipe a whole topic, e.g. 'forget everything about project X' or 'wipe my benchmark experiments'. First run memory_stats to confirm the exact domain name, then pass it together with confirm=true (a deliberate safety interlock). Never call this speculatively or to 'clean up' on your own — only when the user explicitly asks.",
    inputSchema: {
      domain: z
        .string()
        .min(1)
        .max(200)
        .describe(
          "The domain namespace to wipe (e.g., 'project:old', 'experiments-2025'). Must match exactly.",
        ),
      confirm: z
        .literal(true)
        .describe(
          "Must be exactly true to proceed. Acts as a safety interlock against accidental invocation.",
        ),
    },
    annotations: {
      title: "Delete an Entire Memory Domain",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  // The `confirm: z.literal(true)` in the input schema is the safety
  // interlock — Zod rejects any call without confirm === true before it
  // reaches this handler, so no runtime re-check is needed here.
  async ({ domain }) => {
    const r = await apiFetch<{ deleted?: number; domain?: string }>(
      `/memory/domain/${encodeURIComponent(domain)}`,
      { method: "DELETE" },
    );

    const count = r?.deleted ?? 0;
    const domainName = r?.domain ?? domain;

    return {
      content: [
        {
          type: "text" as const,
          text: `Deleted ${count} ${count === 1 ? "memory" : "memories"} from domain "${domainName}".`,
        },
      ],
    };
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
