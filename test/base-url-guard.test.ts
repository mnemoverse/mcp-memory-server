/**
 * The API key does not go on the wire in cleartext (#99, CWE-319).
 *
 * `MNEMOVERSE_API_URL` is a user-supplied env var and `apiFetch` used to attach
 * `X-Api-Key` to whatever it held. A typo, a copied tunnel URL, or a misread doc
 * that spells the base `http://` therefore shipped a live `mk_live_` key in
 * cleartext on every single tool call — with nothing anywhere saying so.
 *
 * IT GETS ITS OWN FILE for the same reason test/errors-keyless.test.ts does:
 * `API_URL` is read into a module-level constant while src/index.ts evaluates,
 * and the shared harness pins one URL before importing it. A guard that depends
 * on the base URL can only be tested by booting the module more than once, which
 * `vi.resetModules()` plus a dynamic import gives us — the same seam
 * test/startup.test.ts already uses.
 *
 * THE TRAP IS THE ASSERTION. Every boot replaces `globalThis.fetch` with a
 * recorder, so "refused" is not "returned an error message" — it is "no request
 * was made and no key was seen". A guard that produced the right sentence AFTER
 * calling fetch would still have leaked the key, and would still pass a test
 * that only read the sentence.
 *
 * WHY THE LOOPBACK EXCEPTION IS SPELLED OUT HOST BY HOST. `http://localhost`,
 * `http://127.0.0.1` and `http://[::1]` are legitimate (a self-hosted engine,
 * this repo's own test harness), so the guard cannot simply demand https. The
 * cheap way to write that exception is a prefix test on the string — and
 * `http://localhost.evil.example` passes a prefix test while resolving to
 * somebody else's server. The hostname cases below exist to pin the
 * literal-host comparison that closes it.
 *
 * THE IPv6 LITERAL IS COMPARED WITH ITS BRACKETS ON. `new URL("http://[::1]")`
 * reports `hostname` as `"[::1]"`, brackets included — not `"::1"` — so the
 * comparison in src/index.ts must carry them, and the rows below are what says
 * so if anyone "tidies" them away.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/** Shaped like a real key so nothing rejects it for its format. Never sent
 *  anywhere: fetch is replaced before the module is imported. */
const KEY = "mk_live_base_url_guard_not_a_secret";

interface Booted {
  call(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ isError?: unknown; text: string }>;
  /** Tools the server advertises — introspection must survive a refused URL. */
  toolNames(): Promise<string[]>;
  /** Every URL that reached fetch. Empty means the guard fired first. */
  reached: string[];
  /** Every `X-Api-Key` fetch saw. MUST stay empty for a refused base URL. */
  keysOnTheWire: string[];
  close(): Promise<void>;
}

let booted: Booted | undefined;

afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

/** Boot src/index.ts fresh against `apiUrl`, with fetch recorded rather than
 *  performed. */
async function bootWith(apiUrl: string): Promise<Booted> {
  vi.resetModules();
  process.env.MNEMOVERSE_MCP_NO_AUTOSTART = "1";
  process.env.MNEMOVERSE_API_KEY = KEY;
  process.env.MNEMOVERSE_API_URL = apiUrl;

  const reached: string[] = [];
  const keysOnTheWire: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    reached.push(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const key = headers["X-Api-Key"] ?? headers["x-api-key"];
    if (key !== undefined) keysOnTheWire.push(key);
    return new Response(JSON.stringify({ stored: true, atom_id: "a", importance: 0.9 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const { server } = await import("../src/index.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "base-url-guard", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const textOf = (content: unknown): string =>
    (Array.isArray(content) ? content : [])
      .filter(
        (c): c is { type: "text"; text: string } =>
          typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
      )
      .map((c) => c.text)
      .join("\n");

  booted = {
    reached,
    keysOnTheWire,
    async call(name, args = {}) {
      const res = await client.callTool({ name, arguments: args });
      return { isError: res.isError, text: textOf(res.content) };
    },
    async toolNames() {
      return (await client.listTools()).tools.map((t) => t.name);
    },
    async close() {
      globalThis.fetch = realFetch;
      await client.close();
      await server.close();
    },
  };
  return booted;
}

// ---------------------------------------------------------------------------

/** Base URLs that must never carry the key, and why each one is here. */
const REFUSED: ReadonlyArray<readonly [label: string, url: string]> = [
  ["plain http to a public host", "http://evil.example/api/v1"],
  // A prefix test on "http://localhost" says yes to this. A hostname
  // comparison says no. That difference is the whole exception.
  ["a host that merely BEGINS with localhost", "http://localhost.evil.example/api/v1"],
  ["a host that merely begins with the loopback IP", "http://127.0.0.1.evil.example/api/v1"],
  // Same trick from the other end — a suffix test would say yes. RFC 6761 does
  // ask resolvers to keep `*.localhost` on loopback, but "should" is not
  // "does", and this client is not the place to gamble a live key on which
  // resolver the user has.
  ["a subdomain of localhost", "http://evil.localhost/api/v1"],
  // Credentials in the base URL are the case where a leak costs most, and the
  // case where echoing the URL back at the model would itself be the leak.
  ["http with credentials in the URL", "http://user:hunter2@evil.example/api/v1"],
  // The loopback exception is for http, not for "anything aimed at loopback".
  ["a non-http scheme aimed at loopback", "ftp://localhost/api/v1"],
  // Not a URL at all: the client cannot tell whether this would be safe, and
  // "cannot tell" is not permission.
  ["something that is not a URL", "core.mnemoverse.com/api/v1"],
  // IPv6 loopback is exempt (see ALLOWED below) — but only as the address.
  // Here `[::1]` is USERINFO and the host is `evil.example`; a guard that
  // matched on the raw string rather than `hostname` would send the key there.
  ["a URL where [::1] is only the userinfo", "http://[::1]@evil.example/api/v1"],
  // Any other IPv6 address is somebody else's machine, reachable or not.
  ["an IPv6 address that is not loopback", "http://[::2]:8100/api/v1"],
  // The exemption is scheme-bound for IPv6 exactly as it is for localhost.
  ["a non-http scheme aimed at IPv6 loopback", "ftp://[::1]/api/v1"],
  // The IPv6 twin of `localhost.evil.example`. WHATWG rejects a bracketed host
  // with anything appended, so this lands in the cannot-parse branch instead of
  // the scheme branch — a different sentence, the same refusal, and this row is
  // here so a future parser change cannot turn it into an exemption unnoticed.
  [
    "a host that merely begins with the IPv6 loopback literal",
    "http://[::1].evil.example/api/v1",
  ],
  // IPv4-mapped loopback does reach 127.0.0.1, and it is still refused: `URL`
  // normalises it to `[::ffff:7f00:1]`, and the exemption is three literal
  // spellings, not every address that happens to route home. Deliberate scope,
  // not an oversight — widening it is a decision, and decisions get a row.
  [
    "IPv4-mapped loopback, which is not one of the three literals",
    "http://[::ffff:127.0.0.1]:8100/api/v1",
  ],
];

describe("a base URL that would put the key in cleartext is refused before fetch", () => {
  it.each(REFUSED)("%s — no request, no key", async (_label, url) => {
    const mcp = await bootWith(url);

    const res = await mcp.call("memory_write", { content: "x" });

    expect(res.isError).toBe(true);
    // The point of the whole change: the refusal happens BEFORE the request.
    expect(mcp.reached).toEqual([]);
    expect(mcp.keysOnTheWire).toEqual([]);
  });

  it("says what is wrong, whose problem it is, and what to change", async () => {
    const mcp = await bootWith("http://evil.example/api/v1");

    const res = await mcp.call("memory_write", { content: "x" });

    // Attributable, like every other message this server produces.
    expect(res.text.startsWith("Mnemoverse: ")).toBe(true);
    expect(res.text).toContain("MNEMOVERSE_API_URL");
    expect(res.text).toContain("https://");
    // The user's own local engine is a legitimate reason to be on http, and the
    // message has to say which spellings of it survive — otherwise a self-hoster
    // reads this as "Mnemoverse refuses to talk to my server".
    expect(res.text).toContain("http://localhost");
    expect(res.text).toContain("http://127.0.0.1");
    // Added with the IPv6 exemption: a self-hoster on `[::1]` who is not told
    // their address is legal reads this as "Mnemoverse refuses my server".
    expect(res.text).toContain("http://[::1]");
    // The count in the sentence is part of the sentence. It said "two" while
    // three hosts were accepted for exactly as long as nobody checked.
    expect(res.text).toContain("the only three plain-http hosts");
    expect(res.text).toContain("Do not retry");
    // The wrong causes this must never suggest: nothing was rejected and
    // nothing was unreachable — no request was made at all.
    expect(res.text).not.toContain("rejected");
    expect(res.text).not.toContain("connectivity");
  });

  it("does not echo the base URL back — that is where the credentials are", async () => {
    // src/errors.ts keeps the full URL out of every message it builds, on the
    // stated grounds that the base can carry credentials. A guard whose whole
    // subject IS the base URL is the one place most tempted to quote it.
    const mcp = await bootWith("http://user:hunter2@evil.example/api/v1");

    const res = await mcp.call("memory_write", { content: "x" });

    expect(res.text).not.toContain("hunter2");
    expect(res.text).not.toContain("evil.example");
  });

  it("answers the same way for every tool", async () => {
    const mcp = await bootWith("http://evil.example/api/v1");

    for (const [tool, args] of [
      ["memory_read", { query: "x" }],
      ["memory_write", { content: "x" }],
      ["memory_stats", {}],
      ["memory_list_rooms", {}],
      ["vault_list", {}],
    ] as const) {
      const res = await mcp.call(tool, args);
      expect(res.isError, tool).toBe(true);
      expect(res.text, tool).toContain("MNEMOVERSE_API_URL");
    }
    expect(mcp.reached).toEqual([]);
    expect(mcp.keysOnTheWire).toEqual([]);
  });

  it("tools still LIST — a bad base URL must not break introspection", async () => {
    // Same property the keyless path is held to: registries boot this server to
    // enumerate its tools, and a guard that moved the failure to startup or to
    // tools/list would break that for everyone who set the variable wrong.
    const mcp = await bootWith("http://evil.example/api/v1");

    expect(await mcp.toolNames()).toContain("memory_write");
  });
});

// ---------------------------------------------------------------------------

/** Base URLs that must keep working. A guard that breaks these is worse than
 *  the hole it closes: self-hosting and this repo's own harness live here. */
const ALLOWED: ReadonlyArray<readonly [label: string, url: string]> = [
  ["the production default", "https://core.mnemoverse.com/api/v1"],
  ["https to any other host — the scheme is what is policed", "https://example.test/api/v1"],
  ["a local engine by name", "http://localhost:8100/api/v1"],
  ["a local engine by loopback IP", "http://127.0.0.1:8100/api/v1"],
  // IPv6 loopback: `http://[::1]:8100` was refused until this change, and a
  // self-hoster whose engine binds `::1` had to respell it as `localhost`.
  ["a local engine on IPv6 loopback", "http://[::1]:8100/api/v1"],
  // `URL` compresses the long form to `[::1]` before the guard sees the
  // hostname, so one literal comparison covers both spellings — and the day it
  // stops doing that, this row goes red rather than a self-hoster's setup.
  ["the same engine spelled out in full", "http://[0:0:0:0:0:0:0:1]:8100/api/v1"],
  // Exactly what test/harness.ts pins. If this row goes red the whole suite is
  // about to, and this is the file that says why.
  ["the harness's own black-hole URL", "http://127.0.0.1:1/api/v1"],
];

describe("the URLs that must keep working", () => {
  it.each(ALLOWED)("%s — the request goes out, with the key", async (_label, url) => {
    const mcp = await bootWith(url);

    const res = await mcp.call("memory_write", { content: "x" });

    expect(res.isError).toBeFalsy();
    expect(mcp.reached).toEqual([`${url}/memory/write`]);
    expect(mcp.keysOnTheWire).toEqual([KEY]);
  });
});
