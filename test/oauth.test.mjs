// Unit tests for the security-critical pure helpers of the keyless OAuth flow.
// Run against the COMPILED output (dist/) so we test exactly what ships.
//   npm test   ->   tsc && node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";

import { browserCommand, b64url, assertSafeEndpoint } from "../dist/oauth.js";

// The OAuth authorize URL is full of '&' query separators and %xx escapes. The
// launcher must hand it to the OS as ONE argv element — never through a shell —
// or Windows `cmd` both truncates it at the first '&' and executes `&segment`
// as a command (the local-RCE regression this replaced).
const URL_WITH_AMP =
  "https://auth.mnemoverse.com/api/auth/oauth2/authorize?response_type=code&client_id=mnemoverse-cli&state=abc&code_challenge=xYz%2D_&scope=openid%20profile";

test("browserCommand win32 uses rundll32 and passes the URL as a single argv (no cmd parsing)", () => {
  const { cmd, args } = browserCommand("win32", URL_WITH_AMP);
  assert.equal(cmd, "rundll32");
  assert.equal(args.length, 2);
  assert.equal(args[0], "url.dll,FileProtocolHandler");
  // The whole URL — every '&' and %xx intact — is one element.
  assert.equal(args[1], URL_WITH_AMP);
  assert.ok(!args.some((a) => a === "/c" || a === "start"));
});

test("browserCommand darwin uses open with the URL as the only arg", () => {
  const { cmd, args } = browserCommand("darwin", URL_WITH_AMP);
  assert.equal(cmd, "open");
  assert.deepEqual(args, [URL_WITH_AMP]);
});

test("browserCommand linux uses xdg-open with the URL as the only arg", () => {
  const { cmd, args } = browserCommand("linux", URL_WITH_AMP);
  assert.equal(cmd, "xdg-open");
  assert.deepEqual(args, [URL_WITH_AMP]);
});

test("b64url is URL-safe and unpadded", () => {
  assert.equal(b64url(Buffer.from("hi")), "aGk");
  const out = b64url(Buffer.from([251, 255, 191, 0]));
  assert.ok(!/[+/=]/.test(out), `expected no +,/,= in ${out}`);
});

test("assertSafeEndpoint accepts https and returns the url", () => {
  const u = "https://auth.mnemoverse.com/api/auth/oauth2/token";
  assert.equal(assertSafeEndpoint(u, "token_endpoint"), u);
});

test("assertSafeEndpoint allows http only for loopback (dev AS)", () => {
  assert.doesNotThrow(() =>
    assertSafeEndpoint("http://127.0.0.1:4000/token", "token_endpoint"),
  );
  assert.doesNotThrow(() =>
    assertSafeEndpoint("http://localhost:4000/token", "token_endpoint"),
  );
});

test("assertSafeEndpoint rejects http on a non-loopback host (MITM / poisoned discovery)", () => {
  assert.throws(
    () => assertSafeEndpoint("http://evil.example.com/token", "token_endpoint"),
    /must be https/,
  );
});

test("assertSafeEndpoint rejects non-http(s) schemes and junk", () => {
  assert.throws(() => assertSafeEndpoint("ftp://x/y", "authorization_endpoint"));
  assert.throws(() => assertSafeEndpoint("not a url", "authorization_endpoint"));
});
