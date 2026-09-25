/**
 * memory_graph — the eleventh tool, wrapping the live `POST /memory/graph`
 * (core's `GraphRequestSchema`/`GraphResponseSchema`,
 * https://core.mnemoverse.com/openapi.json).
 *
 * Covers, in the style of test/limits.test.ts (schema-bound rejection),
 * test/feedback-structured.test.ts (structuredContent shape) and
 * test/tool-wiring.test.ts (a parameter reaching the wire): the input
 * bounds are refused before the request goes out, a happy path against
 * core's own documented example payload renders and structures correctly,
 * and `domain` reaches the request body unchanged. The eleven-tool roster
 * itself is pinned in test/surface-decisions.test.ts, test/handlers.test.ts
 * and test/shared-entry.test.ts, not repeated here.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startMemoryServer, type Harness } from "./harness.js";

const GRAPH = "POST /memory/graph";

let mcp: Harness;
beforeAll(async () => {
  mcp = await startMemoryServer();
});
afterAll(async () => {
  await mcp.close();
});
beforeEach(() => {
  mcp.reset();
});

describe("memory_graph: input is refused here, before the request, out of bounds", () => {
  it.each([
    ["0 seeds", { seeds: [] }],
    ["21 seeds", { seeds: Array(21).fill("c") }],
    ["a blank seed", { seeds: ["  "] }],
    ["a seed over 200 chars", { seeds: ["c".repeat(201)] }],
    ["depth 0", { seeds: ["c"], depth: 0 }],
    ["depth 4", { seeds: ["c"], depth: 4 }],
    ["limit 501", { seeds: ["c"], limit: 501 }],
    ["min_weight -1", { seeds: ["c"], min_weight: -1 }],
  ])("%s", async (label, args) => {
    const res = await mcp.call("memory_graph", args as Record<string, unknown>);
    expect(res.isError, label).toBe(true);
    expect(mcp.calls, label).toHaveLength(0);
  });
});

describe("memory_graph: tools/list carries the output schema", () => {
  it("declares nodes/edges/truncated/min_weight_applied, all required", async () => {
    const { tools } = await mcp.client.listTools();
    const tool = tools.find((t) => t.name === "memory_graph");
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(tool?.outputSchema).toBeDefined();
    const schema = tool!.outputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "edges",
      "min_weight_applied",
      "nodes",
      "truncated",
    ]);
    expect(schema.required?.sort()).toEqual([
      "edges",
      "min_weight_applied",
      "nodes",
      "truncated",
    ]);
  });
});

/** core's own documented example for GraphResponseSchema (openapi.json). */
const LIVE_EXAMPLE = {
  edges: [
    {
      count: 3,
      source: "rotation",
      target: "symmetry",
      updated_at: "2026-09-24T00:00:00Z",
      valence: 0.1,
      weight: 0.8,
    },
  ],
  min_weight_applied: 0,
  nodes: [
    { concept: "rotation", degree: 1 },
    { concept: "symmetry", degree: 1 },
  ],
  truncated: false,
};

describe("memory_graph: happy path against core's own documented example", () => {
  it("structuredContent matches the outputSchema shape and carries the response exactly", async () => {
    mcp.on(GRAPH, LIVE_EXAMPLE);

    const result = await mcp.call("memory_graph", { seeds: ["rotation", "symmetry"] });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(LIVE_EXAMPLE);
  });

  it("renders the edge, sorted, with weight/valence/count and no truncation/floor note", async () => {
    mcp.on(GRAPH, LIVE_EXAMPLE);

    const result = await mcp.call("memory_graph", { seeds: ["rotation", "symmetry"] });

    expect(result.text).toContain("1 association edge found:");
    expect(result.text).toContain(
      "1. rotation — symmetry (weight: 0.80, valence: 0.10, count: 3)",
    );
    expect(result.text).not.toContain("truncated");
    expect(result.text).not.toContain("excluded");
  });

  it("sends the default depth/limit and no min_weight when the caller passes neither", async () => {
    mcp.on(GRAPH, LIVE_EXAMPLE);
    await mcp.call("memory_graph", { seeds: ["rotation"] });

    expect(mcp.requestTo(GRAPH).body).toEqual({
      seeds: ["rotation"],
      depth: 1,
      domain: undefined,
      limit: 100,
    });
  });

  it("a truncated, floored response adds both notes to the text", async () => {
    mcp.on(GRAPH, {
      ...LIVE_EXAMPLE,
      truncated: true,
      min_weight_applied: 0.05,
    });

    const result = await mcp.call("memory_graph", { seeds: ["rotation"], depth: 2 });

    expect(result.text).toContain("(weight ≥ 0.05)");
    expect(result.text).toContain("truncated");
    expect(result.text).toContain("the engine's own floor at this depth");
  });

  it("a floored response says 'the min_weight you passed' when the caller set one explicitly", async () => {
    mcp.on(GRAPH, { ...LIVE_EXAMPLE, min_weight_applied: 0.3 });

    const result = await mcp.call("memory_graph", { seeds: ["rotation"], min_weight: 0.3 });

    expect(result.text).toContain("the min_weight you passed");
  });

  it("no edges: an honest miss, not an unreadable-answer error", async () => {
    mcp.on(GRAPH, { nodes: [], edges: [], truncated: false, min_weight_applied: 0 });

    const result = await mcp.call("memory_graph", { seeds: ["nope"] });

    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("No association edges found for this seed within 1 hop.");
    expect(result.structuredContent).toEqual({
      nodes: [],
      edges: [],
      truncated: false,
      min_weight_applied: 0,
    });
  });
});

describe("memory_graph: domain reaches the wire unchanged", () => {
  it("passes a room address through, byte for byte", async () => {
    mcp.on(GRAPH, LIVE_EXAMPLE);

    await mcp.call("memory_graph", { seeds: ["rotation"], domain: "xroom:room_01ABC" });

    expect(mcp.requestTo(GRAPH).body).toMatchObject({ domain: "xroom:room_01ABC" });
  });

  it("omits domain from the body when the caller passes none", async () => {
    mcp.on(GRAPH, LIVE_EXAMPLE);

    await mcp.call("memory_graph", { seeds: ["rotation"] });

    const body = mcp.requestTo(GRAPH).body as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, "domain")).toBe(false);
  });
});

describe("memory_graph: an unreadable 2xx is isError, not a fabricated or partial graph", () => {
  it.each([
    ["edges missing", { nodes: [], truncated: false, min_weight_applied: 0 }],
    ["nodes missing", { edges: [], truncated: false, min_weight_applied: 0 }],
    ["truncated missing", { nodes: [], edges: [], min_weight_applied: 0 }],
    ["min_weight_applied missing", { nodes: [], edges: [], truncated: false }],
    [
      "an edge missing updated_at",
      {
        nodes: [{ concept: "a", degree: 1 }],
        edges: [{ source: "a", target: "b", weight: 0.5, valence: 0, count: 1 }],
        truncated: false,
        min_weight_applied: 0,
      },
    ],
  ])("%s", async (label, reply) => {
    mcp.on(GRAPH, reply);
    const res = await mcp.call("memory_graph", { seeds: ["a"] });
    expect(res.isError, label).toBe(true);
    expect(res.text, label).toContain("shape this client does not recognise");
    expect(res.structuredContent, label).toBeUndefined();
  });
});
