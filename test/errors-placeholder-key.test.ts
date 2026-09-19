/**
 * A docs placeholder key never leaves the machine.
 *
 * It gets its own FILE for the same reason test/errors-keyless.test.ts does:
 * `MNEMOVERSE_API_KEY` is read into a module-level constant while
 * src/index.ts evaluates, and the shared harness (test/harness.ts) sets a
 * valid-shaped key before importing it, deliberately, since every other
 * test wants a key that reaches fetch. There is no way to swap that constant
 * afterwards that the already-evaluated module would notice, and vitest gives
 * each test file its own module registry, so a second file is the seam.
 *
 * WHY IT IS WORTH A FILE. The engine sees this server calling it again and
 * again with this exact placeholder. A value this client can recognise as a
 * placeholder WITHOUT any request was still being sent over the network, and
 * the agent kept retrying
 * because the generic 401 sentence gave it nothing that said "stop". This
 * file pins that the refusal happens BEFORE fetch, not merely that the final
 * sentence reads correctly: the same trap test/base-url-guard.test.ts is
 * built around.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/** The exact placeholder named in the incident and shipped in every README
 *  snippet (src/configs/source.json). */
const PLACEHOLDER_KEY = "mk_live_YOUR_KEY";

let client: Client;
let close: () => Promise<void>;

beforeAll(async () => {
  process.env.MNEMOVERSE_MCP_NO_AUTOSTART = "1";
  process.env.MNEMOVERSE_API_URL = "http://127.0.0.1:1/api/v1";
  // The condition under test: a key IS configured, and it is certainly a
  // docs placeholder rather than absent (that is errors-keyless.test.ts) or
  // real-shaped (every other test file).
  process.env.MNEMOVERSE_API_KEY = PLACEHOLDER_KEY;

  const realFetch = globalThis.fetch;
  // Nothing here may reach the network. A placeholder-key call must fail
  // BEFORE fetch: if this throws, that property is broken and the test says
  // which call did it.
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`[placeholder] a placeholder-key call reached the network: ${String(input)}`);
  }) as typeof fetch;

  const { server } = await import("../src/index.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "placeholder-key-harness", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  close = async () => {
    globalThis.fetch = realFetch;
    await client.close();
    await server.close();
  };
});

afterAll(async () => {
  await close();
});

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (Array.isArray(res.content) ? res.content : [])
    .filter(
      (c): c is { type: "text"; text: string } =>
        typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
    )
    .map((c) => c.text)
    .join("\n");
  return { isError: res.isError, text };
}

describe("a docs placeholder key is refused locally", () => {
  it("names the problem, the fix, and the fact that nothing will work until then", async () => {
    const res = await callTool("memory_write", { content: "x" });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("MNEMOVERSE_API_KEY");
    expect(res.text).toContain("https://console.mnemoverse.com/dashboard/keys");
    expect(res.text).toContain("Do not retry");
    expect(res.text.toLowerCase()).toContain("restart");
  });

  it("never echoes the configured value, not even the placeholder itself", async () => {
    const res = await callTool("memory_write", { content: "x" });

    expect(res.text).not.toContain(PLACEHOLDER_KEY);
    // A 12-character prefix would still identify the exact placeholder to
    // anyone grepping logs: the point is that the value never appears at
    // all, not merely that it is not spelled out whole.
    expect(res.text).not.toContain(PLACEHOLDER_KEY.slice(0, 12));
  });

  it("is NOT the no-key sentence and NOT the rejected-key sentence, a placeholder is neither", async () => {
    const res = await callTool("memory_read", { query: "x" });

    expect(res.text).not.toContain("no API key is configured");
    expect(res.text).not.toContain("was rejected");
  });

  it("answers the same way for every tool, without touching the network", async () => {
    for (const [tool, args] of [
      ["memory_read", { query: "x" }],
      ["memory_write", { content: "x" }],
      ["memory_stats", {}],
      ["memory_list_rooms", {}],
      ["vault_list", {}],
    ] as const) {
      const res = await callTool(tool, args);
      expect(res.isError, tool).toBe(true);
      expect(res.text, tool).toContain("MNEMOVERSE_API_KEY");
      // Not the network's fault, and the message must never suggest it is.
      expect(res.text, tool).not.toContain("reached the network");
    }
  });

  it("tools still LIST with a placeholder configured, introspection must stay unblocked", async () => {
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.map((t) => t.name)).toContain("memory_write");
  });
});
