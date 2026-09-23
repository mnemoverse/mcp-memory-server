/**
 * memory_stats's structuredContent: a declared outputSchema alongside the
 * unchanged text (S7 of the structured-output plan).
 *
 * The two required fields, `memory_count` and `domains`, are copied from the
 * connector's own `memoryStatsOutput` (mnemoverse-mcp-remote, src/tools/
 * index.ts) under the connector's naming, not core's (`total_atoms`),
 * decision Q3, owner, 2026-09-23. The other five fields (`episodes`,
 * `prototypes`, `hebbian_edges`, `avg_valence`, `avg_importance`) are this
 * package's own addition: the rest of what this tool's text already reports,
 * each optional and present only when core sent a usable number for it.
 *
 * Uses the SDK-validated path, the real McpServer through test/harness.ts,
 * not a bare call to the handler: a missing or schema-violating
 * structuredContent shows up here as the SDK's own "Output validation
 * error", the guard test/structured-output.test.ts pins against the
 * installed SDK.
 *
 * REWIRE: no existing test in this repository needed a rewire for this
 * slice. Every `mcp.on(STATS, …)` fixture already in test/handlers.test.ts
 * sends a valid `total_atoms` (a non-negative safe integer) and an ARRAY
 * `domains`, so the new required-field guard below never fires on them; that
 * was checked by running the unmodified suite (776 tests) both before and
 * after this slice's handler change, with no rewrite in either file.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
const STATS = "GET /memory/stats";

describe("memory_stats: tools/list carries the output schema", () => {
  it("declares the seven fields, memory_count and domains required, the rest optional", async () => {
    const { tools } = await mcp.client.listTools();
    const stats = tools.find((t) => t.name === "memory_stats");
    expect(stats?.outputSchema).toBeDefined();
    const schema = stats!.outputSchema as {
      properties?: Record<string, { type?: string; minimum?: number; items?: { type?: string } }>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "avg_importance",
      "avg_valence",
      "domains",
      "episodes",
      "hebbian_edges",
      "memory_count",
      "prototypes",
    ]);
    expect(schema.required).toEqual(["memory_count", "domains"]);
    expect(schema.properties?.memory_count).toMatchObject({ type: "integer", minimum: 0 });
    expect(schema.properties?.domains).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
  });
});

describe("memory_stats: a full body carries all seven fields, text unchanged", () => {
  it("structuredContent equals the seven fields under the connector's naming", async () => {
    mcp.on(STATS, {
      total_atoms: 3740,
      episodes: 3729,
      prototypes: 0,
      hebbian_edges: 72049,
      domains: ["a", "b"],
      avg_valence: 0.12,
      avg_importance: 0.4,
    });

    const result = await mcp.call("memory_stats");

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      memory_count: 3740,
      domains: ["a", "b"],
      episodes: 3729,
      prototypes: 0,
      hebbian_edges: 72049,
      avg_valence: 0.12,
      avg_importance: 0.4,
    });
    // The text is unchanged by this slice: still the sentence, not the plain
    // structuredContent values.
    expect(result.text).toContain("Memories: 3740 (3729 episodes, 0 prototypes)");
    expect(result.text).toContain("Associations: 72049 Hebbian edges");
    expect(result.text).toContain('Domains: "a", "b"');
    expect(result.text).toContain("Avg quality: valence 0.12 (how well recalls turned out, -1..1), importance 0.40 (0..1)");
  });
});

describe("memory_stats: a minimal usable body carries only the two required fields", () => {
  it("{total_atoms: 3, domains: []} produces exactly {memory_count: 3, domains: []}, text unchanged", async () => {
    mcp.on(STATS, { total_atoms: 3, domains: [] });

    const result = await mcp.call("memory_stats");

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ memory_count: 3, domains: [] });
    // Same wording as the pre-existing "distinguishes unknown from zero" case
    // in test/handlers.test.ts: this slice does not touch the text path for
    // a body that already carries a usable total_atoms and an array domains.
    expect(result.text).toContain("Memories: 3 (unknown episodes, unknown prototypes)");
    expect(result.text).toContain("Domains: none reported");
  });
});

describe("memory_stats: a non-string domain element is filtered, not silently (S7-1)", () => {
  it('["a", 5, null, "b"] keeps ["a", "b"] in structuredContent, the text still counts 2 not shown, and stderr gets one diagnostic line naming 2', async () => {
    mcp.on(STATS, { total_atoms: 4, domains: ["a", 5, null, "b"] });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await mcp.call("memory_stats");

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        memory_count: 4,
        domains: ["a", "b"],
      });
      // formatDomainList's existing wording (src/names.ts): unchanged by this
      // slice, still counts every element exactLiteral cannot print, which
      // includes the two non-string entries.
      expect(result.text).toContain("(+2 names not shown — cannot be printed exactly)");

      expect(spy).toHaveBeenCalledTimes(1);
      const line = spy.mock.calls[0]!.join(" ");
      expect(line).toContain("2");
      expect(line).toContain("structuredContent.domains");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("memory_stats: S7-2, an all-non-string domains array yields an empty structured list, no extra branch", () => {
  it("[1, 2] produces domains: [] in structuredContent; the text still says (+2 names not shown)", async () => {
    mcp.on(STATS, { total_atoms: 2, domains: [1, 2] });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await mcp.call("memory_stats");

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ memory_count: 2, domains: [] });
      expect(result.text).toContain("(+2 names not shown — cannot be printed exactly)");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("memory_stats: required-field guard, a body without a usable memory_count or an array domains is isError", () => {
  it.each([
    ["total_atoms missing", { domains: [] }],
    ["total_atoms a string", { total_atoms: "3", domains: [] }],
    ["total_atoms negative", { total_atoms: -1, domains: [] }],
    ["total_atoms a float", { total_atoms: 1.5, domains: [] }],
    [
      "total_atoms above 2^53 - 1, which the schema's int() rejects",
      { total_atoms: 9007199254740992, domains: [] },
    ],
    ["domains missing", { total_atoms: 3 }],
    ["domains a string", { total_atoms: 3, domains: "engineering" }],
  ])("body with %s: isError true, the unreadable-answer sentence", async (label, reply) => {
    mcp.on(STATS, reply);

    const result = await mcp.call("memory_stats");

    expect(result.isError, label).toBe(true);
    expect(result.text, label).toContain(
      "The stats answer came back in a shape this client does not recognise",
    );
    expect(result.text, label).toContain("not the memory store's statistics");
    expect(result.text, label).toContain("not evidence that the store is empty");
    // No structuredContent for an isError result: there is no honest
    // memory_count/domains pair to put in it (the SDK exempts isError from
    // requiring one).
    expect(result.structuredContent, label).toBeUndefined();
  });
});

describe("memory_stats: malformed optional numbers are absent from structuredContent, and the text is unchanged", () => {
  it("episodes: 1.5 and hebbian_edges: 2^53 are absent from structuredContent; the text still prints what num() prints for them", async () => {
    mcp.on(STATS, {
      total_atoms: 5,
      domains: ["x"],
      episodes: 1.5,
      hebbian_edges: 9007199254740992,
    });

    const result = await mcp.call("memory_stats");

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ memory_count: 5, domains: ["x"] });
    // num() is typeof-only: 1.5 and 2^53 are both `typeof === "number"`, so
    // the text keeps printing them verbatim, the divergence this slice
    // discloses in the CHANGELOG.
    expect(result.text).toContain("1.5 episodes");
    expect(result.text).toContain("Associations: 9007199254740992 Hebbian edges");
  });

  it('avg_importance: "0.4" (a string) is absent from structuredContent; the text says "importance unknown"', async () => {
    mcp.on(STATS, { total_atoms: 5, domains: ["x"], avg_importance: "0.4" });

    const result = await mcp.call("memory_stats");

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ memory_count: 5, domains: ["x"] });
    expect(result.text).toContain("importance unknown");
  });

  it("avg_valence: 1e400 (Infinity after parsing, raw body) is absent from structuredContent; dec() still prints it as Infinity in the text", async () => {
    // A plain object cannot carry Infinity through JSON.stringify, so the
    // stub answers with the raw body text the way a service would send it
    // (same technique as test/feedback-structured.test.ts's valence case).
    mcp.on(
      STATS,
      httpError(200, '{"total_atoms":5,"domains":["x"],"avg_valence":1e400}', {
        "content-type": "application/json",
      }),
    );

    const result = await mcp.call("memory_stats");

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ memory_count: 5, domains: ["x"] });
    // dec() is `typeof v === "number" ? v.toFixed(2) : "unknown"`, and
    // Infinity is typeof "number": (Infinity).toFixed(2) is the string
    // "Infinity", so the text prints it while structuredContent (isFinite)
    // correctly omits it, a second text/data divergence, also disclosed.
    expect(result.text).toContain("valence Infinity");
  });
});

describe("memory_stats: structuredContent is not capped, the 4000-domains fixture (OD-11)", () => {
  // Same fixture construction as "memory_stats fits the result cap without
  // losing its tail" in test/handlers.test.ts.
  const many = Array.from(
    { length: 4000 },
    (_, i) => `team-${String(i).padStart(4, "0")}-engineering`,
  );

  it("structuredContent.domains carries all 4000 names while the text stays capped", async () => {
    mcp.on(STATS, { total_atoms: 1, domains: many });

    const result = await mcp.call("memory_stats");

    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as { memory_count: number; domains: string[] };
    expect(data.memory_count).toBe(1);
    expect(data.domains).toHaveLength(4000);
    expect(data.domains).toEqual(many);
    // The text stays bounded: the last name is still cut from the line, as
    // the existing handlers.test.ts case for this fixture asserts.
    expect(result.text).not.toContain('"team-3999-engineering"');
    expect(result.text).toMatch(/\(\+\d+ more names not shown/);
  });
});
