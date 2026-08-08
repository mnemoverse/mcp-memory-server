/**
 * A real MCP client talking to the real server, in-process — so a test can call
 * a tool by name and read the sentence a user would read.
 *
 * WHY THIS EXISTS. Until now src/index.ts opened a stdio transport at import
 * time, so importing it from a test started a server on the runner's
 * stdin/stdout instead of handing back a handler. Every user-visible sentence in
 * the 0.8.1 release was therefore guarded, at best, by a regex over the source
 * text of src/index.ts. Three review rounds each found false sentences that a
 * behavioural check would have caught on the first run, and two of the guards
 * were proven to be theatre by fire-testing: the copy was reverted to its old
 * wording, 32 lines deleted, and the suite stayed green.
 *
 * A source assertion can only ever say "this string appears in this file". It
 * cannot say which branch prints it, whether the branch is reachable, what the
 * rest of the sentence around it says, or whether the value interpolated into it
 * is the one that was searched. Every defect in this release lived in exactly
 * those gaps.
 *
 * WHAT IT DOES NOT CHANGE. src/index.ts still opens stdio on import unless
 * `MNEMOVERSE_MCP_NO_AUTOSTART=1` is set, which only this file sets. See the
 * comment at the bottom of src/index.ts for why the seam is an env opt-OUT
 * rather than an `import.meta.url === process.argv[1]` check.
 *
 * TWO PROPERTIES WORTH KNOWING BEFORE YOU WRITE A TEST WITH IT
 *
 * 1. Nothing reaches the network. `globalThis.fetch` is replaced for the
 *    lifetime of the harness, and `MNEMOVERSE_API_URL` points at a black-hole
 *    host, so a request that somehow escaped the stub could not reach the live
 *    API either.
 *
 * 2. An UNSTUBBED request fails the test — it does not quietly take the
 *    fall-open path. Several handlers swallow probe failures on purpose
 *    (`domainMissNote`, `unsearchedRoomsNote`), which means a forgotten stub
 *    would silently move the assertion onto the "we could not check" branch
 *    while still reading like the "there is none" branch. That is the precise
 *    confusion this release exists to end, so `callText` refuses to return a
 *    string if any request went unrouted during the call. To test a failed probe
 *    on purpose, stub it with `httpError()` or `networkDown()`.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/** Unreachable by construction: port 1 on loopback, so an escaped fetch fails
 *  fast and locally instead of finding the production API. */
export const HARNESS_API_URL = "http://127.0.0.1:1/api/v1";

/** Shaped like a real key so nothing rejects it for its format; never sent
 *  anywhere, because fetch is stubbed. */
export const HARNESS_API_KEY = "mk_live_harness_key_not_a_secret";

/** One request the server tried to make, as the stub saw it. */
export interface StubbedRequest {
  /** Uppercase HTTP verb; "GET" when apiFetch passed no method. */
  method: string;
  /** Path below the API base, e.g. "/memory/read". */
  path: string;
  /** `${method} ${path}` — the route key. */
  key: string;
  /** Parsed JSON request body, or undefined when there was none. */
  body: unknown;
  /** Full URL as fetch received it. */
  url: string;
}

const DIRECTIVE = Symbol("harness.reply");

interface Directive {
  [DIRECTIVE]: true;
  status?: number;
  text?: string;
  throws?: string;
}

/**
 * What a stub answers: a plain value is sent back as a 200 with that value as
 * the JSON body; a directive from {@link httpError} / {@link networkDown} /
 * {@link noContent} produces the corresponding failure or empty response; a
 * function is called with the request and may return either.
 */
export type RouteReply = unknown;
export type Route = RouteReply | ((req: StubbedRequest) => RouteReply | Promise<RouteReply>);

/** A non-2xx response — what `apiFetch` turns into `Mnemoverse API error N: …`. */
export function httpError(status: number, text = ""): Directive {
  return { [DIRECTIVE]: true, status, text };
}

/** A transport-level failure: fetch itself rejects, as it would offline. */
export function networkDown(message = "fetch failed"): Directive {
  return { [DIRECTIVE]: true, throws: message };
}

/** 204 No Content — the shape apiFetch defends against for DELETEs. */
export function noContent(): Directive {
  return { [DIRECTIVE]: true, status: 204 };
}

function isDirective(v: unknown): v is Directive {
  return typeof v === "object" && v !== null && DIRECTIVE in (v as object);
}

export interface Harness {
  /** The connected MCP client — for listTools() and anything else raw. */
  client: Client;
  /** Stub a route. Key is `"<METHOD> <path>"`, e.g. `"POST /memory/read"`. */
  on(key: string, reply: Route): Harness;
  /** Every request the server made since the last {@link reset}, in order. */
  calls: StubbedRequest[];
  /** Requests with no stub. A non-empty list fails the next {@link callText}. */
  unrouted: string[];
  /** The single request made to `key` — fails if there was not exactly one. */
  requestTo(key: string): StubbedRequest;
  /** Call a tool and return its text blocks joined by "\n". */
  callText(name: string, args?: Record<string, unknown>): Promise<string>;
  /** Call a tool and return the raw result, including `isError`. */
  call(name: string, args?: Record<string, unknown>): Promise<{
    isError?: unknown;
    content?: unknown;
    text: string;
  }>;
  /** Drop all routes and recorded calls. Use in `beforeEach`. */
  reset(): Harness;
  close(): Promise<void>;
}

let started: Promise<Harness> | undefined;

/**
 * Boot the server and connect a client over the SDK's in-memory transport.
 *
 * Memoised per test FILE (vitest gives each file its own module registry, so
 * each file gets its own server): calling it twice returns the same harness
 * rather than connecting a second transport to the same McpServer.
 */
export function startMemoryServer(): Promise<Harness> {
  return (started ??= boot());
}

async function boot(): Promise<Harness> {
  // Set BEFORE the dynamic import: src/index.ts reads the key and the base URL
  // into module-level constants while it evaluates, and decides whether to open
  // stdio at the same moment.
  process.env.MNEMOVERSE_MCP_NO_AUTOSTART = "1";
  process.env.MNEMOVERSE_API_KEY = HARNESS_API_KEY;
  process.env.MNEMOVERSE_API_URL = HARNESS_API_URL;

  const { server } = await import("../src/index.js");

  const routes = new Map<string, Route>();
  const calls: StubbedRequest[] = [];
  const unrouted: string[] = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : String((input as { url?: string })?.url ?? input);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.startsWith(HARNESS_API_URL)
      ? url.slice(HARNESS_API_URL.length)
      : url;
    const key = `${method} ${path}`;
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const req: StubbedRequest = { method, path, key, body, url };
    calls.push(req);

    const route = routes.get(key);
    if (route === undefined) {
      unrouted.push(key);
      // Thrown as well as recorded: some callers swallow it (that is the point
      // of the recording), but a caller that does not should fail here with a
      // message that names the missing stub.
      throw new Error(
        `[harness] no stub for ${key} — add mcp.on(${JSON.stringify(key)}, …)`,
      );
    }

    const reply = typeof route === "function" ? await route(req) : route;
    if (isDirective(reply)) {
      if (reply.throws !== undefined) throw new TypeError(reply.throws);
      const status = reply.status ?? 500;
      if (status === 204) return new Response(null, { status: 204 });
      return new Response(reply.text ?? "", { status });
    }
    return new Response(JSON.stringify(reply ?? null), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-memory-server-harness", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const textOf = (content: unknown): string =>
    (Array.isArray(content) ? content : [])
      .filter(
        (c): c is { type: "text"; text: string } =>
          typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
      )
      .map((c) => c.text)
      .join("\n");

  const harness: Harness = {
    client,
    calls,
    unrouted,
    on(key, reply) {
      routes.set(key, reply);
      return harness;
    },
    reset() {
      routes.clear();
      calls.length = 0;
      unrouted.length = 0;
      return harness;
    },
    requestTo(key) {
      const hits = calls.filter((c) => c.key === key);
      if (hits.length !== 1) {
        throw new Error(
          `[harness] expected exactly one request to ${key}, saw ${hits.length}` +
            ` (requests: ${calls.map((c) => c.key).join(", ") || "none"})`,
        );
      }
      return hits[0]!;
    },
    async call(name, args = {}) {
      const res = await client.callTool({ name, arguments: args });
      return { ...res, text: textOf(res.content) };
    },
    async callText(name, args = {}) {
      const before = unrouted.length;
      const res = await harness.call(name, args);
      const missed = unrouted.slice(before);
      if (missed.length > 0) {
        throw new Error(
          `[harness] ${name} made ${missed.length} unstubbed request(s): ` +
            `${missed.join(", ")}. An unstubbed probe takes the fall-open branch, ` +
            `which reads like the "nothing there" branch — stub it, or stub it ` +
            `with httpError()/networkDown() if the failure is the point.`,
        );
      }
      if (res.isError) {
        throw new Error(
          `[harness] ${name} returned isError — use call() if that is intended.` +
            `\n${res.text}`,
        );
      }
      return res.text;
    },
    async close() {
      globalThis.fetch = realFetch;
      await client.close();
      await server.close();
      started = undefined;
    },
  };

  return harness;
}
