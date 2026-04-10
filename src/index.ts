#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL =
  process.env.MNEMOVERSE_API_URL || "https://core.mnemoverse.com/api/v1";
const API_KEY = process.env.MNEMOVERSE_API_KEY || "";

if (!API_KEY) {
  console.error(
    "Error: MNEMOVERSE_API_KEY environment variable is required.\n" +
      "Get your free key at https://console.mnemoverse.com"
  );
  process.exit(1);
}

async function apiFetch(
  path: string,
  options: RequestInit = {}
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

// --- Server setup ---

const server = new McpServer({
  name: "mnemoverse-memory",
  version: "0.1.0",
});

// --- Tool: memory_write ---

server.tool(
  "memory_write",
  "Store a memory — insight, pattern, preference, or fact. Persists across sessions. Use this when the user teaches you something worth remembering, or when you learn a lesson from a task.",
  {
    content: z
      .string()
      .min(1)
      .max(10000)
      .describe("The memory to store — what happened, what was learned"),
    concepts: z
      .array(z.string())
      .optional()
      .describe("Key concepts for linking related memories (e.g. ['deploy', 'friday', 'staging'])"),
    domain: z
      .string()
      .optional()
      .describe("Namespace to organize memories (e.g. 'engineering', 'user:alice', 'project:acme')"),
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
  }
);

// --- Tool: memory_read ---

server.tool(
  "memory_read",
  "Search memories by natural language query. Returns the most relevant stored memories. Use this before starting a task to check if you already know something about it.",
  {
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
          : "")
    );

    return {
      content: [
        {
          type: "text" as const,
          text: lines.join("\n\n") + `\n\n(${r.search_time_ms.toFixed(0)}ms)`,
        },
      ],
    };
  }
);

// --- Tool: memory_feedback ---

server.tool(
  "memory_feedback",
  "Report whether a retrieved memory was helpful. Positive feedback makes memories easier to find next time. Negative feedback lets them fade. Call this after using memories from memory_read.",
  {
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
  }
);

// --- Tool: memory_stats ---

server.tool(
  "memory_stats",
  "Get memory statistics — how many memories are stored, which domains exist, average quality scores. Useful for understanding the current state of memory.",
  {},
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
  }
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
