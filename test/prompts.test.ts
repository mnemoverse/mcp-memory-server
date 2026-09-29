/**
 * MCP prompts (0.11, step 3c): recall, save_insight, what_do_you_know; and
 * setup_memory (2026-09-29), which only this package has so far.
 *
 * Moved from the hosted connector. The first four tests are its own
 * (mnemoverse-mcp-remote test/mcp-protocol.test.ts, "MCP prompts (memory
 * rituals)"), so the two servers answer the same once the connector registers
 * these; the rest pin what this package adds: the prompts reach a client of
 * the stdio server, a domain is quoted exactly as given, a blank argument is
 * refused, and rendering a prompt calls nothing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DOMAIN_ESCAPE_LEGEND, exactLiteral } from "../src/names.js";
import { NAMES } from "./name-cases.js";
import { MEMORY_RULES, RULES_PLACES } from "../src/prompts.js";
import { startMemoryServer, type Harness } from "./harness.js";

let mcp: Harness;
beforeAll(async () => {
  mcp = await startMemoryServer();
});
beforeEach(() => {
  mcp.reset();
});
afterAll(async () => {
  await mcp.close();
});

async function render(name: string, args: Record<string, string>): Promise<string> {
  const res = await mcp.client.getPrompt({ name, arguments: args });
  expect(res.messages).toHaveLength(1);
  expect(res.messages[0].role).toBe("user");
  return (res.messages[0].content as { type: string; text: string }).text;
}

describe("the connector's prompt tests, unchanged", () => {
  // The connector's copy lists three; the package adds setup_memory, so a
  // connector registering these prompts lists four.
  it("lists exactly the four memory prompts, each with a description", async () => {
    const { prompts } = await mcp.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      "recall",
      "save_insight",
      "setup_memory",
      "what_do_you_know",
    ]);
    for (const p of prompts) {
      expect(p.description, `${p.name} needs a description`).toBeTruthy();
    }
  });

  it("recall renders a user message steering to memory_read with the topic", async () => {
    const text = await render("recall", { topic: "graph geometry" });
    expect(text).toContain("graph geometry");
    expect(text).toContain("memory_read");
  });

  it("save_insight includes the insight and domain, steering to memory_write", async () => {
    const text = await render("save_insight", {
      insight: "hyperbolic embeddings fit hierarchies",
      domain: "graph-geo",
    });
    expect(text).toContain("hyperbolic embeddings fit hierarchies");
    expect(text).toContain("graph-geo");
    expect(text).toContain("memory_write");
  });

  it("save_insight omits the domain clause when no domain is given", async () => {
    const text = await render("save_insight", { insight: "remember this" });
    expect(text).toContain("remember this");
    expect(text).not.toContain("under the domain");
  });
});

describe("what this package adds", () => {
  it("what_do_you_know steers to memory_read and asks for gaps", async () => {
    const text = await render("what_do_you_know", { subject: "the billing migration" });
    expect(text).toContain('"the billing migration"');
    expect(text).toContain("memory_read");
    expect(text).toContain("flag gaps");
  });

  it("quotes a domain exactly as given, padding and case included", async () => {
    const text = await render("save_insight", { insight: "x", domain: " XRoom:room_01ABC " });
    expect(text).toContain('under the domain " XRoom:room_01ABC "');
  });

  // Copilot on #148: the domain was pasted between quotes raw, so `say "hi"`
  // closed the quotes early and a newline or zero-width space vanished into
  // the text. It now goes through the same exact-literal contract as every
  // other domain the package names; each case must decode back to its bytes.
  for (const [label, value] of NAMES.filter(([, v]) => v !== "")) {
    it(`save_insight names the domain reproducibly: ${label}`, async () => {
      const text = await render("save_insight", { insight: "x", domain: value });
      const exact = exactLiteral(value)!;
      expect(text).toContain(`under the domain ${exact.literal}:`);
      expect(JSON.parse(exact.literal)).toBe(value);
      // The legend that says how to decode an escape appears exactly when one
      // was needed.
      expect(text.includes(DOMAIN_ESCAPE_LEGEND)).toBe(exact.escaped);
    });
  }

  it("save_insight refuses a domain too long to quote exactly, rather than dropping it", async () => {
    await expect(
      mcp.client.getPrompt({ name: "save_insight", arguments: { insight: "x", domain: "d".repeat(300) } }),
    ).rejects.toThrow(/too long to be quoted exactly/);
  });

  it("trims the topic, as the connector does", async () => {
    const text = await render("recall", { topic: "  graph geometry  " });
    expect(text).toContain('topic: "graph geometry"');
  });

  it.each([
    ["recall", { topic: "   " }],
    ["save_insight", { insight: "" }],
    ["what_do_you_know", { subject: " " }],
  ])("%s refuses a blank argument", async (name, args) => {
    await expect(mcp.client.getPrompt({ name, arguments: args })).rejects.toThrow();
  });

  it("rendering a prompt calls nothing", async () => {
    await render("recall", { topic: "x" });
    await render("save_insight", { insight: "x", domain: "d" });
    await render("what_do_you_know", { subject: "x" });
    await render("setup_memory", {});
    await render("setup_memory", { host: "cursor" });
    expect(mcp.calls).toHaveLength(0);
  });

  it("the server advertises the prompts capability", () => {
    expect(mcp.client.getServerCapabilities()?.prompts).toBeDefined();
  });
});

describe("setup_memory: rules the user places in their own agent", () => {
  it("hands out the rules verbatim, secrets line included", async () => {
    const text = await render("setup_memory", {});
    expect(text).toContain(MEMORY_RULES);
    expect(text).toContain("Never store passwords, API keys, payment data, MFA codes, government IDs, or health records.");
    expect(text).toContain("memory_read");
    expect(text).toContain("memory_write");
    expect(text).toContain("memory_feedback");
  });

  it("without a host, lists every place the rules can go", async () => {
    const text = await render("setup_memory", {});
    for (const line of Object.values(RULES_PLACES)) {
      expect(text).toContain(line);
    }
  });

  it.each([
    ["claude-code", "CLAUDE.md"],
    ["claude-ai", "Instructions for Claude"],
    ["cursor", ".cursor/rules/"],
    ["codex", "AGENTS.md"],
    ["  Cursor ", ".cursor/rules/"],
  ])("host %j names only its own place (%s)", async (host, needle) => {
    const text = await render("setup_memory", { host });
    expect(text).toContain(needle);
    expect(text).not.toContain("Where they go:");
  });

  it.each(["vim", "constructor", "__proto__", "toString"])(
    "an unknown host %j falls back to every place, never to an inherited property",
    async (host) => {
      const text = await render("setup_memory", { host });
      expect(text).toContain("Where they go:");
      expect(text).not.toMatch(/function|\[native code\]|\[object Object\]/);
    },
  );

  it("keeps the measured rule for a fact that arrives together with a task (2026-09-29: W3+W5 saved 4/6 with it, 1/6 without)", () => {
    expect(MEMORY_RULES).toContain("When a message also carries a durable fact");
    expect(MEMORY_RULES).toContain("save that fact with memory_write before doing the rest of the task");
  });

  it("points nowhere outside this server: no URL in the rules or the message", async () => {
    const text = await render("setup_memory", {});
    expect(text).not.toMatch(/https?:\/\//);
  });
});
