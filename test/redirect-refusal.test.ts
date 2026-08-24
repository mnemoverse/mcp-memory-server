/**
 * A credential-bearing request does not follow a redirect (#99, CWE-200).
 *
 * `fetch` defaults to `redirect: "follow"`, and Node re-sends request headers to
 * the redirect target — the WHATWG rules strip `Authorization`, `Cookie` and
 * `Proxy-Authorization` when the origin changes, and say nothing about a custom
 * header, so `X-Api-Key` rides along. An endpoint that answers
 * `302 Location: https://attacker.example` therefore receives a live `mk_live_`
 * key, and the tool call succeeds, so nothing anywhere looks wrong.
 *
 * THIS TEST DOES NOT STUB fetch, AND THAT IS THE POINT. test/harness.ts replaces
 * `globalThis.fetch` with a recorder that returns a `Response` object — a stub
 * has no redirect handling at all, so `redirect: "error"` is inert inside it and
 * a test written there would pass with the option removed. Following a redirect
 * is undici's behaviour, so proving we do not follow one means going through
 * undici: two real `node:http` servers on loopback, ephemeral ports, and the
 * server's own fetch.
 *
 * The base URL is `http://127.0.0.1:<port>` because that is what a local server
 * can be reached at — and it is one of the two hosts the base-URL guard added in
 * the same change lets through on plain http (see test/base-url-guard.test.ts).
 * The two halves of #99 meet here.
 *
 * WHAT RED LOOKS LIKE, before the fix: the tool call SUCCEEDS (the target
 * answers 200 with a JSON body), and `targetSaw` holds one request carrying the
 * key. That is the vulnerability, executed.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const KEY = "mk_live_redirect_refusal_not_a_secret";

/** What the redirect target managed to see. Every field here is something the
 *  attacker in the CWE-200 story gets for free. */
interface Seen {
  method: string;
  url: string;
  apiKey: string | undefined;
}

const targetSaw: Seen[] = [];
let api: http.Server;
let target: http.Server;
let close: () => Promise<void>;
/** The one tool result under test — taken once, asserted from several angles. */
let result: { isError?: unknown; text: string };

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function shutdown(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

beforeAll(async () => {
  // The attacker's endpoint: answers 200 so that a followed redirect would look
  // like a perfectly successful write, and records what it was handed.
  target = http.createServer((req, res) => {
    targetSaw.push({
      method: req.method ?? "",
      url: req.url ?? "",
      apiKey: req.headers["x-api-key"] as string | undefined,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ stored: true, atom_id: "leaked", importance: 0.9 }));
  });
  const targetPort = await listen(target);

  // What MNEMOVERSE_API_URL points at: a compromised or misconfigured endpoint
  // that bounces every call somewhere else. A DIFFERENT PORT is a different
  // origin, which is exactly the cross-origin case where the spec's header
  // stripping does not cover X-Api-Key.
  api = http.createServer((_req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/steal` });
    res.end();
  });
  const apiPort = await listen(api);

  // Set BEFORE the import: src/index.ts reads both into module-level constants
  // while it evaluates.
  process.env.MNEMOVERSE_MCP_NO_AUTOSTART = "1";
  process.env.MNEMOVERSE_API_KEY = KEY;
  process.env.MNEMOVERSE_API_URL = `http://127.0.0.1:${apiPort}/api/v1`;

  const { server } = await import("../src/index.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "redirect-refusal", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const res = await client.callTool({ name: "memory_write", arguments: { content: "x" } });
  result = {
    isError: res.isError,
    text: (Array.isArray(res.content) ? res.content : [])
      .filter(
        (c): c is { type: "text"; text: string } =>
          typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
      )
      .map((c) => c.text)
      .join("\n"),
  };

  close = async () => {
    await client.close();
    await server.close();
    await shutdown(api);
    await shutdown(target);
  };
});

afterAll(async () => {
  await close();
});

describe("a 302 does not carry the API key anywhere", () => {
  it("the redirect target is never contacted at all", () => {
    // Not "was contacted without the key" — not contacted. `redirect: "error"`
    // rejects the request rather than issuing a second one, so there is no
    // second request to sanitise and nothing depends on which headers a future
    // Node decides to strip.
    expect(targetSaw).toEqual([]);
  });

  it("and specifically, it never sees the key", () => {
    // Stated separately from the line above because this is the CWE, and a
    // future change that legitimately contacts a redirect target must still
    // fail here rather than quietly re-open the leak.
    expect(targetSaw.filter((s) => s.apiKey !== undefined)).toEqual([]);
  });

  it("the call fails instead of quietly succeeding against a stranger", () => {
    // The pre-fix behaviour was a SUCCESSFUL write — the target answers 200, so
    // the user is told their memory was stored while it went to whoever
    // answered the redirect. A leak that reports success is the worst shape.
    expect(result.isError).toBe(true);
    expect(result.text).not.toContain("leaked");
  });

  it("names the redirect, so nobody debugs their wifi over a config problem", () => {
    // Without a branch of its own this lands in the generic transport failure —
    // undici reports a refused redirect as `TypeError: fetch failed`, exactly
    // like a dead host — and the message would say "connectivity or DNS
    // problem", sending the user to check a network that is working fine.
    expect(result.text.startsWith("Mnemoverse: ")).toBe(true);
    expect(result.text).toContain("redirect");
    expect(result.text).toContain("MNEMOVERSE_API_URL");
    expect(result.text).toContain("Do not retry");
    expect(result.text).not.toContain("connectivity or DNS problem");
    // And it must not blame the key, which is the one thing that is fine.
    expect(result.text).not.toContain("check their key");
  });

  it("keeps the raw transport detail for whoever has to debug it", () => {
    expect(result.text).toContain("POST /memory/write");
    expect(result.text).toContain("fetch failed");
  });
});
