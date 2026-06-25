// OAuth 2.1 (authorization-code + PKCE, loopback redirect) for the stdio server.
//
// WHY: the package used to REQUIRE a pasted `MNEMOVERSE_API_KEY`. This module
// makes it keyless — on the first tool call without a key, it opens the user's
// browser to sign in at auth.mnemoverse.com, catches the redirect on a loopback
// port (RFC 8252), exchanges the code for tokens with PKCE, and caches them in
// ~/.mnemoverse/tokens.json (refreshed silently thereafter). The API key stays
// supported as a fallback (CI, headless, self-host).
//
// AS REQUIREMENT (auth.mnemoverse.com / better-auth): a PUBLIC OAuth client
// (default id `mnemoverse-cli`) must be registered with a loopback redirect URI
// pattern (http://127.0.0.1:*/callback) allowed. The hosted AS currently
// host-allowlists DCR to claude.ai/claude.com, so this client must be
// pre-registered server-side; the device_authorization grant is NOT offered
// (well-known shows only authorization_code + refresh_token), which is why we
// use the loopback flow rather than RFC 8628 device code.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const AUTH_BASE =
  process.env.MNEMOVERSE_AUTH_URL || "https://auth.mnemoverse.com/api/auth";
const CLIENT_ID = process.env.MNEMOVERSE_OAUTH_CLIENT_ID || "mnemoverse-cli";
const SCOPE = "openid profile email memory:read memory:write offline_access";
const TOKEN_DIR = join(homedir(), ".mnemoverse");
const TOKEN_FILE = join(TOKEN_DIR, "tokens.json");
// Refresh a little before real expiry to avoid racing the clock.
const EXPIRY_SKEW_MS = 60_000;
// Give the human time to complete the browser sign-in before giving up.
const AUTH_TIMEOUT_MS =
  Number(process.env.MNEMOVERSE_AUTH_TIMEOUT_MS) || 5 * 60_000;

const DONE_HTML =
  "<html><body style='font-family:sans-serif'>Mnemoverse: sign-in complete — you can close this tab.</body></html>";
const FAIL_HTML =
  "<html><body style='font-family:sans-serif'>Mnemoverse: sign-in could not be verified — you can close this tab and try again.</body></html>";

interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
}

export function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Endpoints from the discovery document are handed to `fetch()` AND to the OS
 * browser launcher, so they must be trustworthy. Require https everywhere; allow
 * http only for a loopback dev AS (127.0.0.1 / localhost). This blocks a
 * poisoned or MITM'd discovery doc — or a hostile MNEMOVERSE_AUTH_URL — from
 * redirecting the flow to an attacker origin or smuggling shell metacharacters.
 */
export function assertSafeEndpoint(u: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error(`OAuth discovery ${name} is not a valid URL`);
  }
  const loopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error(
      `OAuth discovery ${name} must be https (got ${parsed.protocol}//${parsed.hostname})`,
    );
  }
  return u;
}

// In-process cache so a hot stdio server doesn't readFileSync on every tool call.
let memTokens: Tokens | null = null;

function loadTokens(): Tokens | null {
  if (memTokens) return memTokens;
  try {
    memTokens = JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as Tokens;
    return memTokens;
  } catch {
    return null;
  }
}

function saveTokens(t: Tokens): void {
  // 0o700 dir + 0o600 file: tokens are secrets, kept owner-only where the OS
  // honors POSIX modes. On Windows the mode is largely ignored — the file then
  // relies on the user-profile ACL (recommend full-disk encryption; see README).
  mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  try {
    if (platform() !== "win32") chmodSync(TOKEN_DIR, 0o700);
  } catch {
    /* best effort — tighten a pre-existing loose dir; ignore if not permitted */
  }
  writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
  memTokens = t;
}

let discoveryCache: Discovery | null = null;
async function discover(): Promise<Discovery> {
  if (discoveryCache) return discoveryCache;
  // Validate the (user-overridable) base before fetching from it, so a hostile
  // MNEMOVERSE_AUTH_URL can't point discovery at a non-https origin.
  assertSafeEndpoint(AUTH_BASE, "MNEMOVERSE_AUTH_URL");
  const res = await fetch(`${AUTH_BASE}/.well-known/oauth-authorization-server`);
  if (!res.ok) {
    throw new Error(`OAuth discovery failed (${res.status}) at ${AUTH_BASE}`);
  }
  const meta = (await res.json()) as Discovery;
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new Error("OAuth discovery missing authorization/token endpoint");
  }
  assertSafeEndpoint(meta.authorization_endpoint, "authorization_endpoint");
  assertSafeEndpoint(meta.token_endpoint, "token_endpoint");
  discoveryCache = meta;
  return meta;
}

/**
 * Build the OS browser-launch command WITHOUT a shell, so the URL (with its '&'
 * query separators and %xx escapes) is passed as a single argv element and is
 * never tokenized. The old `cmd /c start "" <url>` truncated the URL at the
 * first '&' on Windows AND let `&command` segments execute — a functional break
 * plus a local command-injection vector. `rundll32 url.dll,FileProtocolHandler`
 * receives the URL as a single argv element with NO shell involved; the auth URL
 * is percent-encoded (no spaces or shell metacharacters), so it reaches the
 * default handler intact.
 */
export function browserCommand(
  p: NodeJS.Platform,
  url: string,
): { cmd: string; args: string[] } {
  if (p === "win32") {
    return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  }
  if (p === "darwin") return { cmd: "open", args: [url] };
  return { cmd: "xdg-open", args: [url] };
}

function openBrowser(url: string): void {
  const { cmd, args } = browserCommand(platform(), url);
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* the URL is also printed to stderr as a fallback */
  }
}

/**
 * Interactive browser sign-in is only viable when a human + browser are present.
 * In CI / headless, skip it and fail fast with an actionable message rather than
 * hang for AUTH_TIMEOUT_MS. NB: a stdio MCP server's streams are pipes (not
 * TTYs) even under Claude Desktop, so we gate on explicit env — NOT `isTTY`,
 * which would false-negative on the common desktop case.
 */
function browserSignInAvailable(): boolean {
  if (process.env.MNEMOVERSE_NO_BROWSER) return false;
  if (process.env.CI) return false;
  return true;
}

async function exchange(
  body: Record<string, string>,
  tokenEndpoint: string,
): Promise<Tokens> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    // Do not splice the raw upstream body into an error that reaches the MCP
    // client/logs (info-disclosure / log-injection surface). Read it only to
    // detect the well-known invalid_client case, and bound its length.
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    if (/invalid_client/i.test(detail)) {
      throw new Error(
        `OAuth client "${CLIENT_ID}" is not registered on the authorization ` +
          `server (invalid_client). Keyless sign-in needs this public client ` +
          `registered server-side. For now, set MNEMOVERSE_API_KEY — free key ` +
          `at https://console.mnemoverse.com.`,
      );
    }
    process.stderr.write(`[Mnemoverse] token endpoint error (${res.status})\n`);
    throw new Error(`OAuth token exchange failed (${res.status})`);
  }
  const j = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 - EXPIRY_SKEW_MS,
  };
}

/** Run the interactive loopback authorization-code + PKCE flow. */
async function authorizeInteractive(d: Discovery): Promise<Tokens> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  return new Promise<Tokens>((resolve, reject) => {
    // Single-shot: the first VALID callback wins; everything else (forged GETs,
    // favicon probes, duplicates, late timeout) must not tear down a pending
    // legitimate sign-in or double-exchange the single-use code.
    let settled = false;
    // Captured in the listen() callback below and reused verbatim in the token
    // exchange so redirect_uri is byte-for-byte identical (OAuth exact-match) —
    // never recomputed from server.address() after close() (which can be null).
    let redirectUri = "";

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      if (settled) {
        res.writeHead(200, { "Content-Type": "text/html" }).end(DONE_HTML);
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const host = (req.headers.host || "").split(":")[0];
      const hostOk = host === "127.0.0.1" || host === "localhost";

      // Validate BEFORE any teardown. An invalid/forged request gets a 400 and
      // is otherwise IGNORED, so the real redirect can still arrive and win.
      if (!code || returnedState !== state || !hostOk) {
        res.writeHead(400, { "Content-Type": "text/html" }).end(FAIL_HTML);
        return;
      }

      settled = true;
      res.writeHead(200, { "Content-Type": "text/html" }).end(DONE_HTML);
      server.close();
      clearTimeout(timer);
      exchange(
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: CLIENT_ID,
          code_verifier: verifier,
        },
        d.token_endpoint,
      ).then(resolve, reject);
    });

    // A listen/socket failure (EADDRINUSE, EACCES, EMFILE, …) emits 'error';
    // without this handler it would be unhandled and the Promise would hang.
    server.on("error", (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* already closing */
      }
      reject(new Error(`OAuth loopback server failed: ${e.message}`));
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        server.close();
      } catch {
        /* already closing */
      }
      reject(new Error("OAuth sign-in timed out — re-run the tool to try again"));
    }, AUTH_TIMEOUT_MS);

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl =
        `${d.authorization_endpoint}?` +
        new URLSearchParams({
          response_type: "code",
          client_id: CLIENT_ID,
          redirect_uri: redirectUri,
          scope: SCOPE,
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString();
      // stderr (not stdout — stdout is the MCP JSON-RPC channel). Fallback-first
      // wording: many stdio clients don't surface server stderr to the user, so
      // the printed URL is the manual escape hatch if the browser doesn't open.
      process.stderr.write(
        `\n[Mnemoverse] Sign in to connect memory. If your browser doesn't ` +
          `open automatically, paste this URL into it:\n${authUrl}\n\n`,
      );
      openBrowser(authUrl);
    });
  });
}

// Dedupe concurrent cold-cache sign-ins: parallel first tool calls share ONE
// loopback server + browser tab + token write instead of racing N of them.
let inflight: Promise<string> | null = null;

/**
 * Return a valid OAuth access token, signing in or refreshing as needed.
 * Cached → refreshed → interactive, in that order.
 */
export async function getAccessToken(): Promise<string> {
  const cached = loadTokens();
  if (cached && cached.expires_at > Date.now()) {
    return cached.access_token;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const d = await discover();

    if (cached?.refresh_token) {
      try {
        const refreshed = await exchange(
          {
            grant_type: "refresh_token",
            refresh_token: cached.refresh_token,
            client_id: CLIENT_ID,
          },
          d.token_endpoint,
        );
        // Some AS rotate refresh tokens; keep the old one if none is returned.
        if (!refreshed.refresh_token)
          refreshed.refresh_token = cached.refresh_token;
        saveTokens(refreshed);
        return refreshed.access_token;
      } catch {
        // fall through to interactive sign-in
      }
    }

    if (!browserSignInAvailable()) {
      throw new Error(
        "No API key set and interactive browser sign-in is unavailable " +
          "(CI/headless). Set MNEMOVERSE_API_KEY — free key at " +
          "https://console.mnemoverse.com.",
      );
    }

    const fresh = await authorizeInteractive(d);
    saveTokens(fresh);
    return fresh.access_token;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
