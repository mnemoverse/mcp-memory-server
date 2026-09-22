#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_INSTRUCTIONS } from "./teaching.js";
import { refusePlaceholderKey } from "./requests.js";
import { registerMemoryTools } from "./tools.js";
import { registerMemoryPrompts } from "./prompts.js";
import { registerMemoryResources } from "./resources.js";
// Every non-2xx becomes an instruction to the calling model instead of a raw
// wire echo — see the header of src/errors.ts for why, and for what each status
// actually means in this engine. So does a 2xx whose body this client cannot
// parse, which is a third case and not a variant of either of the other two.
import { ApiError, NetworkError, UnreadableBodyError } from "./errors.js";

// Version is read at runtime from package.json so there is exactly one place
// to bump on each release. Works both from `dist/` during local dev and from
// `node_modules/@mnemoverse/mcp-memory-server/dist/` after an npm install.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/** Where the key goes when the user names no host. Referenced by the base-URL
 *  refusal below, which has to tell them what to set it back to. */
const DEFAULT_API_URL = "https://core.mnemoverse.com/api/v1";

const API_URL = process.env.MNEMOVERSE_API_URL || DEFAULT_API_URL;
const API_KEY = process.env.MNEMOVERSE_API_KEY || "";

// The API key is validated lazily — inside apiFetch, on the first tool call —
// rather than at startup. This lets the server START WITHOUT a key so that
// `tools/list` and other introspection work key-free. MCP directories and
// registries (e.g. Glama) boot the server to enumerate and score its tools,
// and clients may browse capabilities before sign-in; a startup exit on a
// missing key blocks all of that. A tool *invocation* without a key returns a
// clear, actionable error instead (see apiFetch).

/**
 * A base URL the key may not go to, spelled for each of its two readers.
 *
 * They are computed together, from one parse, so they cannot come to disagree
 * about why the call was refused — but they are NOT the same sentence, because
 * the readers differ. A tool result is read by a MODEL and is written as
 * instructions about the user ("tell them to…"); a startup line is read by the
 * USER in their client's connection log and addresses them directly.
 */
interface BaseUrlRefusal {
  /** What a tool CALL answers instead of running. */
  toolCall: string;
  /** The one line stderr gets at startup, in place of the key probe. */
  startupLog: string;
}

/**
 * Is `MNEMOVERSE_API_URL` an address this client may attach the API key to —
 * and if not, what does the user have to change (#99, CWE-319)?
 *
 * `apiFetch` attaches `X-Api-Key` to whatever this variable holds. Until this
 * check existed, a base URL spelled `http://` — a typo, a copied tunnel address,
 * a misread doc — put a live `mk_live_` key in cleartext on every tool call, on
 * every hop between the user and that host, with nothing anywhere saying so.
 * The key is the whole account: it reads and writes that user's memory.
 *
 * THREE HOSTS ARE EXEMPT, AND ONLY AS LITERAL HOSTNAMES. `http://localhost`,
 * `http://127.0.0.1` and `http://[::1]` are legitimate — a self-hosted engine,
 * this repo's own test harness — and a guard that demanded https unconditionally
 * would break them. The comparison is against `URL.hostname`, NOT a prefix or
 * suffix of the raw string, because `http://localhost.evil.example` passes a
 * prefix test and `http://evil.localhost` passes a suffix test while both
 * resolve to somebody else's server. The exemption is also scheme-bound —
 * `ftp://localhost` is refused — since "aimed at loopback" is not by itself a
 * reason to trust a transport.
 *
 * THE IPv6 LITERAL CARRIES ITS BRACKETS. `new URL("http://[::1]:8100")` reports
 * `hostname` as `"[::1]"` — brackets included, not `"::1"` — so that is what the
 * comparison holds, and test/base-url-guard.test.ts pins both spellings a user
 * can type: the parser compresses `[0:0:0:0:0:0:0:1]` to `[::1]` before this
 * function sees it, so one literal covers the long form too.
 *
 * WHAT IS STILL REFUSED, AND ON PURPOSE. `host.docker.internal` is NOT loopback
 * and is not exempt: it resolves through the container's resolver to an address
 * on the host network, so the packet — and the key — leaves the container before
 * anything knows where it lands. "Aimed at my own machine" is a claim about
 * intent; the exemption is about the wire. `[::ffff:127.0.0.1]` is refused for
 * a smaller reason: it does reach 127.0.0.1, but it is a fourth spelling of an
 * address that already has three legal ones, and widening an exemption that
 * protects a live key is a decision, not a convenience.
 *
 * RETURNS A STRING RATHER THAN THROWING, and is called at import rather than
 * on each request, because a throw at import would take the server down before
 * `tools/list` — the one thing that is documented to work without any config at
 * all (registries boot this server to enumerate its tools). The refusal has to
 * land where the keyless refusal lands: inside a tool CALL.
 *
 * THE MESSAGE NEVER QUOTES THE URL, only its scheme. src/errors.ts keeps the
 * base URL out of every message it builds on the stated grounds that the base
 * can carry credentials — `http://user:pass@host` is exactly the case this guard
 * fires on, so the one message whose subject IS the base URL is also the one
 * most likely to leak it into a model's context and a client's logs. A scheme
 * is safe to interpolate for a second reason: the URL parser restricts it to
 * `[a-z0-9+.-]`, so it cannot carry a newline and open its own paragraph in
 * this file's instruction voice.
 */
function refuseInsecureBaseUrl(raw: string): BaseUrlRefusal | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      toolCall:
        "Mnemoverse: this tool did not run, because MNEMOVERSE_API_URL is not " +
        "a URL this client can parse — so it cannot tell whether sending the " +
        "API key to it would expose the key, and it will not guess. Nothing " +
        "was sent. This is the user's configuration: their key, their network " +
        "and the service are all fine. Tell them to set MNEMOVERSE_API_URL to " +
        "a complete https:// URL including the scheme and the path — the " +
        `default is ${DEFAULT_API_URL} — or to unset it and use that default. ` +
        "A local engine is the one exception and must be addressed as " +
        "http://localhost, http://127.0.0.1 or http://[::1]. Do not retry " +
        "until it is changed; every memory tool will fail the same way " +
        "until then.",
      startupLog:
        "Mnemoverse: startup key check SKIPPED, and nothing was sent — " +
        "MNEMOVERSE_API_URL is not a URL this server can parse, so it cannot " +
        "tell whether sending your API key over it would expose it. Set it to " +
        `a complete https:// URL such as ${DEFAULT_API_URL}, or unset it to ` +
        "use that default. Every memory tool will fail until it is changed.",
    };
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    // Brackets included: that is what `URL.hostname` reports for an IPv6 host.
    url.hostname === "[::1]";
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) {
    return undefined;
  }
  return {
    toolCall:
      "Mnemoverse: this tool did not run, because MNEMOVERSE_API_URL does not " +
      `address the API over https — its scheme is ${url.protocol}// — and ` +
      "sending the API key to it would put a live mk_live_ key on the wire in " +
      "cleartext, readable by anything on the path. Nothing was sent: this " +
      "client refuses the call instead. This is the user's configuration, not " +
      "a fault of the key, the network or the service. Tell them to change " +
      "MNEMOVERSE_API_URL to the https:// form of the same host — the default " +
      `is ${DEFAULT_API_URL} — or, if they are deliberately running the ` +
      "engine on their own machine, to address it as http://localhost, " +
      "http://127.0.0.1 or http://[::1] — the only three plain-http hosts " +
      "this client accepts. Do not retry until it is changed; every memory " +
      "tool will fail the same way until then.",
    startupLog:
      "Mnemoverse: startup key check SKIPPED, and nothing was sent — " +
      `MNEMOVERSE_API_URL has the scheme ${url.protocol}// rather than ` +
      "https://, and this server will not put your API key on the wire in " +
      `cleartext. Set it to ${DEFAULT_API_URL}, or to http://localhost, ` +
      "http://127.0.0.1 or http://[::1] if you run the engine yourself. " +
      "Every memory tool will fail until it is changed.",
  };
}

/** The verdict on this process's base URL, computed once. `undefined` means the
 *  key may go out; anything else is what each surface says instead. */
const BASE_URL_REFUSAL = refuseInsecureBaseUrl(API_URL);

/**
 * The verdict on this process's API key, computed once next to
 * BASE_URL_REFUSAL because both are config-only guards checked at the same
 * two call sites below (apiFetch, the startup probe) before anything is
 * sent. `undefined` means the key is not certainly a docs placeholder; it
 * may still be wrong, but that is the engine's 401 to diagnose, not a guess
 * this client can make from shape alone. See `refusePlaceholderKey` in
 * src/requests.ts for exactly what counts as "certainly".
 */
const PLACEHOLDER_KEY_REFUSAL = refusePlaceholderKey(API_KEY);

/**
 * Fetch from the Mnemoverse core API with authentication.
 *
 * Generic so call sites can declare the expected response shape:
 *
 *     const r = await apiFetch<{ stored: boolean; atom_id: string }>("/memory/write", { ... });
 *
 * Handles 204 No Content and empty bodies defensively — FastAPI DELETE
 * handlers may switch to 204 in the future even though today they return
 * a JSON body.
 *
 * @throws {@link ApiError} on non-2xx — whose message is the agent-facing
 * explanation from src/errors.ts, with the raw body kept after it. The MCP SDK
 * turns a thrown Error into `{isError: true, content: [{type: "text", text:
 * error.message}]}`, so this message IS what the calling model reads; that is
 * why it is written as instructions rather than as a wire dump.
 */
async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  if (!API_KEY) {
    // The one failure that needs no request to diagnose — and the only one
    // where the fix is "set the variable" rather than "replace its value".
    // Kept distinct from the 401 sentence for exactly that reason.
    throw new Error(
      "Mnemoverse: no API key is configured, so this tool cannot run. Tell the " +
        "user to set MNEMOVERSE_API_KEY in their MCP client config — a free key " +
        "takes about 30 seconds at https://console.mnemoverse.com/dashboard/keys " +
        "and starts with mk_live_. Do not retry until it is set; every memory " +
        "tool will fail the same way until then.",
    );
  }
  if (PLACEHOLDER_KEY_REFUSAL !== undefined) {
    // After the empty-key check, for the same reason that one runs first:
    // "set the variable" and "replace the placeholder" are different fixes,
    // and a key that is present but certainly a docs example gets its own
    // sentence rather than the emptiness one. Decided from CONFIGURATION
    // alone, exactly like BASE_URL_REFUSAL right below, so it belongs here
    // and not in a diagnosis of a response this call never sends.
    throw new Error(PLACEHOLDER_KEY_REFUSAL.toolCall);
  }
  if (BASE_URL_REFUSAL !== undefined) {
    // Alongside the key check, and after it: with no key configured there is
    // nothing to expose, and "set the variable" is the more useful first thing
    // to tell someone who has set neither. Both are decided from CONFIGURATION
    // alone, which is why both belong here rather than in a diagnosis of the
    // response — a guard that fired after fetch would print the right sentence
    // about a key it had already put on the wire.
    throw new Error(BASE_URL_REFUSAL.toolCall);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      // AFTER the spread, so no call site can opt out of it. `fetch` defaults to
      // "follow", and Node re-sends request headers to the redirect target: the
      // WHATWG rules strip Authorization, Cookie and Proxy-Authorization when
      // the origin changes and say nothing about a custom header, so
      // `X-Api-Key` rides along to whoever answered (#99, CWE-200). This API
      // serves one stable base path and never redirects legitimately, so the
      // only traffic this refuses is an exfiltration path. The resulting
      // rejection is named by explainNetworkFailure rather than left to look
      // like a dead host.
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": API_KEY,
        ...((options.headers as Record<string, string>) || {}),
      },
    });
  } catch (cause) {
    // `TypeError: fetch failed` is what a model used to read here, which is as
    // uninstructive as the raw 401 body this change is about. Every existing
    // caller that swallows a failure (the scope probes, the empty-read stats
    // call) catches without inspecting the type, so wrapping changes nothing
    // for them — it only changes what surfaces when nobody catches.
    throw new NetworkError(method, path, cause);
  }

  if (!res.ok) {
    // `fetch()` resolves once HEADERS arrive; a connection reset during the
    // body read rejects HERE, not in the catch above, and used to surface as
    // a raw undici TypeError (Copilot, #93).
    //
    // It is NOT the same failure as the catch above, and calling it one threw
    // the status away: a 502 whose body died mid-stream was reported as "the
    // memory service could not be reached at all… before any HTTP response
    // came back", about a response whose status we are holding. The status is
    // the most actionable thing this failure has, so it goes in the sentence.
    let text: string;
    try {
      text = await res.text();
    } catch (cause) {
      throw new UnreadableBodyError({ status: res.status, method, path, cause });
    }
    throw new ApiError({
      status: res.status,
      body: text,
      method,
      path,
      // Only the rate-limit middleware sets it, and only on the 429 that
      // waiting actually clears — so its PRESENCE is evidence, not decoration.
      retryAfter: res.headers.get("retry-after"),
    });
  }

  // 204 No Content or empty body — return an empty object cast as T so
  // call sites using optional chaining still work without crashing.
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return {} as T;
  }

  // A 2xx WHOSE BODY THIS CLIENT CANNOT READ. Read the text first and parse it
  // second, rather than `res.json()`, for one reason: `res.json()` consumes the
  // stream, so when it throws there is nothing left to quote — and the bytes
  // are the evidence. A captive portal's sign-in page, an SPA shell served with
  // 200 text/html, a MITM proxy's notice, or a JSON body that stopped mid-write
  // all land here, and the first line of any of them identifies the culprit.
  //
  // Both throws used to be NetworkError, which asserts that NOTHING answered —
  // "could not be reached at all… before any HTTP response came back… a
  // connectivity or DNS problem" — while a 200 sat in this very function's
  // hand, and the Raw detail below it quoted a SyntaxError out of the body it
  // had just called nonexistent. Sending a user to debug wifi while a portal
  // answers every request is the confident wrong cause src/errors.ts exists to
  // remove. A real `fetch()` rejection above keeps that wording; this does not.
  let body: string;
  try {
    body = await res.text();
  } catch (cause) {
    throw new UnreadableBodyError({ status: res.status, method, path, cause });
  }
  try {
    return JSON.parse(body) as T;
  } catch (cause) {
    throw new UnreadableBodyError({
      status: res.status,
      method,
      path,
      bodyPreview: body,
      cause,
    });
  }
}

// --- Server setup ---

// The second argument lands verbatim in the connected model's system prompt on
// clients that surface MCP instructions — it is the single highest-leverage
// teaching surface this server has. Kept in src/teaching.ts so tests can
// assert its polarity/length without booting the server.
//
// EXPORTED so a test can connect a real MCP client to this exact server over
// the SDK's in-memory transport and invoke the tools (test/harness.ts). Nothing
// on the published CLI path reads this binding — see the note at the bottom of
// the file for why the export alone is not enough, and what the CLI still does.
export const server = new McpServer(
  {
    name: "mnemoverse-memory",
    version: pkg.version,
  },
  { instructions: SERVER_INSTRUCTIONS },
);

// The tools themselves live in src/tools.ts, shared with every other server
// that exposes Mnemoverse memory over MCP (ADR-025). This server's part is
// apiFetch above: the API key, the base URL and their refusals.
registerMemoryTools(server, { apiFetch });
// Three named entry points to those tools (src/prompts.ts); they call nothing.
registerMemoryPrompts(server);
// One saved memory by id, memory://item/{memory_id} (src/resources.ts).
registerMemoryResources(server, { apiFetch });


// --- Start ---

/**
 * Opening the stdio transport at import time is what made every user-visible
 * sentence in this file untestable: a test that imports this module to reach a
 * handler instead starts a server on the test runner's stdin/stdout. So the copy
 * was guarded by regexes over this source text — and three review rounds each
 * found false sentences a behavioural test would have caught immediately, twice
 * in a guard that turned out to be theatre.
 *
 * The seam is one boolean, and its DEFAULT is today's behaviour.
 *
 * WHY AN ENV OPT-OUT AND NOT `import.meta.url === process.argv[1]`. That
 * comparison is the usual "am I the entry point?" idiom and it is the wrong tool
 * here, because this package ships as an npm `bin`. Under `npx` — the canonical
 * install, pinned in src/configs/source.json and in every README snippet — the
 * thing on argv[1] is the generated shim, not this file; on Windows it is a
 * `.cmd`/`.ps1` wrapper, and even the POSIX shim is a symlink whose realpath
 * resolution differs between package managers. Every one of those makes the
 * comparison FALSE for a real user, and a false comparison there does not throw:
 * the process would exit 0 having started no server, and the client would report
 * a silent connection failure with nothing in the logs. That is a worse defect
 * than the one being fixed. The env var inverts the risk — it can only misfire
 * for something that deliberately sets it, and no released version reads it, so
 * no existing config can carry it.
 *
 * The check is `=== "1"`, deliberately narrow rather than truthy: the failure
 * mode of a wide check is a startup that silently does nothing, so an
 * unrecognised value must fall through to starting the server.
 *
 * BYTE-IDENTICAL CLI BEHAVIOUR: with the variable unset (or set to anything
 * other than "1"), `main()` is called exactly as before, with the same catch,
 * the same message and the same exit code. The only other change to this module
 * is the `export` on `server`, which is inert when the file is run as a program.
 */
/**
 * Startup key probe — the fix for the invisible failure mode.
 *
 * Verified live on 0.8.3: with a GARBAGE key the server completes initialize,
 * lists all twelve tools, and writes nothing to stderr — the 401 only appears
 * mid-conversation, on the first real tool call. A user who mistyped the key
 * sees a green connection and later reads the silent failure as "the product
 * does not work" (Olya's assistant, 2026-08-16).
 *
 * So: if a key IS configured, verify it once at startup with the cheapest
 * authenticated call and put the verdict on stderr, which MCP clients surface
 * in their connection logs — the place a user actually looks. Three rules:
 *
 *  - NEVER exits and NEVER blocks connect(): keyless startup is documented
 *    behaviour (registries boot the server to enumerate tools), and a network
 *    blip must not take the server down. The probe runs after connect, in the
 *    background.
 *  - 401 gets a human sentence naming the env var. Other failures (network,
 *    5xx) get a soft note — they say nothing about the key.
 *  - stderr only. stdout belongs to the MCP protocol.
 */
function probeApiKeyInBackground(): void {
  if (!API_KEY) return;
  if (PLACEHOLDER_KEY_REFUSAL !== undefined) {
    // Same reasoning as the BASE_URL_REFUSAL skip right below, for the same
    // reason it is checked first inside apiFetch: this probe is a second
    // credential-bearing call site outside apiFetch, so a config-only
    // refusal decided at import time has to be checked here too, or a docs
    // placeholder key would go out over the wire once per server start even
    // though every tool call already refuses to send it.
    console.error(PLACEHOLDER_KEY_REFUSAL.startupLog);
    return;
  }
  if (BASE_URL_REFUSAL !== undefined) {
    // THE SECOND CREDENTIAL-BEARING CALL SITE (#99). This probe predates
    // apiFetch's base-URL guard and calls `fetch` directly, so the guard does
    // not reach it — and this one fires on every server START, before any tool
    // is called. Left alone, a user whose MNEMOVERSE_API_URL is spelled
    // `http://` would leak the key by launching their editor, and the tool-call
    // guard would then dutifully refuse to leak the key it had already leaked.
    //
    // Saying nothing is not an option either: a silent server whose every tool
    // then fails is the exact invisible failure mode this probe was added to
    // end. So it reports the skip on stderr — where MCP clients surface
    // connection logs — in the user's own register.
    console.error(BASE_URL_REFUSAL.startupLog);
    return;
  }
  void (async () => {
    try {
      const res = await fetch(`${API_URL}/memory/stats`, {
        headers: { "X-Api-Key": API_KEY },
        // Same reason as apiFetch: following a redirect re-sends this header to
        // the new host (#99, CWE-200), and this request carries the key just as
        // a tool call does. The rejection lands in the catch below with every
        // other probe failure — deliberately, since the probe is fire-and-forget
        // and must never take the server down. Nothing is lost by the silence:
        // the same redirect meets the first real tool call, where
        // explainNetworkFailure names it in full.
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      // Drain the body so the connection returns to the pool immediately —
      // an unread body can hold the socket and makes the probe less "cheap"
      // than advertised (Copilot, PR #91).
      void res.body?.cancel();
      if (res.status === 401 || res.status === 403) {
        console.error(
          `Mnemoverse: API key rejected (${res.status}). ` +
            "Check MNEMOVERSE_API_KEY in your MCP client config — " +
            "tool calls will fail until it is fixed. " +
            "Keys start with mk_live_ and come from https://console.mnemoverse.com",
        );
      } else if (!res.ok) {
        console.error(
          `Mnemoverse: startup key check got HTTP ${res.status} — ` +
            "this says nothing about your key; tool calls may still work.",
        );
      }
      // 2xx: stay silent. A quiet startup is the healthy one.
    } catch {
      // Network error at startup proves nothing about the key. Say nothing:
      // a scary stderr line on a flaky hotel wifi would be a false alarm.
    }
  })();
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  probeApiKeyInBackground();
}

if (process.env.MNEMOVERSE_MCP_NO_AUTOSTART !== "1") {
  main().catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
}
