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
 * validator accepts only 2020-12 refuses such a tool before calling it, with
 * the message quoted in #189: "JSON Schema declares an unsupported dialect
 * (draft-07). The default validator supports JSON Schema 2020-12 only". That
 * message comes from the `AjvJsonSchemaValidator` of
 * `@modelcontextprotocol/client` 2.0.0-alpha.4 to 2.0.0-beta.5, which
 * rejected all 22 schemas of 0.15.0 and accepts all 22 served through this
 * file. The SDK side is modelcontextprotocol/typescript-sdk#2084, open on
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
 * WHAT IT READS FROM THE SDK THAT IS NOT DOCUMENTED API, AND WHAT HAPPENS
 * WHEN A LATER SDK CHANGES IT. Three things: the registered tools,
 * `McpServer._registeredTools` (the map the SDK's own handler lists from; the
 * hosted connector's host-surface check reads it too), and the converter
 * modules `server/zod-json-schema-compat.js` and `server/zod-compat.js`, which
 * the SDK's `./*` export makes importable. None of them is needed for the
 * server to start or for its tools to work, so none of them is imported
 * statically: `npx` resolves `^1.30.0` to the newest 1.x, and a static import
 * of a module that release had moved would stop the process before it
 * answered `initialize`. The converter modules are loaded with a dynamic
 * `import()` inside a `try`, and the map is looked up when this function
 * runs. When any of them is missing, or the SDK has installed `tools/list`
 * before any tool was registered, the SDK's own `tools/list` answer goes out
 * unchanged (draft-07, as in 0.15.0) and one line on stderr says why, once
 * per process. stdout is the MCP channel, so nothing is written there.
 * test/schema-dialect-fallback.test.ts takes each of these away in turn and
 * checks that the server still lists its eleven tools. When the SDK passes
 * the target itself, the bare-SDK test in test/schema-dialect.test.ts fails.
 * The SDK would then write the 2020-12 URI, which this wrapper leaves out, so
 * the choice at that point is whether to keep the wrapper for that reason
 * alone.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";

// Types only: erased at compile time, so these lines load nothing.
type JsonSchemaCompatModule = typeof import("@modelcontextprotocol/sdk/server/zod-json-schema-compat.js");
type ZodCompatModule = typeof import("@modelcontextprotocol/sdk/server/zod-compat.js");

/** The `$schema` URI the SDK's converter writes for a 2020-12 schema. Used to
 *  confirm the conversion really produced 2020-12 before the key is dropped. */
export const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/** The MCP method whose handler this file wraps. */
const LIST_METHOD = "tools/list";

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

/** The two SDK functions the conversion uses, once loaded. */
interface Converter {
  toJsonSchemaCompat: JsonSchemaCompatModule["toJsonSchemaCompat"];
  normalizeObjectSchema: ZodCompatModule["normalizeObjectSchema"];
}

/** Servers this function has already dealt with: wrapped, or left to the SDK
 *  with a warning. */
const handled = new WeakSet<McpServer>();

/**
 * Make `server`'s `tools/list` describe every tool schema in JSON Schema
 * 2020-12 with no `$schema` key. See the file header for why, for the calling
 * order it requires, and for what it does when the SDK lacks a part it needs.
 */
export function serveToolSchemasIn2020_12(server: McpServer): void {
  if (handled.has(server)) return;
  const lowLevel = server.server;
  const registered = registeredTools(server);
  let listAlreadyInstalled = false;
  try {
    lowLevel.assertCanSetRequestHandler(LIST_METHOD);
  } catch {
    listAlreadyInstalled = true;
  }
  if (listAlreadyInstalled && registered !== undefined && Object.keys(registered).length > 0) {
    // The caller's mistake, not the SDK's: say so instead of serving draft-07.
    throw new Error(
      "serveToolSchemasIn2020_12: a tools/list handler is already installed on this server, " +
        "which means a tool was registered before this call. Call it (or registerMemoryTools, " +
        "which calls it) before registering any tool.",
    );
  }
  handled.add(server);
  if (registered === undefined) {
    warnOnce("this SDK has no McpServer._registeredTools to read the tool schemas from");
    return;
  }
  if (listAlreadyInstalled) {
    // No tool is registered and the handler is there anyway: this SDK installs
    // it on its own, so there is no installation left to wrap.
    warnOnce("this SDK installs its tools/list handler before any tool is registered");
    return;
  }
  // Started now so that a missing module is reported at startup rather than
  // at the first tools/list; nothing waits on it here.
  void loadConverter();

  // Whatever `setRequestHandler` resolves to right now: the Server method, or
  // a consumer's own shadow on this instance (the hosted connector wraps
  // tools/call this way, src/host-surface.ts). It is put back as it was once
  // the tools/list handler has gone through, unless a consumer has put its
  // own shadow over this one in the meantime: that shadow stays where it is,
  // and this one, still under it, passes every later handler straight on.
  const hadOwn = Object.prototype.hasOwnProperty.call(lowLevel, "setRequestHandler");
  const previous = lowLevel.setRequestHandler as unknown as SetRequestHandler;
  const current = (): unknown => (lowLevel as unknown as { setRequestHandler: unknown }).setRequestHandler;
  const restore = (): void => {
    if (current() !== shadow) return;
    if (hadOwn) {
      (lowLevel as unknown as { setRequestHandler: SetRequestHandler }).setRequestHandler = previous;
    } else {
      delete (lowLevel as unknown as { setRequestHandler?: SetRequestHandler }).setRequestHandler;
    }
  };

  let listInstalled = false;
  const shadow: SetRequestHandler = (schema, handler) => {
    if (listInstalled || methodOf(schema) !== LIST_METHOD) {
      previous.call(lowLevel, schema, handler);
      return;
    }
    listInstalled = true;
    restore();
    previous.call(lowLevel, schema, async (request: unknown, extra: unknown) => {
      const result = (await handler(request, extra)) as ListToolsResult;
      const convert = await loadConverter();
      return convert === undefined ? result : in2020_12(convert, result, registeredTools(server));
    });
  };
  (lowLevel as unknown as { setRequestHandler: SetRequestHandler }).setRequestHandler = shadow;
}

let warned = false;

/** One line on stderr per process, the first time the SDK's draft-07 answer
 *  has to stand. Never stdout: on stdio that is the MCP channel. */
function warnOnce(reason: string): void {
  if (warned) return;
  warned = true;
  console.error(
    `Mnemoverse: tool schemas are listed as the MCP SDK builds them (JSON Schema draft-07), ` +
      `not 2020-12, because ${reason}. The tools work as before; a client that accepts only ` +
      `JSON Schema 2020-12 may refuse them (#189).`,
  );
}

let converter: Promise<Converter | undefined> | undefined;

/** The SDK's converter, loaded on first use and kept; undefined, with the
 *  warning written, when this SDK does not have it where 1.30 to 1.32 do. */
function loadConverter(): Promise<Converter | undefined> {
  converter ??= (async (): Promise<Converter | undefined> => {
    try {
      const [jsonSchemaCompat, zodCompat] = await Promise.all([
        import("@modelcontextprotocol/sdk/server/zod-json-schema-compat.js"),
        import("@modelcontextprotocol/sdk/server/zod-compat.js"),
      ]);
      const { toJsonSchemaCompat } = jsonSchemaCompat;
      const { normalizeObjectSchema } = zodCompat;
      if (typeof toJsonSchemaCompat !== "function" || typeof normalizeObjectSchema !== "function") {
        warnOnce("this SDK's converter modules no longer export toJsonSchemaCompat and normalizeObjectSchema");
        return undefined;
      }
      return { toJsonSchemaCompat, normalizeObjectSchema };
    } catch (err) {
      warnOnce(`this SDK's converter modules could not be loaded (${firstLine(err)})`);
      return undefined;
    }
  })();
  return converter;
}

function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n", 1)[0] ?? message;
}

/**
 * The method string of a request schema passed to `setRequestHandler`, or
 * undefined when it has none. The same reading as the SDK's
 * `getMethodLiteral`, done here so that recognising `tools/list` does not
 * depend on loading the SDK's converter modules: the shape of a zod 4 object
 * (`_zod.def.shape`) or zod 3 object (`.shape`), then the value of its
 * `method` literal.
 */
function methodOf(schema: unknown): string | undefined {
  try {
    const s = schema as { _zod?: { def?: { shape?: unknown } }; shape?: unknown } | null | undefined;
    let shape: unknown = s?._zod !== undefined ? s._zod.def?.shape : s?.shape;
    if (typeof shape === "function") shape = (shape as () => unknown)();
    const literal = (shape as { method?: unknown } | null | undefined)?.method as
      | {
          _zod?: { def?: { value?: unknown; values?: unknown } };
          _def?: { value?: unknown; values?: unknown };
          value?: unknown;
        }
      | undefined;
    if (literal === undefined || literal === null) return undefined;
    const def = literal._zod?.def ?? literal._def;
    const value =
      def?.value !== undefined
        ? def.value
        : Array.isArray(def?.values) && def.values.length > 0
          ? def.values[0]
          : literal.value;
    return typeof value === "string" ? value : undefined;
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
 *  can be. A tool whose schemas fail to convert is left as the SDK built it. */
function in2020_12(
  convert: Converter,
  result: ListToolsResult,
  registered: Record<string, RegisteredSchemas> | undefined,
): ListToolsResult {
  if (registered === undefined) {
    warnOnce("this SDK has no McpServer._registeredTools to read the tool schemas from");
    return result;
  }
  return {
    ...result,
    tools: result.tools.map((tool): ListedTool => {
      const own = Object.prototype.hasOwnProperty.call(registered, tool.name)
        ? registered[tool.name]
        : undefined;
      if (own === undefined) return tool;
      try {
        const next: ListedTool = { ...tool };
        const input = schemaIn2020_12(convert, own.inputSchema, "input");
        if (input !== undefined) next.inputSchema = input as ListedTool["inputSchema"];
        if (tool.outputSchema !== undefined) {
          const output = schemaIn2020_12(convert, own.outputSchema, "output");
          if (output !== undefined) next.outputSchema = output as ListedTool["outputSchema"];
        }
        return next;
      } catch (err) {
        warnOnce(`the schemas of ${tool.name} could not be converted (${firstLine(err)})`);
        return tool;
      }
    }),
  };
}

/**
 * One registered zod schema as 2020-12 JSON Schema with no `$schema` key, or
 * undefined when it cannot be: no schema (the SDK's own empty-object answer
 * then stands, and it has no `$schema` key), or a converter that did not
 * produce 2020-12.
 */
function schemaIn2020_12(
  convert: Converter,
  schema: unknown,
  io: "input" | "output",
): JsonSchemaObject | undefined {
  const obj = convert.normalizeObjectSchema(schema as Parameters<Converter["normalizeObjectSchema"]>[0]);
  if (obj === undefined) return undefined;
  const json = convert.toJsonSchemaCompat(obj, {
    strictUnions: true,
    pipeStrategy: io,
    target: "draft-2020-12",
  });
  if (json.$schema !== JSON_SCHEMA_2020_12) return undefined;
  const { $schema: _dialect, ...body } = json;
  return body;
}
