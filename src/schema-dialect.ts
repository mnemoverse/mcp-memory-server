/**
 * Tool schemas in JSON Schema 2020-12, the dialect MCP defaults to (#189).
 *
 * WHAT WAS WRONG. `@modelcontextprotocol/sdk` 1.x builds the `tools/list`
 * answer itself. For each registered tool it converts the zod input and output
 * schemas with `toJsonSchemaCompat(obj, { strictUnions, pipeStrategy })`
 * (dist/esm/server/mcp.js) and passes no `target`, and that function's target
 * mapping falls back to `draft-7` when none is given. So every `inputSchema`
 * and `outputSchema` this package served said
 * `"$schema": "http://json-schema.org/draft-07/schema#"` (0.15.0 with SDK
 * 1.30.0 and with 1.32.1, the newest 1.x, checked 2026-10-11). MCP 2025-11-25
 * ("JSON Schema Usage") makes 2020-12 the default dialect, and a client whose
 * validator accepts only 2020-12 refuses such a tool before calling it. Claude
 * Desktop does, on every tool: "JSON Schema declares an unsupported dialect
 * (draft-07). The default validator supports JSON Schema 2020-12 only" (#189).
 * The SDK side is modelcontextprotocol/typescript-sdk#2084, open on
 * 2026-10-11.
 *
 * WHAT THIS DOES. It wraps the SDK's own `tools/list` handler. For each listed
 * tool it converts the registered zod schemas again, with the SDK's own
 * converter and the same options plus `target: "draft-2020-12"` (the change
 * #2084 proposes), and then removes the `$schema` key. Everything else on a
 * listed tool (name, title, description, annotations, execution, `_meta`) is
 * what the SDK built. For this package's eleven tools the 2020-12 conversion
 * and the draft-07 one differ in the `$schema` line alone; the bodies are
 * byte-identical (test/schema-dialect.test.ts compares them).
 *
 * WHY NO `$schema` KEY, rather than the 2020-12 URI. Both mean 2020-12 under
 * the spec: "When a schema does not include a `$schema` field, it defaults to
 * JSON Schema 2020-12." The difference is in older clients. A draft-07 Ajv
 * instance in its default configuration (`new Ajv()`) cannot compile a schema
 * that names the 2020-12 meta-schema (`no schema with key or ref
 * "https://json-schema.org/draft/2020-12/schema"`), and it compiles the same
 * schema without the key. Without the key, a 2020-12-only validator reads
 * 2020-12 and a draft-07 one still works. The test compiles every schema
 * under both.
 *
 * WHICH TOOLS. Every tool on the server, not only the eleven registered by
 * `registerMemoryTools`: a server that registers its own tools beside these
 * gets the same dialect for them. A tool whose schema the SDK's converter
 * cannot write in 2020-12 (a zod 3 schema: its converter has no 2020-12
 * target and returns draft-07 whatever it is asked) is left exactly as the SDK
 * built it, since dropping `$schema` from a draft-07 body would claim a
 * dialect that body was not written in.
 *
 * WHEN TO CALL. Before the first tool is registered on the server. The SDK
 * installs its `tools/list` handler at the first `registerTool` and never
 * again, so this function watches for that one installation and wraps it.
 * `registerMemoryTools` calls it first thing; calling it again on the same
 * server does nothing. Called after a tool is already registered, it throws,
 * because it could not do what its name says.
 *
 * WHAT IT READS FROM THE SDK THAT IS NOT DOCUMENTED API. The registered tools,
 * `McpServer._registeredTools` (the map the SDK's own handler lists from; the
 * hosted connector's host-surface check reads it too), and the converter
 * modules `server/zod-json-schema-compat.js` and `server/zod-compat.js`, which
 * the SDK's `./*` export makes importable. If a later SDK no longer has the
 * map, the wrapper returns the SDK's answer unchanged rather than failing
 * `tools/list`; the test then fails in CI on the dependency bump that did it.
 * When the SDK passes the target itself, the bare-SDK test in that file fails
 * too. The SDK would then write the 2020-12 URI, which this wrapper leaves out,
 * so the choice at that point is whether to keep the wrapper for that reason
 * alone.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, type ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import {
  getMethodLiteral,
  toJsonSchemaCompat,
} from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";

/** The `$schema` URI the SDK's converter writes for a 2020-12 schema. Used to
 *  confirm the conversion really produced 2020-12 before the key is dropped. */
export const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

type JsonSchemaObject = Record<string, unknown>;
type ListedTool = ListToolsResult["tools"][number];
type RequestHandler = (request: unknown, extra: unknown) => unknown;
type SetRequestHandler = (schema: unknown, handler: RequestHandler) => void;

/** The parts of a registered tool this file reads: the zod schemas the SDK
 *  stored at registration (or after `update()`), the same ones its own
 *  `tools/list` handler converts. */
interface RegisteredSchemas {
  inputSchema?: unknown;
  outputSchema?: unknown;
}

const LIST_METHOD = getMethodLiteral(ListToolsRequestSchema);

/** Servers whose `tools/list` is already (or about to be) wrapped. */
const wrapped = new WeakSet<McpServer>();

/**
 * Make `server`'s `tools/list` describe every tool schema in JSON Schema
 * 2020-12 with no `$schema` key. See the file header for why, and for the
 * calling order it requires.
 */
export function serveToolSchemasIn2020_12(server: McpServer): void {
  if (wrapped.has(server)) return;
  const lowLevel = server.server;
  try {
    lowLevel.assertCanSetRequestHandler(LIST_METHOD);
  } catch {
    throw new Error(
      "serveToolSchemasIn2020_12: a tools/list handler is already installed on this server, " +
        "which means a tool was registered before this call. Call it (or registerMemoryTools, " +
        "which calls it) before registering any tool.",
    );
  }
  wrapped.add(server);

  // Whatever `setRequestHandler` resolves to right now: the Server method, or
  // a consumer's own shadow on this instance (the hosted connector wraps
  // tools/call this way, src/host-surface.ts). It is put back as it was once
  // the tools/list handler has gone through.
  const hadOwn = Object.prototype.hasOwnProperty.call(lowLevel, "setRequestHandler");
  const previous = lowLevel.setRequestHandler as unknown as SetRequestHandler;
  const restore = (): void => {
    if (hadOwn) {
      (lowLevel as unknown as { setRequestHandler: SetRequestHandler }).setRequestHandler = previous;
    } else {
      delete (lowLevel as unknown as { setRequestHandler?: SetRequestHandler }).setRequestHandler;
    }
  };

  const shadow: SetRequestHandler = (schema, handler) => {
    if (methodOf(schema) !== LIST_METHOD) {
      previous.call(lowLevel, schema, handler);
      return;
    }
    restore();
    previous.call(lowLevel, schema, async (request: unknown, extra: unknown) =>
      in2020_12((await handler(request, extra)) as ListToolsResult, registeredTools(server)),
    );
  };
  (lowLevel as unknown as { setRequestHandler: SetRequestHandler }).setRequestHandler = shadow;
}

/** The SDK's method string for a request schema, or undefined when it has none. */
function methodOf(schema: unknown): string | undefined {
  try {
    return getMethodLiteral(schema as Parameters<typeof getMethodLiteral>[0]);
  } catch {
    return undefined;
  }
}

/** The SDK's registered-tool map, or undefined when this SDK does not have one. */
function registeredTools(server: McpServer): Record<string, RegisteredSchemas> | undefined {
  const registered = (server as unknown as { _registeredTools?: unknown })._registeredTools;
  return registered !== null && typeof registered === "object"
    ? (registered as Record<string, RegisteredSchemas>)
    : undefined;
}

/** The `tools/list` answer with each tool's schemas in 2020-12, wherever they
 *  can be. */
function in2020_12(
  result: ListToolsResult,
  registered: Record<string, RegisteredSchemas> | undefined,
): ListToolsResult {
  if (registered === undefined) return result;
  return {
    ...result,
    tools: result.tools.map((tool): ListedTool => {
      const own = Object.prototype.hasOwnProperty.call(registered, tool.name)
        ? registered[tool.name]
        : undefined;
      if (own === undefined) return tool;
      const next: ListedTool = { ...tool };
      const input = schemaIn2020_12(own.inputSchema, "input");
      if (input !== undefined) next.inputSchema = input as ListedTool["inputSchema"];
      if (tool.outputSchema !== undefined) {
        const output = schemaIn2020_12(own.outputSchema, "output");
        if (output !== undefined) next.outputSchema = output as ListedTool["outputSchema"];
      }
      return next;
    }),
  };
}

/**
 * One registered zod schema as 2020-12 JSON Schema with no `$schema` key, or
 * undefined when it cannot be: no schema (the SDK's own empty-object answer
 * then stands, and it has no `$schema` key), or a converter that did not
 * produce 2020-12.
 */
function schemaIn2020_12(schema: unknown, io: "input" | "output"): JsonSchemaObject | undefined {
  const obj = normalizeObjectSchema(schema as Parameters<typeof normalizeObjectSchema>[0]);
  if (obj === undefined) return undefined;
  const json = toJsonSchemaCompat(obj, {
    strictUnions: true,
    pipeStrategy: io,
    target: "draft-2020-12",
  });
  if (json.$schema !== JSON_SCHEMA_2020_12) return undefined;
  const { $schema: _dialect, ...body } = json;
  return body;
}
