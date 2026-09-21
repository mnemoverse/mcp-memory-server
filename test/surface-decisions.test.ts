/**
 * Three decisions about the shared MCP surface, taken by the owner on
 * 2026-09-21 when the stdio server and the hosted connector were found to
 * answer them opposite ways (ADR-025, mnemoverse-core). Each is pinned here so
 * neither server can drift back on its own.
 *
 *  1. Rating a memory is not destructive. Only deletion is. Feedback moves a
 *     memory's ranking signals; it never alters or erases what was saved.
 *  2. No tool reaches an open world. Every tool works on the user's own
 *     memory and nothing else.
 *  3. The ids a rating takes are `memory_ids`, the name every result already
 *     uses for them. `atom_ids`, the old name, is accepted on its own for one
 *     minor version so a saved prompt or client that still sends it keeps
 *     working; both at once is refused rather than guessed at.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startMemoryServer, type Harness } from "./harness.js";

const FEEDBACK = "POST /memory/feedback";

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

describe("tool annotations", () => {
  it("rating a memory is not a destructive action", async () => {
    const { tools } = await mcp.client.listTools();
    const feedback = tools.find((t) => t.name === "memory_feedback");
    expect(feedback?.annotations?.destructiveHint).toBe(false);
    expect(feedback?.annotations?.readOnlyHint).toBe(false);
  });

  it("no tool reaches an open world", async () => {
    const { tools } = await mcp.client.listTools();
    expect(tools).toHaveLength(10);
    for (const tool of tools) {
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
    }
  });
});

describe("memory_feedback takes memory_ids", () => {
  it("sends memory_ids to the engine under the engine's own field name", async () => {
    mcp.on(FEEDBACK, { updated_count: 2 });
    const text = await mcp.callText("memory_feedback", { memory_ids: ["a", "b"], outcome: 1 });
    expect(mcp.requestTo(FEEDBACK).body).toEqual({ atom_ids: ["a", "b"], outcome: 1 });
    expect(text).toContain("The service reports 2 memories updated");
  });

  it("still accepts atom_ids, the pre-0.11 name, on its own", async () => {
    mcp.on(FEEDBACK, { updated_count: 1 });
    await mcp.callText("memory_feedback", { atom_ids: ["a"], outcome: -1 });
    expect(mcp.requestTo(FEEDBACK).body).toEqual({ atom_ids: ["a"], outcome: -1 });
  });

  it("refuses both names at once and sends nothing", async () => {
    const res = await mcp.call("memory_feedback", {
      memory_ids: ["a"],
      atom_ids: ["b"],
      outcome: 1,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("memory_ids");
    expect(res.text).toContain("Nothing was rated");
    expect(mcp.calls).toHaveLength(0);
  });

  it("refuses a call with no ids and sends nothing", async () => {
    const res = await mcp.call("memory_feedback", { outcome: 1 });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("memory_ids");
    expect(mcp.calls).toHaveLength(0);
  });

  it("advertises memory_ids, and marks atom_ids as the deprecated name", async () => {
    const { tools } = await mcp.client.listTools();
    const schema = tools.find((t) => t.name === "memory_feedback")?.inputSchema as {
      properties: Record<string, { description?: string }>;
      required?: string[];
    };
    expect(schema.properties).toHaveProperty("memory_ids");
    expect(schema.properties.atom_ids?.description).toMatch(/deprecated/i);
    expect(schema.required ?? []).toContain("outcome");
  });
});
