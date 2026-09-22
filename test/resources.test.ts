/**
 * MCP resource `memory://item/{memory_id}` (0.11, step 3c).
 *
 * Moved from the hosted connector. The first three tests mirror its own
 * (mnemoverse-mcp-remote test/mcp-protocol.test.ts, "MCP resources (browsable
 * memory)"): the template is advertised, a read returns only memory_id,
 * content and domain, and a non-retryable 429 keeps the engine's sentence
 * without invented retry advice. The rest pin what this package adds: a 404
 * carries MCP's resource-not-found code, the id is encoded into the path, the
 * description says a room memory cannot be opened, and reading makes exactly
 * one request.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { httpError, noContent, startMemoryServer, type Harness } from "./harness.js";

const ID = "3f9c2a1e-7b4d-4c8e-9a1f-2d3e4f5a6b7c";
const GET_ATOM = `GET /memory/atoms/${ID}`;

const envelope = (code: string, message: string, retryable: boolean): string =>
  JSON.stringify({ code, message, requestId: "req_01", retryable, details: null });

const ATOM = {
  id: ID,
  content: "hyperbolic embeddings fit hierarchies",
  concepts: ["geometry"],
  atom_type: "singleton",
  created_at: "2026-01-01T00:00:00Z",
  last_accessed_at: "2026-01-01T00:00:00Z",
  access_count: 3,
  importance: 0.9,
  valence: 0.5,
  outcome_count: 1,
  is_protected: false,
  domain: "graph-geo",
  external_ref: null,
  metadata: { source: "x" },
};

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

describe("the connector's resource tests", () => {
  it("advertises the memory://item/{memory_id} resource template", async () => {
    const { resourceTemplates } = await mcp.client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("memory://item/{memory_id}");
  });

  it("reads one memory by id and returns only memory_id, content and domain", async () => {
    mcp.on(GET_ATOM, ATOM);
    const res = await mcp.client.readResource({ uri: `memory://item/${ID}` });
    expect(res.contents).toHaveLength(1);
    expect(res.contents[0].mimeType).toBe("application/json");
    expect(res.contents[0].uri).toBe(`memory://item/${ID}`);
    const memory = JSON.parse((res.contents[0] as { text: string }).text);
    expect(memory).toEqual({
      memory_id: ID,
      content: "hyperbolic embeddings fit hierarchies",
      domain: "graph-geo",
    });
  });

  it("keeps a non-retryable 429's own sentence and invents no retry advice", async () => {
    const quota = "Monthly write quota reached for this plan.";
    mcp.on(GET_ATOM, httpError(429, envelope("RATE_LIMITED", quota, false)));
    const err = await mcp.client.readResource({ uri: `memory://item/${ID}` }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain(quota);
    expect(message).not.toMatch(/try again|retry with backoff/i);
  });
});

describe("what this package adds", () => {
  it("answers a 404 with MCP's resource-not-found code and the engine's detail", async () => {
    mcp.on(GET_ATOM, httpError(404, envelope("NOT_FOUND", `Atom ${ID} not found`, false)));
    const err = (await mcp.client
      .readResource({ uri: `memory://item/${ID}` })
      .catch((e: unknown) => e)) as { code?: number; message: string };
    expect(err.code).toBe(-32002);
    expect(err.message).toContain(`Atom ${ID} not found`);
  });

  it("answers any other failure as an internal error", async () => {
    mcp.on(GET_ATOM, httpError(500, envelope("INTERNAL", "boom", true)));
    const err = (await mcp.client
      .readResource({ uri: `memory://item/${ID}` })
      .catch((e: unknown) => e)) as { code?: number };
    expect(err.code).toBe(-32603);
  });

  it("encodes the id into the path once, so it cannot reach another route", async () => {
    // The URI carries "../stats" percent-encoded. It is decoded once and
    // encoded once for the path: one segment, never a walk up to /memory/stats,
    // and never double-encoded to %252F.
    mcp.on("GET /memory/atoms/..%2Fstats", ATOM);
    await mcp.client.readResource({ uri: "memory://item/..%2Fstats" });
    expect(mcp.calls.map((c) => c.path)).toEqual(["/memory/atoms/..%2Fstats"]);
  });

  it("keeps a malformed escape as sent, still encoded for the path", async () => {
    mcp.on("GET /memory/atoms/bad%25zz", httpError(422, envelope("VALIDATION_ERROR", "not a UUID", false)));
    const err = await mcp.client.readResource({ uri: "memory://item/bad%zz" }).catch((e: unknown) => e);
    expect(mcp.calls.map((c) => c.path)).toEqual(["/memory/atoms/bad%25zz"]);
    expect((err as Error).message).toContain("not a UUID");
  });

  it("says a memory from a shared room cannot be opened by id", async () => {
    const { resourceTemplates } = await mcp.client.listResourceTemplates();
    const t = resourceTemplates.find((r) => r.uriTemplate === "memory://item/{memory_id}");
    expect(t?.description).toContain("a memory read from a shared room cannot be opened by ID");
  });

  // Copilot on #149: an empty 204 (apiFetch returns {}) or any body that is not
  // a memory used to come back as {"memory_id": "<the id asked for>"}, a
  // resource made up from the request. It is an error now, in the words the
  // tools use for an unreadable answer.
  it.each([
    ["an empty 204", noContent()],
    ["a body without content", { id: ID, domain: "graph-geo" }],
    ["a body without domain", { id: ID, content: "x" }],
    ["a non-string content", { id: ID, content: 42, domain: "graph-geo" }],
    ["a JSON array", [ATOM]],
  ])("does not pass off %s as a memory", async (_, reply) => {
    mcp.on(GET_ATOM, reply);
    const err = (await mcp.client
      .readResource({ uri: `memory://item/${ID}` })
      .catch((e: unknown) => e)) as { code?: number; message: string; isError?: unknown };
    expect(err.code).toBe(-32603);
    expect(err.message).toContain("The memory came back in a shape this client does not recognise");
    expect(err.message).toContain("not evidence that it is empty or gone");
    // The deliberate asymmetry (S2): the five tools' same unreadable-body
    // sentence now comes back as `isError: true` on a RESOLVED call, because a
    // declared outputSchema leaves them no honest structuredContent to pair
    // with a text-only success. A resource has no outputSchema and no
    // structuredContent to withhold, so nothing forces that change here. This
    // read still fails the JSON-RPC call itself (an McpError), never a
    // resolved result carrying `isError`.
    expect(err.isError).toBeUndefined();
  });

  it("falls back to the requested id only when the engine omits its own", async () => {
    mcp.on(GET_ATOM, { content: "c", domain: "d" });
    const res = await mcp.client.readResource({ uri: `memory://item/${ID}` });
    expect(JSON.parse((res.contents[0] as { text: string }).text)).toEqual({
      memory_id: ID,
      content: "c",
      domain: "d",
    });
  });

  it("reading one memory makes exactly one request", async () => {
    mcp.on(GET_ATOM, ATOM);
    await mcp.client.readResource({ uri: `memory://item/${ID}` });
    expect(mcp.calls.map((c) => c.key)).toEqual([GET_ATOM]);
  });
});
