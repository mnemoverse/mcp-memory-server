#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  formatReadItem,
  formatRecentPage,
  safeInline,
  type Provenance,
  type ReadItem,
  type RecentItem,
} from "./render.js";
import { SERVER_INSTRUCTIONS, buildReadEmptyResponse } from "./teaching.js";
import {
  unsearchedRoomsNote,
  futureSinceNote,
  nearestDomainNote,
} from "./scope.js";

/**
 * On an empty SCOPED result, ask stats for the domain list and say whether the
 * name is a casing slip or a near-miss. One extra call, only on the zero-result
 * path — the same shape as the existing first-contact probe. Never throws: a
 * failed probe just means no extra help, which is the status quo.
 */
async function domainMissNote(domain: string): Promise<string> {
  try {
    const s = await apiFetch<{ domains?: string[] }>("/memory/stats");
    const known = Array.isArray(s?.domains) ? s.domains : [];
    if (known.includes(domain)) return "";
    return nearestDomainNote(domain, known);
  } catch {
    return "";
  }
}

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
function capResult(
  text: string,
  moreHint = "Use a more specific query or smaller top_k to see all results.",
): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  let truncated = text.slice(0, MAX_RESULT_CHARS - 200);
  const lastCode = truncated.charCodeAt(truncated.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  // `moreHint` lets no-input tools (the discovery lists) give accurate truncation
  // guidance instead of the read-tool default (which points at query/top_k controls a
  // repeated no-arg call cannot use). Existing callers keep the default message.
  return `${truncated}\n\n[…truncated to fit the 25K token limit. ${moreHint}]`;
}

/**
 * Sanitize an untrusted string for safe inline rendering in tool output that a
 * DIFFERENT principal's LLM will read (CN-032 anti-injection). A room name is
 * chosen by the room OWNER but surfaced to a JOINER's assistant on join/invite;
 * core only trims whitespace on it, so quotes/colons/newlines pass. Strip to a
 * conservative charset and collapse whitespace, then cap length. Same treatment
 * `formatAuthorTag` already applies to a server-stamped author.
 * Implementation lives in src/render.ts (shared with the item renderers,
 * testable there); re-imported here for the 15 other call sites.
 */

// --- Server setup ---

// The second argument lands verbatim in the connected model's system prompt on
// clients that surface MCP instructions — it is the single highest-leverage
// teaching surface this server has. Kept in src/teaching.ts so tests can
// assert its polarity/length without booting the server.
const server = new McpServer(
  {
    name: "mnemoverse-memory",
    version: pkg.version,
  },
  { instructions: SERVER_INSTRUCTIONS },
);

// --- Tool: memory_write ---

server.registerTool(
  "memory_write",
  {
    description:
      "Store a long-term memory that persists across sessions AND across every AI tool the user has connected to Mnemoverse (Claude, ChatGPT, Cursor, VS Code) — write once, recall everywhere. Call this PROACTIVELY the moment the user states a preference, makes a decision, or you learn a durable fact (people, roles, project setup, a lesson). Don't wait to be asked. Never store passwords, API keys, payment data, MFA codes, government IDs, or health records; skip transient chatter that only matters this turn. Behavior: an importance gate may filter low-value writes, so the result tells you whether the memory was stored or filtered. Write `content` as a self-contained statement that still makes sense when recalled out of context.",
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
    // NOT STORED. The old wording ("Filtered — …") named the mechanism but
    // never the outcome, so a caller could read it as a soft success and move
    // on. In dogfooding this ate a CORRECTION to a wrong fact: the stale
    // version stayed as the only record, and looked more authoritative for
    // having no competitor (2026-08-07). Say plainly that nothing was saved,
    // and what to do about it.
    return {
      content: [
        {
          type: "text" as const,
          text:
            `NOT STORED — the importance gate rejected it (${r?.reason ?? "no reason given"}; ` +
            `importance ${importance}). Nothing was saved. If this matters, rewrite it as a ` +
            `self-contained factual statement ("X is Y", "we decided Z because…") rather than ` +
            `a remark or a meta-comment, and write it again.`,
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
      "Search your long-term memory before answering anything that may have come up before — user preferences, past decisions, project setup, people, or earlier context. This memory is shared: it persists across sessions and across every AI tool the user has connected (Claude, ChatGPT, Cursor, VS Code). ALWAYS check here first when you're unsure whether you already know something; no need to call it for general world knowledge you already hold. Returns matches ranked by relevance (or newest-first with order_by: 'recency'); each result carries an id you can pass to memory_feedback or memory_delete.",
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
        .describe(
          "Requested number of results (default: 5). ⚠️ Not a hard cap: association expansion can return MORE than this, and the relevance floor can return fewer — raising it does not reliably widen the result set. For a complete, exactly-bounded listing use memory_list_recent instead.",
        ),
      domain: z
        .string()
        .optional()
        .describe(
          "Restrict the search to one domain namespace (e.g. 'project:acme'). Omitting it searches your OWN domains — it does NOT include shared rooms, which are separate stores: to search a room, pass its address here (e.g. 'xroom:room_01ABC'). Find room addresses with memory_list_rooms.",
        ),
      order_by: z
        .enum(["relevance", "recency"])
        .optional()
        .describe(
          "'relevance' (default) = ranking order. 'recency' = the matched " +
            "set re-sorted newest-first. For a complete newest-first feed " +
            "with no search at all, use memory_list_recent instead.",
        ),
      since: z
        .string()
        .max(40)
        .optional()
        .describe(
          "Only memories created at/after this ISO-8601 instant (naive = " +
            "UTC) — e.g. your last-seen watermark in a shared room.",
        ),
      until: z
        .string()
        .max(40)
        .optional()
        .describe("Only memories created at/before this ISO-8601 instant."),
      exclude_author: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Drop memories written by this author PRINCIPAL — the server-side " +
            "identity. ⚠️ NOT USABLE FROM HERE YET: the principal is not shown " +
            "in these results, so there is no value you can obtain through " +
            "this tool, and a guess like 'me' silently matches nothing and " +
            "filters nothing. Only pass it if your system knows the exact " +
            "principal from elsewhere (e.g. the REST API). A self-exclusion " +
            "shortcut is planned.",
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
  async ({ query, top_k, domain, order_by, since, until, exclude_author }) => {
    const r = await apiFetch<{
      items?: ReadItem[];
      search_time_ms?: number;
    }>("/memory/read", {
      method: "POST",
      body: JSON.stringify({
        query,
        top_k: top_k || 5,
        domain: domain || undefined,
        include_associations: true,
        // #404 temporal dimension — omitted entirely when unused so the
        // request body stays byte-identical for existing callers.
        ...(order_by ? { order_by } : {}),
        ...(since ? { since } : {}),
        ...(until ? { until } : {}),
        ...(exclude_author ? { exclude_author } : {}),
      }),
    });

    const items = Array.isArray(r?.items) ? r.items : [];

    if (items.length === 0 && (since || until || exclude_author)) {
      // A bounded/filtered read that finds nothing is NOT a bad query —
      // the truthful answer is "nothing new for these filters" (mirrors
      // memory_list_recent's empty copy; no stats probe, no broaden hint).
      // Unscoped, it also has to name the rooms it never looked in.
      const scopeNote = domain
        ? await domainMissNote(domain)
        : await unsearchedRoomsNote(
            () => apiFetch<unknown>("/memory/rooms"),
            safeInline,
          );
      return {
        content: [
          {
            type: "text" as const,
            text:
              "Nothing matching within the given time/author filters." +
              futureSinceNote(since, Date.now()) +
              scopeNote,
          },
        ],
      };
    }

    if (items.length === 0) {
      // Zero results: ONE stats call (made only on this path) distinguishes a
      // truly empty store (first contact — greet with how to save the first
      // memory) from "no match for this query" (hint to broaden). Stats
      // failure falls open to the plain no-match message. Domain-scoped reads
      // never greet and never probe — the stats call measures the PERSONAL
      // store, not the scoped domain. See src/teaching.ts.
      const scoped = domain != null && domain.trim() !== "";
      const text = await buildReadEmptyResponse(
        () => apiFetch<{ total_atoms?: number }>("/memory/stats"),
        // trim(): a whitespace-only domain is not a real filter — treating it
        // as scoped would silently suppress the first-contact greeting.
        scoped,
      );
      // Same rule as the feed: an unscoped miss must name the rooms it never
      // searched, or "no memories found" reads as a fact about everything.
      const scopeNote = scoped
        ? await domainMissNote(domain!.trim())
        : await unsearchedRoomsNote(
            () => apiFetch<unknown>("/memory/rooms"),
            safeInline,
          );
      return {
        content: [{ type: "text" as const, text: text + scopeNote }],
      };
    }

    // Rendering lives in src/render.ts (testable): each line carries the
    // CN-001 author tag, the created_at date (#404 R1 — a reader cannot
    // reason about recency it cannot see) and the full atom id (the tool
    // description always promised ids for memory_feedback/memory_delete;
    // the old render never delivered them, making both uncallable from
    // read results).
    const lines = items.map((item, i) => formatReadItem(item, i));

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

// --- Tool: memory_list_recent ---

server.registerTool(
  "memory_list_recent",
  {
    description:
      "List the NEWEST memories first — no search query needed. Semantic search answers 'what do I know about X'; this answers 'what happened lately': resuming work after a break, catching up on a shared room ('any new messages?'), or reviewing what was saved recently. Pass `since` (your last-seen time) to get only what's new, and page through older entries with the returned cursor. Complete by construction WITHIN ONE SCOPE — nothing is skipped there, unlike a semantic search. To catch up on a shared room you MUST pass its address as `domain`: rooms are separate stores and an unscoped call never covers them.",
    inputSchema: {
      domain: z
        .string()
        .optional()
        .describe(
          "Restrict to one domain. REQUIRED to read a shared room — pass its address ('xroom:room_01ABC'), because rooms are separate stores that an unscoped feed does NOT cover. Omit only when you mean your own domains. Room addresses come from memory_list_rooms.",
        ),
      since: z
        .string()
        .optional()
        .describe(
          "Only entries created at/after this ISO-8601 instant (naive = UTC) — your novelty watermark.",
        ),
      until: z
        .string()
        .optional()
        .describe(
          "Only entries created at/before this ISO-8601 instant (inclusive). Pair with `since` to read a closed window — 'what happened on Monday' — instead of paging back from now.",
        ),
      exclude_author: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Drop entries written by this author PRINCIPAL. ⚠️ NOT USABLE FROM HERE YET — the principal is never shown in these results, so there is no value you can get through this tool; a guess like 'me' filters nothing, silently. Same caveat as on memory_read.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Page size (default: 20). Newest first."),
      cursor: z
        .string()
        .max(512)
        .optional()
        .describe(
          "Opaque cursor from a previous page's 'More older entries exist' line — continues the listing without skips or duplicates.",
        ),
    },
    annotations: {
      title: "List Recent Memories",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ domain, since, until, exclude_author, limit, cursor }) => {
    let r: { items?: RecentItem[]; next_cursor?: string | null };
    try {
      r = await apiFetch<{ items?: RecentItem[]; next_cursor?: string | null }>(
        "/memory/recent",
        {
          method: "POST",
          body: JSON.stringify({
            domain: domain || undefined,
            since: since || undefined,
            until: until || undefined,
            exclude_author: exclude_author || undefined,
            limit: limit || 20,
            cursor: cursor || undefined,
          }),
        },
      );
    } catch (e) {
      // Graceful degradation while the server side rolls out: a 404 from
      // core means the /memory/recent endpoint is not deployed yet — say
      // so instead of surfacing a raw HTTP error.
      const endpointAbsent =
        e instanceof Error &&
        e.message.startsWith("Mnemoverse API error 404:") &&
        !e.message.includes('"code"');
      if (endpointAbsent) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "The memory service does not support the recent-entries feed yet. " +
                "Use memory_read with order_by: 'recency' as an approximation.",
            },
          ],
        };
      }
      throw e;
    }

    const items = Array.isArray(r?.items) ? r.items : [];
    if (items.length === 0) {
      // An empty UNSCOPED feed must say where it looked. Rooms are separate
      // stores and are never covered here, so a bare "nothing new" is a false
      // claim about the world (incident 2026-08-07 — see src/scope.ts).
      const scopeNote = domain
        ? await domainMissNote(domain)
        : await unsearchedRoomsNote(
            () => apiFetch<unknown>("/memory/rooms"),
            safeInline,
          );
      return {
        content: [
          {
            type: "text" as const,
            text:
              (since
                ? "Nothing new since your watermark."
                : "No memories here yet.") +
              futureSinceNote(since, Date.now()) +
              scopeNote,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: capResult(
            formatRecentPage(items, r?.next_cursor),
            "Lower `limit` or add a `domain` for smaller pages.",
          ),
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
        .describe(
          "IDs of memories to give feedback on (from memory_read results)",
        ),
      outcome: z
        .number()
        .min(-1)
        .max(1)
        .describe(
          "How helpful was this? 1.0 = very helpful, 0 = neutral, -1.0 = harmful/wrong",
        ),
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

    // "Feedback recorded for 0 memories." is one character away from the
    // success line and reads like one. Zero here almost always means the ids
    // were stale or came from somewhere other than a read result — say that,
    // because it is the actionable part (dogfood, 2026-08-07).
    if (count === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              "No feedback was recorded — none of those ids matched a memory. " +
              "Ids come from a memory_read result (the `id:` line under each hit) " +
              "and stop matching once a memory is deleted.",
          },
        ],
      };
    }

    // Echo the DIRECTION, not just the count: the same four words for +1 and
    // -1 gave a caller no evidence the loop did anything, which is why nobody
    // calls it twice.
    const direction =
      outcome > 0 ? "helpful" : outcome < 0 ? "unhelpful" : "neutral";
    return {
      content: [
        {
          type: "text" as const,
          text:
            `Recorded ${outcome > 0 ? "+" : ""}${outcome} (${direction}) for ` +
            `${count} memor${count === 1 ? "y" : "ies"} — this shifts how they rank next time.`,
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

    // A field the server did not send is UNKNOWN, not zero. Rendering it as
    // "0" is the same class of lie as an empty search claiming emptiness:
    // "Associations: 0" reads as "this memory has learned nothing", which is
    // a strong and possibly false statement about the product itself.
    const num = (v: unknown) => (typeof v === "number" ? String(v) : "unknown");
    const dec = (v: unknown) => (typeof v === "number" ? v.toFixed(2) : "unknown");

    const domains =
      Array.isArray(r?.domains) && r.domains.length > 0
        ? r.domains.join(", ")
        : "none reported";

    const text = [
      `Memories: ${num(r?.total_atoms)} (${num(r?.episodes)} episodes, ${num(r?.prototypes)} prototypes)`,
      `Associations: ${num(r?.hebbian_edges)} Hebbian edges — links the store learned between memories that get used together`,
      `Domains: ${domains}`,
      `Avg quality: valence ${dec(r?.avg_valence)} (how well recalls turned out, -1..1), importance ${dec(r?.avg_importance)} (0..1)`,
      "",
      "Counts cover your own domains. Shared rooms are separate stores and are not included — see memory_list_rooms.",
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  },
);

// --- Tool: memory_delete ---

server.registerTool(
  "memory_delete",
  {
    description:
      "Permanently delete ONE memory by its atom_id — irreversible, the memory is gone for good. Use it to keep the memory trustworthy: prune a memory that is obsolete, superseded by a newer decision, or that you stored wrongly — and whenever the user asks to forget something. Get the atom_id from a memory_read result. To clear an entire topic at once, use memory_delete_domain instead.",
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
      "Permanently delete EVERY memory in one domain — irreversible, and far more sweeping than memory_delete. This is a bulk wipe: run it only when the user asks for it (e.g. 'forget everything about project X') or has explicitly confirmed a wipe you proposed — never on your own judgment alone. First run memory_stats to confirm the exact domain name, then pass it together with confirm=true (a deliberate safety interlock). For a single wrong or stale memory, memory_delete is the right tool.",
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

// --- Tool: memory_create_room ---

server.registerTool(
  "memory_create_room",
  {
    description:
      "Create a SHARED memory room — a space you and OTHER people's assistants can both read and write, across Claude/ChatGPT/Cursor. Use when the user wants to share context or collaborate with someone else (e.g. 'make a room for me and Olya'). Returns the room's address; pass that address as the `domain` on memory_write/memory_read to use it. To bring someone in, call memory_invite_to_room next.",
    inputSchema: {
      name: z
        .string()
        .min(1)
        .max(200)
        .describe(
          "Room name, unique within your account (e.g. 'me-and-olya').",
        ),
      description: z
        .string()
        .max(2000)
        .optional()
        .describe("Optional description of the room."),
    },
    annotations: {
      title: "Create shared room",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ name, description }) => {
    const r = await apiFetch<{
      room_id?: string;
      address?: string;
      name?: string;
    }>("/memory/rooms", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
    const roomName = safeInline(r?.name ?? name);
    const address = safeInline(r?.address);
    const roomId = safeInline(r?.room_id);
    // If core returned no usable id (empty body / sanitized away), don't print
    // broken `domain=""` guidance — say so instead (Copilot).
    const text = address
      ? `Created shared room "${roomName}". Address: ${address}\n` +
        `Use it now: pass domain="${address}" on memory_write / memory_read.\n` +
        (roomId
          ? `To add someone: call memory_invite_to_room with room_id="${roomId}".`
          : "")
      : `Room "${roomName}" was created but the server did not return a usable address — ` +
        `retry, or check that your API key is set.`;
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

// --- Tool: memory_invite_to_room ---

server.registerTool(
  "memory_invite_to_room",
  {
    description:
      "Mint a one-time invite for a room you own and get a ready-to-forward message. The user sends that message to the person they want to add (any messenger); the recipient opens the link or tells THEIR assistant the code to join. Use after memory_create_room, or whenever the user says 'invite <someone>' to an existing room.",
    inputSchema: {
      room_id: z
        .string()
        .min(1)
        .max(100)
        .describe("The room's id (room_...), from memory_create_room."),
      scope: z
        .enum(["read", "read_write"])
        .optional()
        .describe(
          "Role the invitee gets — 'read' or 'read_write' (default read_write).",
        ),
      expires_in_days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe("Days until the invite expires (default 7)."),
    },
    annotations: {
      title: "Invite to room",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ room_id, scope, expires_in_days }) => {
    const r = await apiFetch<{
      share_message?: string;
      join_url?: string;
      code?: string;
    }>(`/memory/rooms/${encodeURIComponent(room_id)}/invites`, {
      method: "POST",
      body: JSON.stringify({ scope, expires_in_days }),
    });
    return {
      content: [
        {
          type: "text" as const,
          // Shown to the room OWNER (who minted it), not a foreign principal, so
          // the core-generated share_message is fine as-is; capResult only bounds
          // its length for the Connectors-Directory 25K cap.
          text: capResult(
            `Invite ready. Forward this message to the person you're inviting:\n\n` +
              `${r?.share_message ?? r?.join_url ?? "(no message returned)"}`,
          ),
        },
      ],
    };
  },
);

// --- Tool: memory_join_room ---

server.registerTool(
  "memory_join_room",
  {
    description:
      "Join a shared memory room using an invite code (starts with 'mnvr_'). Use when the user pastes an invite code or says something like 'join room with code ...'. After joining, use the returned address as the `domain` on memory_write/memory_read to read and write the shared room.",
    inputSchema: {
      code: z.string().min(1).max(200).describe("The invite code (mnvr_...)."),
    },
    annotations: {
      title: "Join room",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ code }) => {
    const r = await apiFetch<{
      address?: string;
      name?: string;
      scope?: string;
      already_member?: boolean;
    }>("/memory/rooms/join", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    // CN-032: the room name/scope are OWNER-chosen but rendered into the
    // JOINER's LLM context here — sanitize before inlining (anti prompt-injection).
    const roomName = safeInline(r?.name) || "the room";
    const scope = safeInline(r?.scope) || "member";
    const address = safeInline(r?.address);
    const prefix = r?.already_member
      ? `You're already a member of "${roomName}".`
      : `Joined "${roomName}" (${scope}).`;
    // Don't print broken `domain=""` guidance if no address came back (Copilot).
    const usage = address
      ? `Use it: pass domain="${address}" on memory_write / memory_read to read and write the shared room.`
      : `The server did not return a room address — retry, or check that your API key is set.`;
    return {
      content: [
        {
          type: "text" as const,
          text: capResult(`${prefix}\n${usage}`),
        },
      ],
    };
  },
);

// --- Tool: memory_list_rooms ---

server.registerTool(
  "memory_list_rooms",
  {
    description:
      "List the shared memory rooms you can use — the ones you OWN plus the ones you've JOINED — each with the address to pass as `domain` on memory_write / memory_read. Use this to RE-FIND a room in a new session (e.g. 'what rooms do I have?', 'resume the room with Olya') instead of having to create or re-join it.",
    inputSchema: {},
    annotations: {
      title: "List rooms",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const rooms = await apiFetch<
      Array<{
        room_id?: string;
        name?: string;
        address?: string;
        role?: string;
        scope?: string;
        archived?: boolean;
      }>
    >("/memory/rooms");
    const list = Array.isArray(rooms) ? rooms : [];
    if (list.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              "You have no shared rooms yet. Create one with memory_create_room, " +
              "or join one with memory_join_room using an invite code.",
          },
        ],
      };
    }
    // Room name is OWNER-chosen and surfaced to THIS assistant — sanitize it (CN-032),
    // like memory_join_room already does. address/role/scope are server-shaped but pass
    // through the same guard defensively.
    const lines = list.map((r) => {
      const name = safeInline(r?.name) || "(unnamed room)";
      const roomId = safeInline(r?.room_id);
      // Always surface the canonical address: fall back to xroom:<room_id> when the server
      // omits `address`, so the domain guidance this tool promises is never silently dropped.
      const address = safeInline(r?.address) || (roomId ? `xroom:${roomId}` : "");
      const role = safeInline(r?.role);
      const scope = safeInline(r?.scope);
      const archived = r?.archived ? " [archived]" : "";
      const use = address ? ` — use domain="${address}"` : "";
      return `- "${name}" (${role}${scope ? `, ${scope}` : ""})${archived}${use}`;
    });
    const text = `Your shared rooms (${list.length}):\n${lines.join("\n")}`;
    return {
      content: [
        {
          type: "text" as const,
          text: capResult(text, "The room list was truncated — some rooms are not shown."),
        },
      ],
    };
  },
);

// --- Tool: vault_list ---

server.registerTool(
  "vault_list",
  {
    description:
      "List the secrets stored in your Mnemoverse Vault — by ALIAS and purpose only; the secret VALUE is never returned or shown to you. Use this to DISCOVER which secret to use (e.g. the user says 'use my GitHub token' — find its alias here) before a tool that consumes it. Only YOUR account's secrets are listed.",
    inputSchema: {},
    annotations: {
      title: "List vault secrets",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const r = await apiFetch<{
      secrets?: Array<{
        alias?: string;
        context?: string;
        created_at?: string;
        concepts?: string[];
      }>;
    }>("/vault/secrets");
    const list = Array.isArray(r?.secrets) ? r.secrets : [];
    if (list.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No secrets are stored in your Vault yet.",
          },
        ],
      };
    }
    const lines = list.map((s) => {
      const alias = safeInline(s?.alias) || "(no alias)";
      const context = safeInline(s?.context);
      return context ? `- ${alias} — ${context}` : `- ${alias}`;
    });
    const text =
      `Your Vault secrets (${list.length}) — alias and purpose only, never the value:\n` +
      lines.join("\n");
    return {
      content: [
        {
          type: "text" as const,
          text: capResult(text, "The secret list was truncated — some secrets are not shown."),
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
