/**
 * MCP prompts: three named entry points to the memory tools, and
 * setup_memory, which hands the user rules for their own agent (2026-09-29).
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
 * The rules setup_memory hands out. They carry what the server text no longer
 * says (src/teaching.ts, product frame): when to read, when to write, when to
 * rate. They are written for the user to place in their own agent's
 * instructions, where a host loads them as the user's own rules at the start
 * of every session. Exported so the docs and tests read one copy.
 */
export const MEMORY_RULES = [
  "## Memory (Mnemoverse)",
  "- Before answering something that may depend on an earlier session (my preferences, past decisions, project setup, people), search memory with memory_read.",
  "- When I state a lasting preference or make a decision, or you learn a durable fact about this project, save it with memory_write as one self-contained statement. You do not need to ask me first.",
  "- When a message also carries a durable fact (who now owns or does what, a lesson learned, a new convention), save that fact with memory_write before doing the rest of the task.",
  "- After acting on recalled memories, rate them with memory_feedback: helpful or not. For a shared room's memories, pass the room's address as domain; a read-only member cannot rate them.",
  "- Never store passwords, API keys, payment data, MFA codes, government IDs, or health records.",
].join("\n");

/** Where the rules go, per host. `host` is matched after trimming and lowercasing. */
export const RULES_PLACES: Record<string, string> = {
  "claude-code":
    "Claude Code: add them to CLAUDE.md in the project root, or to ~/.claude/CLAUDE.md to apply them in every project.",
  "claude-ai":
    "Claude on the web, desktop or mobile: paste them into Instructions for Claude in Settings, or into a project's instructions.",
  cursor:
    "Cursor: save them as a rule file in .cursor/rules/, for example mnemoverse-memory.mdc with alwaysApply: true.",
  codex:
    "Codex and other agents that read AGENTS.md: add them to AGENTS.md in the project root.",
};

/**
 * Register the memory prompts on `server`. They call nothing: recall,
 * save_insight and what_do_you_know render a message that asks the model to
 * use memory_read or memory_write; setup_memory renders the rules above with
 * where they go.
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

  server.registerPrompt(
    "setup_memory",
    {
      title: "Set up memory rules",
      description:
        "Get memory rules to add to CLAUDE.md, AGENTS.md, Cursor rules or your chat preferences, so your assistant checks and saves memory without being reminded.",
      argsSchema: {
        host: z
          .string()
          .optional()
          .describe(
            "Where the rules will live: claude-code, claude-ai, cursor or codex. Leave empty to see every option.",
          ),
      },
    },
    ({ host }) => {
      const key = (host ?? "").trim().toLowerCase();
      // Own keys only: a host of "constructor" or "__proto__" must not reach
      // Object.prototype and print a function where a sentence belongs.
      const place = Object.hasOwn(RULES_PLACES, key) ? RULES_PLACES[key] : undefined;
      const where = place
        ? place
        : `Where they go:\n${Object.values(RULES_PLACES)
            .map((line) => `- ${line}`)
            .join("\n")}`;
      const text =
        "Help me set up memory rules so you use my Mnemoverse memory on your own. " +
        `These are the rules:\n\n${MEMORY_RULES}\n\n${where}\n\n` +
        "Show me where they go, explain in two sentences why rules like these work better than asking in every chat, and offer to add them for me.";
      return {
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text },
          },
        ],
      };
    },
  );
}
