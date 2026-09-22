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
 * copy. One difference is deliberate: `domain` in save_insight is printed as
 * an exact JSON literal (src/names.ts), like every domain this package names,
 * because the model has to send it back to memory_write byte for byte. For a
 * plain domain the message is identical to the connector's. The other
 * arguments are trimmed, as the connector trims them, because a blank topic is
 * not a request.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { exactLiteral, withDomainEscapeLegend } from "./names.js";

/**
 * Register the three memory prompts on `server`. They call nothing: each
 * renders a message that asks the model to use memory_read or memory_write.
 */
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
    ({ insight, domain }) => {
      // The domain is an identifier the model must reproduce exactly, so it is
      // printed as a JSON literal: a quote, backslash, newline or invisible
      // character inside it is escaped instead of closing the quotes early
      // (Copilot on #148). A plain domain prints exactly as the connector's
      // `"${domain}"` did. A domain too long to print exactly is refused
      // rather than named inexactly or dropped, since dropping it would file
      // the insight somewhere the user did not ask for.
      let under = "";
      if (domain) {
        const exact = exactLiteral(domain);
        if (exact === null) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "save_insight: this domain is too long to be quoted exactly in the message. Pass a shorter domain.",
          );
        }
        under = ` under the domain ${exact.literal}`;
      }
      const text = `Use the memory_write tool to store this insight in my long-term memory${under}: "${insight}". Then confirm exactly what was stored.`;
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: withDomainEscapeLegend(text, domain),
            },
          },
        ],
      };
    },
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
