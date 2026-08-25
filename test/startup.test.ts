/**
 * The startup gate — that making the handlers testable did not stop the CLI from
 * starting.
 *
 * This is the risk the whole harness change carries, and it is asymmetric: if
 * the seam misfires, the published `bin` exits 0 having opened no transport, and
 * the client reports a connection failure with nothing in any log. Every user of
 * every editor would hit it, and no test that only calls tools would notice —
 * the tools work fine in a server nobody started.
 *
 * So the gate is tested the same way the tools are: by importing the module and
 * observing whether a stdio transport was constructed. The transport class is
 * mocked, which is the point — a real one would seize the test runner's stdin
 * and stdout, which is the original problem.
 *
 * WHY NOT `import.meta.url === process.argv[1]`, THE USUAL IDIOM. This package
 * ships as an npm `bin`, so under `npx` — the canonical install, pinned in
 * src/configs/source.json and every README snippet — argv[1] is the generated
 * shim rather than this file; on Windows it is a `.cmd`/`.ps1` wrapper, and the
 * POSIX shim is a symlink whose realpath resolution differs between package
 * managers. Each of those makes the comparison false for a real user, silently.
 * An env opt-OUT inverts the risk: it can only misfire for something that
 * deliberately sets it, and no released version reads the name, so no existing
 * client config can be carrying it.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** Records every stdio transport the module tries to open. */
const stdio = vi.hoisted(() => ({ constructed: 0 }));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    onclose?: () => void;
    onerror?: (e: Error) => void;
    onmessage?: (m: unknown) => void;
    constructor() {
      stdio.constructed++;
    }
    async start() {}
    async send() {}
    async close() {}
  },
}));

const VAR = "MNEMOVERSE_MCP_NO_AUTOSTART";
const original = process.env[VAR];

beforeAll(() => {
  // No tool is called here, so nothing fetches; set anyway so a future addition
  // to this file cannot reach the live API.
  process.env.MNEMOVERSE_API_URL = "http://127.0.0.1:1/api/v1";
  process.env.MNEMOVERSE_API_KEY = "mk_live_startup_test";
});

afterEach(() => {
  if (original === undefined) delete process.env[VAR];
  else process.env[VAR] = original;
});

/** Import src/index.ts fresh with `VAR` set to `value`, and count transports. */
async function transportsOpenedWith(value: string | undefined): Promise<number> {
  vi.resetModules();
  stdio.constructed = 0;
  if (value === undefined) delete process.env[VAR];
  else process.env[VAR] = value;

  await import("../src/index.js");
  // `main()` is async and is deliberately not awaited by the module — let the
  // microtask queue drain before looking.
  await new Promise((resolve) => setTimeout(resolve, 0));

  return stdio.constructed;
}

// ---------------------------------------------------------------------------

/**
 * The startup key probe is a SECOND credential-bearing call site (#99).
 *
 * `probeApiKeyInBackground` calls `fetch` directly rather than through
 * `apiFetch`, so the base-URL guard and the redirect refusal added to `apiFetch`
 * do not reach it. Left alone it would send `X-Api-Key` to whatever
 * `MNEMOVERSE_API_URL` holds — in cleartext over `http://`, and onward to
 * wherever a 302 pointed — once per server start, before any tool is ever
 * called. A user whose config is wrong leaks the key by launching their editor.
 *
 * These live in THIS file rather than in test/base-url-guard.test.ts because the
 * probe only runs on the autostart path, which that file switches off, and
 * because this file already mocks the stdio transport — without that mock a real
 * one seizes the runner's stdin and stdout.
 */

/** One request the startup path made, as the trap saw it. */
interface ProbeCall {
  url: string;
  apiKey: string | undefined;
  redirect: RequestRedirect | undefined;
}

interface Startup {
  calls: ProbeCall[];
  stderr: string[];
}

const PROBE_KEY = "mk_live_probe_call_site_not_a_secret";

/** Boot the module on the AUTOSTART path against `apiUrl`, with fetch and
 *  stderr recorded rather than performed, and let the background probe settle.
 *
 *  `key` is `null` for "no key configured", NOT `undefined`: passing `undefined`
 *  for an optional parameter selects its DEFAULT, so the keyless case would
 *  silently run with a key. It did, in this file's first red run. */
async function startupWith(apiUrl: string, key: string | null = PROBE_KEY): Promise<Startup> {
  vi.resetModules();
  stdio.constructed = 0;
  delete process.env[VAR];
  process.env.MNEMOVERSE_API_URL = apiUrl;
  if (key === null) delete process.env.MNEMOVERSE_API_KEY;
  else process.env.MNEMOVERSE_API_KEY = key;

  const calls: ProbeCall[] = [];
  const stderr: string[] = [];
  const realFetch = globalThis.fetch;
  const realError = console.error;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      apiKey: headers["X-Api-Key"] ?? headers["x-api-key"],
      redirect: init?.redirect,
    });
    return new Response(JSON.stringify({ total_atoms: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  console.error = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };

  try {
    await import("../src/index.js");
    // `main()` is async and deliberately unawaited by the module, and the probe
    // itself is fire-and-forget inside it. Drain a few turns so both a
    // synchronous refusal and a completed request have landed.
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    process.env.MNEMOVERSE_API_URL = "http://127.0.0.1:1/api/v1";
    process.env.MNEMOVERSE_API_KEY = "mk_live_startup_test";
  }

  return { calls, stderr };
}

describe("the startup key probe does not leak the key either", () => {
  it("an insecure base URL: no request is made at all", async () => {
    const { calls } = await startupWith("http://evil.example/api/v1");

    // Not "made a request without the key" — made none. The probe has exactly
    // one job and it cannot be done safely against this URL.
    expect(calls).toEqual([]);
    expect(calls.filter((c) => c.apiKey !== undefined)).toEqual([]);
  });

  it("and it says on stderr that it skipped, and why", async () => {
    // stderr is where an MCP client surfaces connection logs — the place a user
    // actually looks. Silence here would mean a server that quietly does
    // nothing while every tool call fails, which is the invisible failure mode
    // the 0.8.4 probe was added to end.
    const { stderr } = await startupWith("http://evil.example/api/v1");

    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toBe(
      "Mnemoverse: startup key check SKIPPED, and nothing was sent — " +
        "MNEMOVERSE_API_URL has the scheme http:// rather than https://, and " +
        "this server will not put your API key on the wire in cleartext. Set " +
        "it to https://core.mnemoverse.com/api/v1, or to http://localhost or " +
        "http://127.0.0.1 if you run the engine yourself. Every memory tool " +
        "will fail until it is changed.",
    );
  });

  it("a URL that is not a URL is skipped too, and says so in its own words", async () => {
    const { calls, stderr } = await startupWith("core.mnemoverse.com/api/v1");

    expect(calls).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain("startup key check SKIPPED");
    expect(stderr[0]).toContain("not a URL this server can parse");
    // The scheme sentence would be a lie here — there is no parsed scheme.
    expect(stderr[0]).not.toContain("rather than https://");
  });

  it("refuses redirects, so a 302 cannot forward the key", async () => {
    // The probe is fire-and-forget and swallows its own failures, so the only
    // thing a test can pin is the instruction it hands fetch — which is the
    // thing that decides whether the key is forwarded.
    const { calls } = await startupWith("https://core.mnemoverse.com/api/v1");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.redirect).toBe("error");
  });

  it("a healthy base URL still gets probed, with the key — the fix is not a mute button", async () => {
    const { calls, stderr } = await startupWith("https://core.mnemoverse.com/api/v1");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://core.mnemoverse.com/api/v1/memory/stats");
    expect(calls[0]?.apiKey).toBe(PROBE_KEY);
    // 2xx: a quiet startup is the healthy one.
    expect(stderr).toEqual([]);
  });

  it("localhost on plain http still gets probed — self-hosting is not broken", async () => {
    const { calls, stderr } = await startupWith("http://localhost:8100/api/v1");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.apiKey).toBe(PROBE_KEY);
    expect(stderr).toEqual([]);
  });

  it("no key, no probe and no complaint — keyless startup is documented behaviour", async () => {
    const { calls, stderr } = await startupWith("http://evil.example/api/v1", null);

    expect(calls).toEqual([]);
    // Nothing to leak and nothing to check: a registry enumerating tools must
    // not be told off about a URL it will never send anything to.
    expect(stderr).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("the published CLI still starts itself", () => {
  it("opens stdio when the variable is unset — the default is unchanged", async () => {
    expect(await transportsOpenedWith(undefined)).toBe(1);
  });

  // The failure mode of a WIDE check is a startup that silently does nothing, so
  // every value except the one opt-out token must fall through to starting. These
  // are the values a person would plausibly set while meaning "yes, do start".
  it.each(["0", "false", "no", "", "true", "yes", "2"])(
    "opens stdio when the variable is %o — only the exact token opts out",
    async (value) => {
      expect(await transportsOpenedWith(value)).toBe(1);
    },
  );

  it("opens NO transport for the exact opt-out token, so tests can hold the handlers", async () => {
    expect(await transportsOpenedWith("1")).toBe(0);
  });
});
