/**
 * Every one-click install link this package ships is decoded the way the
 * browser and then the editor will read it, and checked for where it really
 * points.
 *
 * WHY. The README's "Add to Cursor" button used to install the local server
 * with MNEMOVERSE_API_KEY=mk_live_YOUR_KEY. Cursor then showed a green
 * connection and the full tool list, and refused the first call (core#623,
 * item 2). A base64 blob is unreadable in review, so nothing but a decode can
 * say what a button installs. The button now adds the hosted server, whose
 * sign-in Cursor runs itself, exactly as mnemoverse-portal's console button
 * does (src/lib/editor-install.ts, CURSOR_INSTALL_URL, portal#290).
 *
 * WHAT IS NOT COVERED, ON PURPOSE: docs/snippets/cursor.md still carries the
 * old placeholder button. mnemoverse-docs mirrors that partial into the
 * API-key section of /docs/api/cursor, whose prose describes that very
 * button, so it changes together with a docs PR (see
 * genCursorLocalInstallButton() in scripts/generate-configs.mjs). The README
 * is what npm renders, and the README is what this file guards.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const README = read("README.md");
const CURSOR_DEEP_LINK = read("docs/configs/cursor-deep-link.txt").trim();
const SOURCE = JSON.parse(read("src/configs/source.json")) as {
  name: string;
  remotes: { type: string; url: string }[];
};

const HOSTED_URL = SOURCE.remotes.find((r) => r.type === "streamable-http")!.url;

/** The link mnemoverse-portal's console button opens, character for character. */
const PORTAL_CURSOR_INSTALL_URL =
  "https://cursor.com/install-mcp?name=mnemoverse&config=eyJ1cmwiOiJodHRwczovL21jcC5tbmVtb3ZlcnNlLmNvbS9tY3AifQ==";

/** Markdown link targets, `](...)`, that are Cursor install pages. */
const readmeCursorLinks = [...README.matchAll(/\]\((https:\/\/cursor\.com\/[^)\s]*install-mcp[^)\s]*)\)/g)].map(
  (m) => m[1]!,
);

/** Decodes a Cursor install link's `config` the way Cursor reads it. */
function cursorConfig(link: string): unknown {
  const raw = new URL(link).searchParams.get("config");
  expect(raw, `${link} has no config parameter`).not.toBeNull();
  return JSON.parse(Buffer.from(raw!, "base64").toString("utf8"));
}

describe("the README's Add to Cursor button", () => {
  it("exists, so the checks below are not vacuously true", () => {
    expect(readmeCursorLinks.length).toBeGreaterThan(0);
  });

  it("is the portal's link exactly: same path, name and base64", () => {
    for (const link of readmeCursorLinks) {
      expect(link).toBe(PORTAL_CURSOR_INSTALL_URL);
    }
  });

  it("decodes to the hosted server and nothing else: no key, no command, no headers", () => {
    for (const link of readmeCursorLinks) {
      const url = new URL(link);
      expect(url.host).toBe("cursor.com");
      expect(url.pathname).toBe("/install-mcp");
      expect(url.searchParams.get("name")).toBe(SOURCE.name);
      expect(cursorConfig(link)).toEqual({ url: HOSTED_URL });
    }
  });

  it("keeps its base64 intact through query-string decoding", () => {
    // URLSearchParams reads `+` as a space. The literal in the link must be
    // what a reader of the query string gets back.
    for (const link of readmeCursorLinks) {
      const literal = link.split("config=")[1]!;
      expect(new URL(link).searchParams.get("config")).toBe(literal);
    }
  });

  it("no longer comes with a warning that it installs a placeholder key", () => {
    expect(README).not.toContain("The install button carries the placeholder key");
    expect(README).not.toContain("If you did click the button");
  });
});

describe("the generated cursor:// deep link", () => {
  it("adds the same hosted server as the button", () => {
    const url = new URL(CURSOR_DEEP_LINK);
    expect(url.protocol).toBe("cursor:");
    expect(url.searchParams.get("name")).toBe(SOURCE.name);
    expect(cursorConfig(CURSOR_DEEP_LINK)).toEqual({ url: HOSTED_URL });
  });
});

describe("no install link in the README carries an API key", () => {
  // Any one-click install link a future edit might add: Cursor's https page
  // or deep link, VS Code's deep link or its vscode.dev redirect. Whatever it
  // encodes, decoded, must not hold a key, placeholder or real.
  const INSTALL_LINK =
    /(https:\/\/cursor\.com\/[^)\s"]*install-mcp[^)\s"]*|cursor:\/\/[^)\s"]+|vscode(?:-insiders)?:mcp\/install[^)\s"]*|https:\/\/(?:insiders\.)?vscode\.dev\/redirect[^)\s"]*)/g;

  it("decoded, none of them contains mk_live_", () => {
    const links = README.match(INSTALL_LINK) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      let decoded = decodeURIComponent(link);
      const config = /[?&]config=([^&]+)/.exec(link)?.[1];
      if (config) {
        const b64 = decodeURIComponent(config);
        if (/^[A-Za-z0-9+/]+=*$/.test(b64)) decoded += Buffer.from(b64, "base64").toString("utf8");
      }
      expect(decoded, link).not.toContain("mk_live_");
    }
  });
});
