/**
 * MCP prompts (0.11, step 3c): recall, save_insight, what_do_you_know.
 *
 * Moved from the hosted connector. The first four tests are its own
 * (mnemoverse-mcp-remote test/mcp-protocol.test.ts, "MCP prompts (memory
 * rituals)"), so the two servers answer the same once the connector registers
 * these; the rest pin what this package adds: the prompts reach a client of
 * the stdio server, a domain is quoted exactly as given, a blank argument is
 * refused, and rendering a prompt calls nothing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  it("lists exactly the three memory prompts, each with a description", async () => {
    const { prompts } = await mcp.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["recall", "save_insight", "what_do_you_know"]);
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
    expect(mcp.calls).toHaveLength(0);
  });

  it("the server advertises the prompts capability", () => {
    expect(mcp.client.getServerCapabilities()?.prompts).toBeDefined();
  });
});
