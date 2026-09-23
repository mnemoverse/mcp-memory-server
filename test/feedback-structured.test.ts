/**
 * memory_feedback's structuredContent: a declared outputSchema alongside the
 * unchanged text (S6 of the structured-output plan).
 *
 * Test 2 is a port of the connector's own suite (mnemoverse-mcp-remote/test/
 * mcp-protocol.test.ts, "forwards the live avg_valence and zero coactivation
 * outcome without inventing edges") so the two servers pin the SAME
 * structuredContent shape for the SAME core response. The rest cover where
 * this package's rules differ from a bare pass-through: the RAW-number rule
 * for `avg_valence` (the text keeps `toFixed(2)` and the "-0.00" to "0.00"
 * mapping, `structuredContent` never does), the integer/non-negative guard
 * on `coactivation_edges`, and the count === 0 branch, which this package
 * has and the connector's schema does not distinguish from a genuine miss.
 *
 * Uses the SDK-validated path, the real McpServer through test/harness.ts,
 * not a bare call to the handler: a missing or schema-violating
 * structuredContent shows up here as the SDK's own "Output validation
 * error", the guard test/structured-output.test.ts pins against the
 * installed SDK.
 *
 * REWIRE (decision OD-8, owner, 2026-09-23): the UNKNOWN-count branch is now
 * `isError: true`, so the existing test "a count the service did not send is
 * UNKNOWN, not zero" in test/handlers.test.ts, which used `mcp.callText`
 * (throws on `isError`), is rewired there to `mcp.call` and an `isError`
 * assertion, with the same text expectations. No other existing test in
 * this repository is touched by this slice.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { httpError, startMemoryServer, type Harness } from "./harness.js";

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

/** Route key, so a typo is a compile-adjacent mistake rather than a silent miss. */
const FEEDBACK = "POST /memory/feedback";

describe("memory_feedback: tools/list carries the output schema", () => {
  it("declares updated_count (integer >= 0), avg_valence (number), coactivation_edges (integer >= 0), with only updated_count required", async () => {
    const { tools } = await mcp.client.listTools();
    const feedback = tools.find((t) => t.name === "memory_feedback");
    expect(feedback?.outputSchema).toBeDefined();
    const schema = feedback!.outputSchema as {
      properties?: Record<string, { type?: string; minimum?: number }>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "avg_valence",
      "coactivation_edges",
      "updated_count",
    ]);
    expect(schema.required).toEqual(["updated_count"]);
    expect(schema.properties?.updated_count).toMatchObject({ type: "integer", minimum: 0 });
    expect(schema.properties?.avg_valence).toMatchObject({ type: "number" });
    expect(schema.properties?.coactivation_edges).toMatchObject({ type: "integer", minimum: 0 });
  });
});

describe("memory_feedback: structuredContent, ported from the connector's own suite", () => {
  it("forwards the live avg_valence and zero coactivation outcome without inventing edges", async () => {
    mcp.on(FEEDBACK, { updated_count: 2, avg_valence: 0.35, coactivation_edges: 0 });

    const result = await mcp.call("memory_feedback", {
      memory_ids: ["a", "b"],
      outcome: 1,
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      updated_count: 2,
      avg_valence: 0.35,
      coactivation_edges: 0,
    });
    // The text is unchanged by this slice: still the sentence, not the plain
    // structuredContent values.
    expect(result.text).toContain("The service reports 2 memories updated");
  });
});

describe("memory_feedback: count === 0 carries only updated_count (plus avg_valence when sent)", () => {
  it("{updated_count: 0} alone produces {updated_count: 0} and the unchanged miss text", async () => {
    mcp.on(FEEDBACK, { updated_count: 0 });

    const result = await mcp.call("memory_feedback", {
      memory_ids: ["atom_from_a_room"],
      outcome: 1,
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ updated_count: 0 });
    expect(result.text).toContain("No feedback was recorded");
  });
});

describe("memory_feedback: avg_valence in structuredContent is the RAW number, not the text's rounded display", () => {
  it("-0.001 stays -0.001 in structuredContent while the text says 0.00 (the existing -0.00 mapping)", async () => {
    mcp.on(FEEDBACK, { updated_count: 1, avg_valence: -0.001 });

    const result = await mcp.call("memory_feedback", { memory_ids: ["a"], outcome: 0 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ updated_count: 1, avg_valence: -0.001 });
    expect(result.text).toContain("average valence is now 0.00");
    expect(result.text).not.toContain("-0.00");
  });
});

describe("memory_feedback: the unknown-count reply is now isError, with the unchanged sentence (OD-8)", () => {
  it.each([
    ["the field absent", {}],
    ["a string", { updated_count: "2" }],
    ["a negative", { updated_count: -1 }],
    ["a float", { updated_count: 1.5 }],
  ])("body with %s: isError true, same guidance not to re-send", async (label, reply) => {
    mcp.on(FEEDBACK, reply);

    const result = await mcp.call("memory_feedback", { memory_ids: ["a"], outcome: 1 });

    expect(result.isError, label).toBe(true);
    expect(result.text, label).toContain("did not report how many memories it updated");
    expect(result.text, label).toContain("do not re-send the same rating");
    // No structuredContent for an isError result: there is no honest
    // updated_count to put in it (the SDK exempts isError from requiring one).
    expect(result.structuredContent, label).toBeUndefined();
  });
});

describe("memory_feedback: coactivation_edges is forwarded only when it is a non-negative integer", () => {
  it.each([
    ["1.5 (not an integer)", 1.5],
    ["-1 (negative)", -1],
  ])("%s is absent from structuredContent, and the success text never mentions it", async (label, value) => {
    mcp.on(FEEDBACK, { updated_count: 1, coactivation_edges: value });

    const result = await mcp.call("memory_feedback", { memory_ids: ["a"], outcome: 1 });

    expect(result.isError, label).toBeFalsy();
    expect(result.structuredContent, label).toEqual({ updated_count: 1 });
    expect(result.text, label).not.toContain("coactivation");
  });

  it("a valid non-negative integer (3) is carried, and the text still never mentions it", async () => {
    mcp.on(FEEDBACK, { updated_count: 1, coactivation_edges: 3 });

    const result = await mcp.call("memory_feedback", { memory_ids: ["a"], outcome: 1 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ updated_count: 1, coactivation_edges: 3 });
    expect(result.text).not.toContain("coactivation");
  });
});

describe("memory_feedback: avg_valence in a shape structuredContent cannot hold is absent, not fabricated", () => {
  it("a string value is absent from structuredContent, and the text says nothing about valence", async () => {
    mcp.on(FEEDBACK, { updated_count: 1, avg_valence: "0.4" });

    const result = await mcp.call("memory_feedback", { memory_ids: ["a"], outcome: 1 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ updated_count: 1 });
    expect(result.text).not.toContain("valence");
  });

  it("1e400 in the raw body (Infinity after parsing) is absent from structuredContent, and the text says nothing about valence", async () => {
    // A plain object cannot carry Infinity through JSON.stringify, so the
    // stub answers with the raw body text the way a service would send it
    // (same technique as test/write-structured.test.ts's importance case).
    mcp.on(
      FEEDBACK,
      httpError(200, '{"updated_count":1,"avg_valence":1e400}', {
        "content-type": "application/json",
      }),
    );

    const result = await mcp.call("memory_feedback", { memory_ids: ["a"], outcome: 1 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ updated_count: 1 });
    expect(result.text).not.toContain("valence");
  });
});
