/**
 * #189, when the SDK lacks a part src/schema-dialect.ts reads.
 *
 * The 2020-12 wrapper reads three things the SDK does not document: the
 * converter modules `server/zod-json-schema-compat.js` and
 * `server/zod-compat.js`, and `McpServer._registeredTools`. It also relies on
 * the SDK installing `tools/list` at the first registration. `npx` installs
 * the newest SDK 1.x the `^1.30.0` range allows, so a later 1.x may lack any
 * of these. The server must still start and list its tools: this file takes
 * each part away in turn and checks that
 *
 *  - the package's own server (src/index.ts, what `npx` runs) or a server
 *    built with `registerMemoryTools` still lists all eleven tools,
 *  - their schemas are the SDK's own answer, unchanged (draft-07, as 0.15.0
 *    served them), and
 *  - one line on stderr says why, once however many servers and listings
 *    there are, and nothing is written to stdout (the MCP channel on stdio).
 *
 * A missing module is simulated with `vi.doMock` on the module id: only the
 * modules of this package see the mock (the SDK's own files are loaded by Node
 * and keep the real ones), which is the situation of a release that moved the
 * file. `vi.resetModules()` before each test gives src/ a fresh module state,
 * so the once-per-process warning starts unwritten every time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";
const JSON_SCHEMA_COMPAT = "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
const ZOD_COMPAT = "@modelcontextprotocol/sdk/server/zod-compat.js";

const NEVER_CALLED = {
  apiFetch: async (path: string): Promise<never> => {
    throw new Error(`apiFetch was called (${path}); these tests only list tools`);
  },
};

type Shared = typeof import("../src/shared.js");

let stderr: string[];
let stdout: unknown[];

beforeEach(() => {
  vi.resetModules();
  stderr = [];
  stdout = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  });
  for (const method of ["log", "info", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      stdout.push(args);
    });
  }
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(chunk);
    return true;
  });
});

afterEach(() => {
  vi.doUnmock(JSON_SCHEMA_COMPAT);
  vi.doUnmock(ZOD_COMPAT);
  vi.restoreAllMocks();
});

/** src/index.ts as `npx` runs it, minus the stdio transport. */
async function packageServer(): Promise<McpServer> {
  process.env.MNEMOVERSE_MCP_NO_AUTOSTART = "1";
  process.env.MNEMOVERSE_API_KEY = "mk_live_fallback_test_not_a_secret";
  process.env.MNEMOVERSE_API_URL = "http://127.0.0.1:1/api/v1";
  const { server } = await import("../src/index.js");
  return server;
}

/** A fresh copy of src/shared.ts, in the same module state as src/index.ts. */
async function shared(): Promise<Shared> {
  return import("../src/shared.js");
}

/** `tools/list`, twice, over an in-memory client; returns the second answer. */
async function listTwice(server: McpServer): Promise<Tool[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "schema-dialect-fallback-test", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.listTools();
  const { tools } = await client.listTools();
  await server.close();
  return tools;
}

/** The `$schema` of every declared schema, `(absent)` when it has none. */
function dialects(tools: Tool[]): string[] {
  return tools.flatMap((tool) =>
    [tool.inputSchema, tool.outputSchema]
      .filter((schema): schema is NonNullable<typeof schema> => schema !== undefined)
      .map((schema) => (typeof schema.$schema === "string" ? schema.$schema : "(absent)")),
  );
}

/** What every fallback leaves: the SDK's answer for all eleven tools. */
function expectSdkAnswer(tools: Tool[]): void {
  expect(tools).toHaveLength(11);
  const found = dialects(tools);
  expect(found).toHaveLength(22);
  expect(new Set(found)).toEqual(new Set([DRAFT_07]));
}

/** Exactly one warning, saying why, and nothing on stdout. */
function expectOneWarning(why: RegExp): void {
  expect(stderr).toHaveLength(1);
  expect(stderr[0]).toMatch(/^Mnemoverse: tool schemas are listed as the MCP SDK builds them \(JSON Schema draft-07\)/);
  expect(stderr[0]).toMatch(why);
  expect(stderr[0]).toContain("#189");
  expect(stdout).toEqual([]);
}

describe("control: with the SDK as installed", () => {
  it("every schema is 2020-12 and nothing is written to stderr or stdout", async () => {
    const tools = await listTwice(await packageServer());
    expect(tools).toHaveLength(11);
    expect(new Set(dialects(tools))).toEqual(new Set(["(absent)"]));
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([]);
  });
});

describe("a converter module a later SDK no longer has", () => {
  it.each([JSON_SCHEMA_COMPAT, ZOD_COMPAT])(
    "%s cannot be loaded: the package's server still lists its eleven tools with the SDK's schemas, and one line on stderr says why",
    async (missing) => {
      vi.doMock(missing, () => {
        throw Object.assign(new Error(`Cannot find module '${missing}'`), { code: "ERR_MODULE_NOT_FOUND" });
      });
      expectSdkAnswer(await listTwice(await packageServer()));

      // A second server in the same process: the same answer, no second line.
      const { registerMemoryTools } = await shared();
      const second = new McpServer({ name: "second", version: "0.0.0" });
      registerMemoryTools(second, NEVER_CALLED);
      expectSdkAnswer(await listTwice(second));

      expectOneWarning(/converter modules could not be loaded/);
    },
  );

  it("the module loads but no longer exports toJsonSchemaCompat: the same fallback", async () => {
    vi.doMock(JSON_SCHEMA_COMPAT, async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      toJsonSchemaCompat: undefined,
    }));
    expectSdkAnswer(await listTwice(await packageServer()));
    expectOneWarning(/no longer export toJsonSchemaCompat and normalizeObjectSchema/);
  });
});

describe("an McpServer with no _registeredTools", () => {
  it("leaves the SDK's own tools/list handler in place; the tools are listed with the SDK's schemas, and one line on stderr says why", async () => {
    const { registerMemoryTools, serveToolSchemasIn2020_12 } = await shared();
    const server = new McpServer({ name: "no-registered-tools", version: "0.0.0" });
    const holder = server as unknown as { _registeredTools?: unknown };
    // The SDK of this test needs its map to work; a later one would keep its
    // tools somewhere else. What matters is that the wrapper finds nothing
    // under this name when it runs, so the map is hidden for that moment.
    const map = holder._registeredTools;
    delete holder._registeredTools;
    serveToolSchemasIn2020_12(server);
    expect(Object.prototype.hasOwnProperty.call(server.server, "setRequestHandler")).toBe(false);
    holder._registeredTools = map;

    expect(() => registerMemoryTools(server, NEVER_CALLED)).not.toThrow();
    expect(Object.prototype.hasOwnProperty.call(server.server, "setRequestHandler")).toBe(false);
    expectSdkAnswer(await listTwice(server));
    expectOneWarning(/no McpServer\._registeredTools/);
  });
});

describe("an SDK that installs tools/list before any tool is registered", () => {
  it("registerMemoryTools does not throw; the tools are listed with the SDK's schemas, and one line on stderr says why", async () => {
    const { registerMemoryTools } = await shared();
    const server = new McpServer({ name: "eager-tools-list", version: "0.0.0" });
    // The SDK's own installation step, run before any registration, the way
    // an SDK that installed it in the constructor would.
    (server as unknown as { setToolRequestHandlers(): void }).setToolRequestHandlers();

    expect(() => registerMemoryTools(server, NEVER_CALLED)).not.toThrow();
    expectSdkAnswer(await listTwice(server));
    expectOneWarning(/installs its tools\/list handler before any tool is registered/);
  });
});
