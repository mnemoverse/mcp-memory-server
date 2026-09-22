/**
 * Pins four facts about `structuredContent` against the INSTALLED SDK
 * (@modelcontextprotocol/sdk, `validateToolOutput` in
 * node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:185-207),
 * the exact behaviour `structured()` (src/tools.ts) exists to satisfy. If a
 * future SDK bump relaxes this validation, these four break instead of the
 * change passing unnoticed, and every later slice that adopts
 * `structured()` loses its guard silently.
 *
 * Boots a bare McpServer over the SDK's in-memory transport (pattern:
 * test/shared-entry.test.ts) with one probe tool that declares an
 * outputSchema. No memory tool is involved: this is a test of the SDK, not
 * of this package's tools.
 */

import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { structured } from "../src/tools.js";

/** Connects a fresh client/server pair with one "probe" tool whose handler is
 *  supplied per test, so each test controls exactly what the SDK validates. */
async function connectProbe(handler: () => CallToolResult | Promise<CallToolResult>) {
  const server = new McpServer({ name: "structured-output-test", version: "0.0.0" });
  server.registerTool(
    "probe",
    {
      description: "test-only probe tool with an output schema",
      outputSchema: { ok: z.boolean() },
    },
    handler,
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "structured-output-test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function textOf(content: unknown): string {
  const first = Array.isArray(content) ? content[0] : undefined;
  return typeof first?.text === "string" ? first.text : "";
}

describe("the SDK's structured-content rule, pinned against the installed SDK", () => {
  it("(a) rejects a text-only non-error result from a tool with an outputSchema", async () => {
    const { client, server } = await connectProbe(() => ({
      content: [{ type: "text", text: "no structured content here" }],
    }));
    const res = await client.callTool({ name: "probe", arguments: {} });
    expect(res.isError).toBe(true);
    const text = textOf(res.content);
    expect(text).toContain("Output validation error");
    expect(text).toContain("has an output schema but no structured content was provided");
    await server.close();
  });

  it("(b) passes an isError text-only result through untouched", async () => {
    const { client, server } = await connectProbe(() => ({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    }));
    const res = await client.callTool({ name: "probe", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res.content)).toBe("boom");
    await server.close();
  });

  it("(c) passes the helper's output through with structuredContent intact when it matches the schema", async () => {
    const { client, server } = await connectProbe(() => structured("ok", { ok: true }));
    const res = await client.callTool({ name: "probe", arguments: {} });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toEqual({ ok: true });
    await server.close();
  });

  it("(d) rejects the helper's output when it violates the schema", async () => {
    const { client, server } = await connectProbe(() => structured("bad", { ok: "not-a-boolean" }));
    const res = await client.callTool({ name: "probe", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res.content)).toContain("Invalid structured content");
    await server.close();
  });
});

describe("structured()", () => {
  it("returns exactly a text block and structuredContent, and nothing else", () => {
    const result = structured("hello", { a: 1 });
    expect(result).toEqual({
      content: [{ type: "text", text: "hello" }],
      structuredContent: { a: 1 },
    });
  });
});
