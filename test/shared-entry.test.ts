/**
 * The shared entry point: what mnemoverse-mcp-remote imports (ADR-025).
 *
 * Three properties another server relies on, each pinned here:
 *  - the ten tools register on a server this package did not create;
 *  - they reach the API only through the injected `apiFetch` (never through
 *    this package's own environment-based client);
 *  - importing the entry starts nothing: it does not pull in src/index.ts,
 *    whose import has the side effect of opening a stdio transport.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerMemoryTools, SERVER_INSTRUCTIONS, type ApiFetch } from "../src/shared.js";

const TEN_TOOLS = [
  "memory_create_room",
  "memory_feedback",
  "memory_invite_to_room",
  "memory_join_room",
  "memory_list_recent",
  "memory_list_rooms",
  "memory_read",
  "memory_stats",
  "memory_write",
  "vault_list",
];

async function connect(apiFetch: ApiFetch) {
  const server = new McpServer(
    { name: "shared-entry-test", version: "0.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerMemoryTools(server, { apiFetch });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "shared-entry-test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("the shared entry point", () => {
  it("registers the ten memory tools on a server it did not create", async () => {
    const { client, server } = await connect(async () => {
      throw new Error("listing tools must not call the API");
    });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TEN_TOOLS);
    await server.close();
  });

  it("reaches the API only through the injected apiFetch", async () => {
    const calls: string[] = [];
    const apiFetch: ApiFetch = async <T>(path: string) => {
      calls.push(path);
      return {
        total_atoms: 3,
        episodes: 3,
        prototypes: 0,
        hebbian_edges: 0,
        domains: ["general"],
        avg_valence: 0,
        avg_importance: 0.5,
      } as T;
    };
    const { client, server } = await connect(apiFetch);
    const result = await client.callTool({ name: "memory_stats", arguments: {} });
    expect(calls).toEqual(["/memory/stats"]);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("3");
    await server.close();
  });

  it("starts nothing on import: neither the entry nor the tools import src/index.ts", () => {
    // A "never" that no call can observe, so it is checked on the source. The
    // main entry opens a stdio transport when imported without
    // MNEMOVERSE_MCP_NO_AUTOSTART, which inside another server would attach
    // this package to that process's stdin and stdout.
    for (const file of ["../src/shared.ts", "../src/tools.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, `${file} imports the stdio entry`).not.toMatch(/from\s+["']\.\/index(\.js)?["']/);
    }
  });
});
