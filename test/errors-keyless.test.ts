/**
 * The one failure that needs no request to diagnose: no key configured at all.
 *
 * It gets its own FILE because it needs its own SERVER. `MNEMOVERSE_API_KEY` is
 * read into a module-level constant while src/index.ts evaluates, and the shared
 * harness sets a valid-looking key before importing it — deliberately, since
 * every other test wants a key. There is no way to unset it afterwards that the
 * already-evaluated module would notice, and vitest gives each test file its own
 * module registry, so a second file is the seam.
 *
 * WHY IT IS WORTH A FILE. This is the FIRST message a new user's agent hits —
 * install the server, forget the key, call a tool. It ran untested through every
 * release so far, and it was the sentence most likely to be reworded by someone
 * tidying up the neighbouring 401. It is also the one place where the fix is
 * "set the variable" rather than "replace its value", which is why it is not
 * simply the 401 sentence reused.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let client: Client;
let close: () => Promise<void>;

beforeAll(async () => {
  process.env.MNEMOVERSE_MCP_NO_AUTOSTART = "1";
  process.env.MNEMOVERSE_API_URL = "http://127.0.0.1:1/api/v1";
  // The condition under test. `delete` rather than "": src/index.ts falls back
  // to "" itself, and a user who never set the variable is the case this covers.
  delete process.env.MNEMOVERSE_API_KEY;

  const realFetch = globalThis.fetch;
  // Nothing here may reach the network. A keyless call must fail BEFORE fetch —
  // if this throws, that property is broken and the test says which call did it.
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`[keyless] a keyless call reached the network: ${String(input)}`);
  }) as typeof fetch;

  const { server } = await import("../src/index.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "keyless-harness", version: "0.0.0" });
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

describe("no key configured at all", () => {
  it("names the variable, the fix, and the fact that nothing will work until then", async () => {
    const res = await callTool("memory_write", { content: "x" });

    expect(res.isError).toBe(true);
    expect(res.text).toBe(
      "Mnemoverse: no API key is configured, so this tool cannot run. Tell the " +
        "user to set MNEMOVERSE_API_KEY in their MCP client config — a free key " +
        "takes about 30 seconds at https://console.mnemoverse.com/dashboard/keys " +
        "and starts with mk_live_. Do not retry until it is set; every memory " +
        "tool will fail the same way until then.",
    );
  });

  it("is NOT the rejected-key sentence — an unset variable is not an invalid one", async () => {
    // The distinction is the user's next action: create a key and set it,
    // versus replace a value they already believe in. Collapsing the two would
    // send someone hunting for a typo in a variable that does not exist.
    const res = await callTool("memory_read", { query: "x" });

    expect(res.text).toContain("no API key is configured");
    expect(res.text).not.toContain("was rejected");
    expect(res.text).not.toContain("mk_live_YOUR_KEY");
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
      expect(res.text, tool).toContain("no API key is configured");
      // Not the network's fault, and the message must never suggest it is.
      expect(res.text, tool).not.toContain("reached the network");
    }
  });

  it("tools still LIST without a key — introspection must stay key-free", async () => {
    // The documented reason the key is validated lazily rather than at startup:
    // registries boot the server to enumerate its tools. A keyless failure that
    // moved earlier would break that, and this file is where it would show.
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.map((t) => t.name)).toContain("memory_write");
  });
});
