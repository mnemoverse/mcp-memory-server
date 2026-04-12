#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL =
  process.env.MNEMOVERSE_API_URL || "https://core.mnemoverse.com/api/v1";
const API_KEY = process.env.MNEMOVERSE_API_KEY || "";

// Hard cap on tool result size — required by Claude Connectors Directory
// (https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide).
// Approximate token count = chars / 4. Cap at 24,000 tokens to leave headroom under the 25K limit.
const MAX_RESULT_CHARS = 24_000 * 4;

if (!API_KEY) {
  console.error(
    "Error: MNEMOVERSE_API_KEY environment variable is required.\n" +
      "Get your free key at https://console.mnemoverse.com",
  );
  process.exit(1);
}

async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
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

  return res.json();
}

/**
 * Truncate a result string to MAX_RESULT_CHARS, appending a notice if truncated.
 * Required by Claude Connectors Directory submission policy.
 */
function capResult(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  const truncated = text.slice(0, MAX_RESULT_CHARS - 200);
  return (
    truncated +
    `\n\n[…truncated to fit 25K token limit. Use a more specific query or smaller top_k to see all results.]`
  );
}

// --- Server setup ---

const server = new McpServer({
  name: "mnemoverse-memory",
  version: "0.3.1",
});

// --- Tool: memory_write ---

server.registerTool(
  "memory_write",
  {
    description:
      "Store a memory that should persist across sessions — preferences, decisions, lessons learned, project facts, people and roles. Memories you store are also accessible from Claude, ChatGPT, Cursor, VS Code, and any other AI tool the user connects to Mnemoverse — write once, recall everywhere. Call this PROACTIVELY whenever the user states a preference, makes a decision, or you learn something important. Don't wait to be asked — if it's worth remembering, store it now.",
    inputSchema: {
      content: z
        .string()
        .min(1)
        .max(10000)
        .describe("The memory to store — what happened, what was learned"),
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
    const result = await apiFetch("/memory/write", {
      method: "POST",
      body: JSON.stringify({
        content,
        concepts: concepts || [],
        domain: domain || "general",
      }),
    });

    const r = result as {
      stored: boolean;
      atom_id: string | null;
      importance: number;
      reason: string;
    };

    if (r.stored) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Stored (importance: ${r.importance.toFixed(2)}). ID: ${r.atom_id}`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `Filtered — ${r.reason} (importance: ${r.importance.toFixed(2)})`,
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
      "ALWAYS call this tool first when the user asks a question about preferences, past decisions, project setup, people, or anything that might have been discussed before. This is your long-term memory — it persists across sessions and tools (Claude, ChatGPT, Cursor, VS Code, and any other AI tool the user connects). Search by natural language query. If you have any doubt whether you know something — check memory first.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .max(5000)
        .describe("Natural language query — what are you looking for?"),
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
        .describe("Filter by domain namespace"),
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
    const result = await apiFetch("/memory/read", {
      method: "POST",
      body: JSON.stringify({
        query,
        top_k: top_k || 5,
        domain: domain || undefined,
        include_associations: true,
      }),
    });

    const r = result as {
      items: Array<{
        content: string;
        relevance: number;
        concepts: string[];
        domain: string;
      }>;
      search_time_ms: number;
    };

    if (r.items.length === 0) {
      return {
        content: [
          { type: "text" as const, text: "No memories found for this query." },
        ],
      };
    }

    const lines = r.items.map(
      (item, i) =>
        `${i + 1}. [${(item.relevance * 100).toFixed(0)}%] ${item.content}` +
        (item.concepts.length > 0
          ? ` (${item.concepts.join(", ")})`
          : ""),
    );

    const text = lines.join("\n\n") + `\n\n(${r.search_time_ms.toFixed(0)}ms)`;

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
      "Report whether a retrieved memory was helpful. Positive feedback makes memories easier to find next time across all tools. Negative feedback lets them fade. Call this after using memories from memory_read.",
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
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ atom_ids, outcome }) => {
    const result = await apiFetch("/memory/feedback", {
      method: "POST",
      body: JSON.stringify({ atom_ids, outcome }),
    });

    const r = result as { updated_count: number };

    return {
      content: [
        {
          type: "text" as const,
          text: `Feedback recorded for ${r.updated_count} memor${r.updated_count === 1 ? "y" : "ies"}.`,
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
      "Get memory statistics — how many memories are stored, which domains exist, average quality scores. These memories are shared with all AI tools the user has connected to Mnemoverse. Useful for understanding the current state of memory.",
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
    const result = await apiFetch("/memory/stats");

    const r = result as {
      total_atoms: number;
      episodes: number;
      prototypes: number;
      hebbian_edges: number;
      domains: string[];
      avg_valence: number;
      avg_importance: number;
    };

    const text = [
      `Memories: ${r.total_atoms} (${r.episodes} episodes, ${r.prototypes} prototypes)`,
      `Associations: ${r.hebbian_edges} Hebbian edges`,
      `Domains: ${r.domains.length > 0 ? r.domains.join(", ") : "general"}`,
      `Avg quality: valence ${r.avg_valence.toFixed(2)}, importance ${r.avg_importance.toFixed(2)}`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  },
);

// --- Tool: memory_delete ---

server.registerTool(
  "memory_delete",
  {
    description:
      "Permanently delete a single memory by its atom_id. Use when the user explicitly asks to forget something specific, or when you stored a wrong fact that needs correcting. The deletion is irreversible — the memory is gone for good. For broad cleanup of an entire topic, prefer memory_delete_domain.",
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
    const result = await apiFetch(`/memory/atoms/${encodeURIComponent(atom_id)}`, {
      method: "DELETE",
    });

    // Core API returns { deleted: <count>, atom_id }. count == 0 means
    // the atom didn't exist (or was already removed). count >= 1 means it was deleted.
    const r = result as { deleted: number; atom_id?: string };

    if (!r.deleted) {
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
      "Permanently delete ALL memories in a given domain. Use when the user wants to clean up an entire topic — e.g., 'forget everything about project X' or 'wipe my benchmark experiments'. The deletion is irreversible. List domains first with memory_stats to confirm the exact name. Refuse to call this without an explicit user request — it is much more destructive than memory_delete.",
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
  async ({ domain, confirm }) => {
    if (confirm !== true) {
      throw new Error(
        "memory_delete_domain requires confirm=true as a safety interlock.",
      );
    }

    const result = await apiFetch(`/memory/domain/${encodeURIComponent(domain)}`, {
      method: "DELETE",
    });

    const r = result as { deleted: number; domain: string };

    return {
      content: [
        {
          type: "text" as const,
          text: `Deleted ${r.deleted} ${r.deleted === 1 ? "memory" : "memories"} from domain "${r.domain}".`,
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
