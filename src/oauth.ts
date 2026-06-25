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

import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
const AUTH_TIMEOUT_MS = 5 * 60_000;

interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadTokens(): Tokens | null {
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as Tokens;
  } catch {
    return null;
  }
}

function saveTokens(t: Tokens): void {
  mkdirSync(TOKEN_DIR, { recursive: true });
  // 0o600 — tokens are secrets; keep them owner-only where the OS honors it.
  writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
}

let discoveryCache: Discovery | null = null;
async function discover(): Promise<Discovery> {
  if (discoveryCache) return discoveryCache;
  const res = await fetch(`${AUTH_BASE}/.well-known/oauth-authorization-server`);
  if (!res.ok) {
    throw new Error(`OAuth discovery failed (${res.status}) at ${AUTH_BASE}`);
  }
  const meta = (await res.json()) as Discovery;
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new Error("OAuth discovery missing authorization/token endpoint");
  }
  discoveryCache = meta;
  return meta;
}

function openBrowser(url: string): void {
  const p = platform();
  const cmd = p === "darwin" ? "open" : p === "win32" ? "cmd" : "xdg-open";
  const args = p === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* fall back to the printed URL below */
  }
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
    throw new Error(`OAuth token exchange failed (${res.status}): ${await res.text()}`);
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
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body style='font-family:sans-serif'>Mnemoverse: sign-in complete — you can close this tab.</body></html>",
      );
      server.close();
      clearTimeout(timer);
      if (!code || returnedState !== state) {
        reject(new Error("OAuth callback missing code or state mismatch"));
        return;
      }
      const port = (server.address() as { port: number }).port;
      exchange(
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: `http://127.0.0.1:${port}/callback`,
          client_id: CLIENT_ID,
          code_verifier: verifier,
        },
        d.token_endpoint,
      ).then(resolve, reject);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("OAuth sign-in timed out — re-run the tool to try again"));
    }, AUTH_TIMEOUT_MS);

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
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
      // stderr (not stdout — stdout is the MCP JSON-RPC channel).
      process.stderr.write(
        `\n[Mnemoverse] Sign in to connect memory — opening your browser:\n${authUrl}\n\n`,
      );
      openBrowser(authUrl);
    });
  });
}

/**
 * Return a valid OAuth access token, signing in or refreshing as needed.
 * Cached → refreshed → interactive, in that order.
 */
export async function getAccessToken(): Promise<string> {
  const cached = loadTokens();
  if (cached && cached.expires_at > Date.now()) {
    return cached.access_token;
  }

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
      // Some AS rotate refresh tokens; keep the old one if a new one isn't returned.
      if (!refreshed.refresh_token) refreshed.refresh_token = cached.refresh_token;
      saveTokens(refreshed);
      return refreshed.access_token;
    } catch {
      // fall through to interactive sign-in
    }
  }

  const fresh = await authorizeInteractive(d);
  saveTokens(fresh);
  return fresh.access_token;
}
