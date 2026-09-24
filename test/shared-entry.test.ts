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
import {
  capResult,
  MAX_RESULT_CHARS,
  registerMemoryPrompts,
  registerMemoryResources,
  registerMemoryTools,
  SERVER_INSTRUCTIONS,
  type ApiFetch,
} from "../src/shared.js";

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

  it("registers the three prompts on a server it did not create (0.11)", async () => {
    const server = new McpServer({ name: "shared-entry-prompts", version: "0.0.0" });
    registerMemoryPrompts(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "shared-entry-prompts-client", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["recall", "save_insight", "what_do_you_know"]);
    await server.close();
  });

  it("registers the memory resource on a server it did not create, reading through apiFetch (0.11)", async () => {
    const calls: string[] = [];
    const apiFetch: ApiFetch = async <T>(path: string) => {
      calls.push(path);
      return { id: "m1", content: "c", domain: "d", importance: 0.9 } as T;
    };
    const server = new McpServer({ name: "shared-entry-resources", version: "0.0.0" });
    registerMemoryResources(server, { apiFetch });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "shared-entry-resources-client", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const res = await client.readResource({ uri: "memory://item/m1" });
    expect(calls).toEqual(["/memory/atoms/m1"]);
    expect(JSON.parse((res.contents[0] as { text: string }).text)).toEqual({ memory_id: "m1", content: "c", domain: "d" });
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

  it("adding an exports map narrows nothing that resolved before", () => {
    // Until 0.11 the package had no "exports" field, so every file under dist/
    // was importable by path. An exports map without a dist/* passthrough would
    // turn `@mnemoverse/mcp-memory-server/dist/errors.js` into
    // ERR_PACKAGE_PATH_NOT_EXPORTED for anyone who used it: a breaking change
    // hidden in a refactor (review finding on #144). The map is additive only.
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      exports: Record<string, unknown>;
      main: string;
      bin: Record<string, string>;
    };
    expect(Object.keys(pkg.exports).sort()).toEqual([".", "./dist/*", "./package.json", "./shared"]);
    expect(pkg.exports["./dist/*"]).toBe("./dist/*");
    expect(pkg.main).toBe("./dist/index.js");
    expect(pkg.bin["mcp-memory-server"]).toBe("./dist/index.js");
  });

  it("exports the tool-result character cap and its truncation helper (OD-2, 96,000 chars)", () => {
    expect(MAX_RESULT_CHARS).toBe(96_000);
    expect(MAX_RESULT_CHARS).toBe(24_000 * 4);
    expect(typeof capResult).toBe("function");
    const short = "short text";
    expect(capResult(short)).toBe(short);
    const long = "x".repeat(MAX_RESULT_CHARS + 1000);
    const truncated = capResult(long);
    expect(truncated.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(truncated.endsWith("[…truncated to fit the 25K token limit. Use a more specific query to see all results.]")).toBe(true);
  });

  it("capResult never leaves a lone surrogate: an astral character exactly at the cut is dropped whole", () => {
    // The cut for the default hint falls at MAX_RESULT_CHARS - 200; put a
    // surrogate pair so that its high surrogate is the last unit before it.
    const cut = MAX_RESULT_CHARS - 200;
    const text = "x".repeat(cut - 1) + "\u{1F600}" + "y".repeat(2000);
    const out = capResult(text);
    expect(out.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    // No unpaired surrogate anywhere in the result.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(out)).toBe(false);
    expect(out.startsWith("x".repeat(cut - 1) + "\n\n[…truncated")).toBe(true);
  });

  it("capResult keeps the whole result within the cap for a hint longer than the reserve, and bounds the hint", () => {
    const longHint = "h".repeat(5_000);
    const out = capResult("x".repeat(MAX_RESULT_CHARS + 10), longHint);
    expect(out.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(out.endsWith("h".repeat(1_000) + "]")).toBe(true);
    expect(out.includes("h".repeat(1_001))).toBe(false);
  });

  it("starts nothing on import: neither the entry nor the tools import src/index.ts", () => {
    // A "never" that no call can observe, so it is checked on the source. The
    // main entry opens a stdio transport when imported without
    // MNEMOVERSE_MCP_NO_AUTOSTART, which inside another server would attach
    // this package to that process's stdin and stdout.
    // prompts.ts and resources.ts joined /shared in 0.11 and are read too.
    for (const file of ["../src/shared.ts", "../src/tools.ts", "../src/prompts.ts", "../src/resources.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, `${file} imports the stdio entry`).not.toMatch(/from\s+["']\.\/index(\.js)?["']/);
    }
  });
});
