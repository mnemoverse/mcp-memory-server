/**
 * #189: every tool schema on `tools/list` is JSON Schema 2020-12.
 *
 * A client whose validator accepts only 2020-12 refused every tool of this
 * server with "JSON Schema declares an unsupported dialect (draft-07). The
 * default validator supports JSON Schema 2020-12 only" (the message reported
 * in #189, from `@modelcontextprotocol/client` 2.0.0-alpha.4 to 2.0.0-beta.5),
 * because the SDK wrote `"$schema": draft-07` on every inputSchema and
 * outputSchema. src/schema-dialect.ts has the cause and the fix; this file
 * pins four things (test/schema-dialect-fallback.test.ts covers what happens
 * when the SDK lacks a part the fix reads):
 *
 *  1. On the package's own server (src/index.ts), no schema declares a
 *     dialect, so each is 2020-12 under MCP 2025-11-25; each is valid against
 *     the 2020-12 meta-schema and compiles in a strict 2020-12 validator; and
 *     a draft-07 validator in its default configuration still compiles it.
 *  2. The bodies are exactly what the SDK served before, minus `$schema`: the
 *     fix changes the declared dialect, not the shape of any schema.
 *  3. The installed SDK, left alone, still writes draft-07. When it stops, the
 *     SDK passes the target itself (modelcontextprotocol/typescript-sdk#2084)
 *     and src/schema-dialect.ts can go.
 *  4. The calling order the wrapper needs, and its composition with a
 *     consumer that shadows `setRequestHandler` the way the hosted connector
 *     does (mnemoverse-mcp-remote, src/host-surface.ts), whether that shadow
 *     goes on before the wrapper or after it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getMethodLiteral, toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import AjvModule from "ajv";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { z } from "zod";
import { z as z3 } from "zod/v3";
import { registerMemoryTools, serveToolSchemasIn2020_12 } from "../src/shared.js";
import { startMemoryServer, type Harness } from "./harness.js";

// ajv and ajv-formats are CommonJS; under Node16 resolution the default
// import is the module object, whose `.default` is the export itself.
type AjvLike = {
  compile(schema: object): unknown;
  validateSchema(schema: object): boolean | Promise<unknown>;
  errors?: unknown;
};
type AjvCtor = new (opts?: Record<string, unknown>) => AjvLike;
const unwrap = <T>(m: unknown): T => ((m as { default?: T }).default ?? m) as T;
const Ajv07 = unwrap<AjvCtor>(AjvModule);
const Ajv2020 = unwrap<AjvCtor>(Ajv2020Module);
const addFormats = unwrap<(ajv: AjvLike) => AjvLike>(addFormatsModule);

/** A strict 2020-12 validator: unknown keywords, ambiguous types and loose
 *  tuples are errors, and `validateSchema` checks against the 2020-12
 *  meta-schema. */
function strict2020(): AjvLike {
  return addFormats(new Ajv2020({ strict: true, allErrors: true }));
}

/** What a client that never heard of 2020-12 uses: Ajv's default (draft-07)
 *  class in its default configuration. */
function default07(): AjvLike {
  return addFormats(new Ajv07());
}

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

type Field = "inputSchema" | "outputSchema";
const FIELDS: Field[] = ["inputSchema", "outputSchema"];

/** Every declared schema on the list, labelled `tool.field`. */
function schemasOf(tools: Tool[]): Array<[string, Record<string, unknown>]> {
  const out: Array<[string, Record<string, unknown>]> = [];
  for (const tool of tools) {
    for (const field of FIELDS) {
      const schema = tool[field];
      if (schema !== undefined) out.push([`${tool.name}.${field}`, schema as Record<string, unknown>]);
    }
  }
  return out;
}

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "schema-dialect-test", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

const NEVER_CALLED = {
  apiFetch: async (path: string): Promise<never> => {
    throw new Error(`apiFetch was called (${path}); these tests only list tools`);
  },
};

describe("tools/list on the package's own server: JSON Schema 2020-12 (#189)", () => {
  let harness: Harness;
  let tools: Tool[];

  beforeAll(async () => {
    harness = await startMemoryServer();
    tools = (await harness.client.listTools()).tools;
  });

  afterAll(async () => {
    await harness.close();
  });

  it("lists eleven tools, each with an inputSchema and an outputSchema (22 schemas)", () => {
    expect(tools).toHaveLength(11);
    expect(schemasOf(tools)).toHaveLength(22);
  });

  it("no schema declares a dialect, so each is 2020-12 by the MCP default", () => {
    const declaring = schemasOf(tools)
      .filter(([, schema]) => "$schema" in schema)
      .map(([label, schema]) => `${label}: ${String(schema.$schema)}`);
    expect(declaring).toEqual([]);
  });

  it("each schema is valid against the 2020-12 meta-schema and compiles in a strict 2020-12 validator", () => {
    const ajv = strict2020();
    const failures: string[] = [];
    for (const [label, schema] of schemasOf(tools)) {
      if (ajv.validateSchema(schema) !== true) {
        failures.push(`${label}: meta-schema: ${JSON.stringify(ajv.errors)}`);
        continue;
      }
      try {
        ajv.compile(schema);
      } catch (err) {
        failures.push(`${label}: compile: ${(err as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("a draft-07 validator in its default configuration still compiles each schema", () => {
    const ajv = default07();
    const failures: string[] = [];
    for (const [label, schema] of schemasOf(tools)) {
      try {
        ajv.compile(schema);
      } catch (err) {
        failures.push(`${label}: ${(err as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("each body is what the SDK's own draft-07 conversion produced, minus $schema: the shape is unchanged", async () => {
    const { server } = await import("../src/index.js");
    const registered = (server as unknown as {
      _registeredTools: Record<string, { inputSchema?: unknown; outputSchema?: unknown }>;
    })._registeredTools;
    const differing: string[] = [];
    for (const tool of tools) {
      for (const field of FIELDS) {
        const obj = normalizeObjectSchema(registered[tool.name]?.[field] as Parameters<typeof normalizeObjectSchema>[0]);
        expect(obj, `${tool.name}.${field} is registered as a zod object`).toBeDefined();
        // The SDK's tools/list call, verbatim: no `target`, so draft-07.
        const before = toJsonSchemaCompat(obj!, {
          strictUnions: true,
          pipeStrategy: field === "inputSchema" ? "input" : "output",
        });
        expect(before.$schema).toBe(DRAFT_07);
        const { $schema: _dialect, ...body } = before;
        if (JSON.stringify(body) !== JSON.stringify(tool[field])) differing.push(`${tool.name}.${field}`);
      }
    }
    expect(differing).toEqual([]);
  });
});

describe("the installed SDK, left alone, still writes draft-07", () => {
  it("a bare McpServer lists a zod tool with $schema draft-07 on both schemas (when this fails, see typescript-sdk#2084 and retire src/schema-dialect.ts)", async () => {
    const server = new McpServer({ name: "bare-sdk", version: "0.0.0" });
    server.registerTool(
      "probe",
      { description: "probe", inputSchema: { q: z.string() }, outputSchema: { ok: z.boolean() } },
      async () => ({ content: [], structuredContent: { ok: true } }),
    );
    const client = await connect(server);
    const [tool] = (await client.listTools()).tools;
    expect(tool?.inputSchema.$schema).toBe(DRAFT_07);
    expect(tool?.outputSchema?.$schema).toBe(DRAFT_07);
    await server.close();
  });
});

describe("serveToolSchemasIn2020_12: calling order and composition", () => {
  it("registerMemoryTools throws when a tool is already registered on the server, instead of serving draft-07 silently", () => {
    const server = new McpServer({ name: "late", version: "0.0.0" });
    server.registerTool("first", { description: "first" }, async () => ({ content: [] }));
    expect(() => registerMemoryTools(server, NEVER_CALLED)).toThrow(/before registering any tool/);
  });

  it("a second call on the same server does nothing, so a consumer may call it before registerMemoryTools", async () => {
    const server = new McpServer({ name: "twice", version: "0.0.0" });
    serveToolSchemasIn2020_12(server);
    expect(() => registerMemoryTools(server, NEVER_CALLED)).not.toThrow();
    const client = await connect(server);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(11);
    expect(schemasOf(tools).filter(([, s]) => "$schema" in s)).toEqual([]);
    await server.close();
  });

  it("a consumer's own setRequestHandler shadow (the hosted connector's tools/call wrap) still gets tools/call, and is back in place after registration", async () => {
    const server = new McpServer({ name: "shadowed", version: "0.0.0" });
    const lowLevel = server.server as unknown as {
      setRequestHandler: (schema: unknown, handler: (req: unknown, extra: unknown) => unknown) => void;
    };
    const original = lowLevel.setRequestHandler.bind(lowLevel);
    const seen: string[] = [];
    const shadow = (schema: unknown, handler: (req: unknown, extra: unknown) => unknown): void => {
      const method = getMethodLiteral(schema as Parameters<typeof getMethodLiteral>[0]);
      seen.push(method);
      if (method !== "tools/call") {
        original(schema, handler);
        return;
      }
      original(schema, (req, extra) =>
        (req as { params?: { name?: unknown } }).params?.name === "memory_stats"
          ? ({ content: [{ type: "text", text: "refused by the consumer" }], isError: true } satisfies CallToolResult)
          : handler(req, extra),
      );
    };
    lowLevel.setRequestHandler = shadow;

    registerMemoryTools(server, NEVER_CALLED);
    expect(lowLevel.setRequestHandler).toBe(shadow);
    expect(seen).toEqual(["tools/list", "tools/call"]);

    const client = await connect(server);
    const result = (await client.callTool({ name: "memory_stats", arguments: {} })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "refused by the consumer" }]);
    const { tools } = await client.listTools();
    expect(schemasOf(tools).filter(([, s]) => "$schema" in s)).toEqual([]);
    await server.close();
  });

  it("a consumer shadow put on AFTER the wrapper, before the first registration, also stays in place and still gets tools/call", async () => {
    const server = new McpServer({ name: "shadowed-after", version: "0.0.0" });
    serveToolSchemasIn2020_12(server);
    const lowLevel = server.server as unknown as {
      setRequestHandler: (schema: unknown, handler: (req: unknown, extra: unknown) => unknown) => void;
    };
    const underneath = lowLevel.setRequestHandler.bind(lowLevel);
    const seen: string[] = [];
    const shadow = (schema: unknown, handler: (req: unknown, extra: unknown) => unknown): void => {
      const method = getMethodLiteral(schema as Parameters<typeof getMethodLiteral>[0]);
      seen.push(method);
      if (method !== "tools/call") {
        underneath(schema, handler);
        return;
      }
      underneath(schema, (req, extra) =>
        (req as { params?: { name?: unknown } }).params?.name === "memory_stats"
          ? ({ content: [{ type: "text", text: "refused by the consumer" }], isError: true } satisfies CallToolResult)
          : handler(req, extra),
      );
    };
    lowLevel.setRequestHandler = shadow;

    registerMemoryTools(server, NEVER_CALLED);
    expect(lowLevel.setRequestHandler).toBe(shadow);
    expect(seen).toEqual(["tools/list", "tools/call"]);

    const client = await connect(server);
    const result = (await client.callTool({ name: "memory_stats", arguments: {} })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "refused by the consumer" }]);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(11);
    expect(schemasOf(tools).filter(([, s]) => "$schema" in s)).toEqual([]);
    await server.close();
  });

  it("a zod 4 tool the consumer registers afterwards gets 2020-12 keywords: a tuple as prefixItems, a recursive schema under $defs", async () => {
    const server = new McpServer({ name: "consumer-tools", version: "0.0.0" });
    registerMemoryTools(server, NEVER_CALLED);
    const Node: z.ZodType<{ name: string; children: unknown[] }> = z.object({
      name: z.string(),
      get children() {
        return z.array(Node);
      },
    });
    server.registerTool(
      "consumer_tool",
      { description: "consumer", inputSchema: { pair: z.tuple([z.string(), z.number()]), tree: Node } },
      async () => ({ content: [] }),
    );
    const client = await connect(server);
    const tool = (await client.listTools()).tools.find((t) => t.name === "consumer_tool");
    const schema = tool?.inputSchema as unknown as Record<string, unknown> & {
      properties: { pair: Record<string, unknown> };
    };
    expect(schema).toBeDefined();
    expect("$schema" in schema).toBe(false);
    expect(schema.properties.pair.prefixItems).toEqual([{ type: "string" }, { type: "number" }]);
    expect(Array.isArray(schema.properties.pair.items)).toBe(false);
    expect(schema.$defs).toBeDefined();
    expect(schema.definitions).toBeUndefined();
    const ajv = strict2020();
    expect(ajv.validateSchema(schema)).toBe(true);
    expect(() => ajv.compile(schema)).not.toThrow();
    await server.close();
  });

  it("a zod 3 tool, which the SDK's converter cannot write in 2020-12, is left exactly as the SDK built it", async () => {
    const server = new McpServer({ name: "zod3", version: "0.0.0" });
    registerMemoryTools(server, NEVER_CALLED);
    server.registerTool(
      "zod3_tool",
      { description: "zod 3", inputSchema: { pair: z3.tuple([z3.string(), z3.number()]) } },
      async () => ({ content: [] }),
    );
    const client = await connect(server);
    const tool = (await client.listTools()).tools.find((t) => t.name === "zod3_tool");
    expect(tool?.inputSchema.$schema).toBe(DRAFT_07);
    await server.close();
  });
});
