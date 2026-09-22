/**
 * MCP prompts: three named entry points to the memory tools.
 *
 * Clients that support the prompts capability show them as commands (Claude
 * Code as `/mcp__mnemoverse__<name>`, Claude.ai connectors in the slash menu).
 * Each returns one user message that points the model at the right tool. They
 * add no capability beyond the tools; a client without prompt support ignores
 * them.
 *
 * Moved here from the hosted connector (mnemoverse-mcp-remote,
 * src/prompts/index.ts) in step 3c of the ADR-025 plan, with the same names,
 * arguments and wording, so the connector can register these instead of its
 * copy. One difference is deliberate: `domain` in save_insight is quoted
 * exactly as given, like every domain this package handles; the other
 * arguments are trimmed, as the connector trims them, because a blank topic is
 * not a request.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerMemoryPrompts(server: McpServer): void {
  server.registerPrompt(
    "recall",
    {
      title: "Recall from memory",
      description: "Search your Mnemoverse memory for saved information about a specific topic.",
      argsSchema: {
        topic: z
          .string()
          .trim()
          .min(1)
          .describe("What to recall — a topic, project, person, or open question."),
      },
    },
    ({ topic }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Use memory_read to search my saved Mnemoverse memories for this specific topic: "${topic}". Summarize only the returned memory text. If nothing relevant is stored, say so plainly.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "save_insight",
    {
      title: "Save an insight to memory",
      description: "Store a new insight, fact, or decision in your Mnemoverse long-term memory.",
      argsSchema: {
        insight: z
          .string()
          .trim()
          .min(1)
          .describe("The insight, fact, or decision to remember."),
        domain: z
          .string()
          .optional()
          .describe("Optional domain/category to file it under (e.g. 'project-x')."),
      },
    },
    ({ insight, domain }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Use the memory_write tool to store this insight in my long-term memory${
              domain ? ` under the domain "${domain}"` : ""
            }: "${insight}". Then confirm exactly what was stored.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "what_do_you_know",
    {
      title: "What do you know about…",
      description: "Get a briefing of what your memory holds about a subject.",
      argsSchema: {
        subject: z.string().trim().min(1).describe("The subject to brief on."),
      },
    },
    ({ subject }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Use memory_read to look up what I have explicitly stored about "${subject}". Give me a concise briefing based only on the returned memory text and flag gaps where nothing is stored.`,
          },
        },
      ],
    }),
  );
}
