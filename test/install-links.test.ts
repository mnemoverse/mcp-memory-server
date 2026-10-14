/**
 * Anti-drift tests for the one-click install links.
 *
 * Each link is decoded the way a browser and then the editor read it, and
 * the test checks what it installs. A wrong character in a base64 blob is
 * invisible in review; the only symptom in the field is a button that
 * installs the wrong thing. Until 2026-10-14 the "Add to Cursor" button
 * installed the local server with the sample key `mk_live_YOUR_KEY`, and
 * every tool call was refused (R-656, mnemoverse-core#623). The console's
 * button was fixed in mnemoverse-portal#290 (src/lib/editor-install.ts,
 * with the same checks); this file pins the README and the deep-link file
 * to that link.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const source = JSON.parse(read("src/configs/source.json"));

/** The hosted server: the one URL a Cursor install link may carry. */
const HOSTED_MCP_URL = "https://mcp.mnemoverse.com/mcp";

/** The console's link, byte for byte (mnemoverse-portal src/lib/editor-install.ts, CURSOR_INSTALL_URL). */
const CONSOLE_CURSOR_INSTALL_URL =
  "https://cursor.com/install-mcp?name=mnemoverse&config=eyJ1cmwiOiJodHRwczovL21jcC5tbmVtb3ZlcnNlLmNvbS9tY3AifQ==";

/** The exact placeholder the README's JSON blocks name on purpose, for a reader to replace by hand. */
const PLACEHOLDER_KEY = "mk_live_YOUR_KEY";

const readme = read("README.md");

/** Every https://cursor.com/…install-mcp link target in a Markdown text. */
function cursorInstallLinks(markdown: string): string[] {
  const links: string[] = [];
  const re = /\]\((https:\/\/cursor\.com\/[^)\s]*install-mcp[^)\s]*)\)/g;
  for (let m = re.exec(markdown); m !== null; m = re.exec(markdown)) links.push(m[1]);
  return links;
}

/** The `config` of a Cursor link, decoded as Cursor decodes it: base64 of a JSON server object. */
function decodedCursorConfig(link: string): unknown {
  // `cursor:` is not a special scheme, so the query is split by hand for both link forms.
  const query = link.split("?")[1] ?? "";
  const raw = new URLSearchParams(query).get("config");
  expect(raw, `no config in ${link}`).not.toBeNull();
  return JSON.parse(Buffer.from(raw!, "base64").toString("utf8"));
}

const cursorDeepLink = read("docs/configs/cursor-deep-link.txt").trim();
const vscodeDeepLink = read("docs/configs/vscode-deep-link.txt").trim();

describe("source.json names the hosted server", () => {
  it("has exactly one streamable-http remote, at the hosted URL", () => {
    const remotes = (source.remotes ?? []).filter((r: { type: string }) => r.type === "streamable-http");
    expect(remotes.map((r: { url: string }) => r.url)).toEqual([HOSTED_MCP_URL]);
  });
});

describe("the README's Add to Cursor button", () => {
  const links = cursorInstallLinks(readme);

  it("exists exactly once", () => {
    expect(links).toHaveLength(1);
  });

  it("is the console's link, byte for byte", () => {
    expect(links[0]).toBe(CONSOLE_CURSOR_INSTALL_URL);
  });

  it("is Cursor's own https install page for a server named mnemoverse, not the /en/ path that redirects", () => {
    const url = new URL(links[0]);
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("cursor.com");
    expect(url.pathname).toBe("/install-mcp");
    expect(url.searchParams.get("name")).toBe("mnemoverse");
  });

  it("carries a config that decodes to the hosted server and nothing else", () => {
    // No key and no headers: Cursor runs the OAuth sign-in itself.
    expect(decodedCursorConfig(links[0])).toEqual({ url: HOSTED_MCP_URL });
  });

  it("keeps the base64 intact through query-string decoding", () => {
    // URLSearchParams reads `+` as a space. This payload has none, and the
    // decoded value must equal the literal one in the link.
    const literal = links[0].split("config=")[1];
    expect(new URL(links[0]).searchParams.get("config")).toBe(literal);
    expect(literal).toBe(Buffer.from(JSON.stringify({ url: HOSTED_MCP_URL })).toString("base64"));
  });

  it("has no paragraph under it about a placeholder key any more", () => {
    expect(readme).not.toMatch(/install button carries the placeholder key/);
  });
});

describe("docs/configs/cursor-deep-link.txt", () => {
  it("is Cursor's deep link for a server named mnemoverse", () => {
    expect(cursorDeepLink.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?")).toBe(true);
    expect(new URLSearchParams(cursorDeepLink.split("?")[1]).get("name")).toBe("mnemoverse");
  });

  it("carries the same hosted config as the README button", () => {
    expect(decodedCursorConfig(cursorDeepLink)).toEqual({ url: HOSTED_MCP_URL });
    expect(new URLSearchParams(cursorDeepLink.split("?")[1]).get("config")).toBe(
      new URL(CONSOLE_CURSOR_INSTALL_URL).searchParams.get("config"),
    );
  });
});

describe("no install link carries a key", () => {
  // Every generated link that embeds a config: the two Cursor links (base64)
  // and the VS Code deep link (percent-encoded JSON, which prompts for the
  // key through `inputs` instead, since 0.10.1). The README's command and
  // JSON blocks name the placeholder on purpose: a reader replaces it by
  // hand. A link cannot be edited before it runs, so a key in one is a bug.
  const decoded: Array<[string, string]> = [
    ...cursorInstallLinks(readme).map(
      (link, i): [string, string] => [`README Add to Cursor #${i + 1}`, JSON.stringify(decodedCursorConfig(link))],
    ),
    ["docs/configs/cursor-deep-link.txt", JSON.stringify(decodedCursorConfig(cursorDeepLink))],
    ["docs/configs/vscode-deep-link.txt", decodeURIComponent(vscodeDeepLink.split("?")[1])],
  ];

  it("covers the README button and both deep-link files", () => {
    expect(decoded.length).toBeGreaterThanOrEqual(3);
  });

  it.each(decoded)("%s", (_name, text) => {
    expect(text).not.toContain(PLACEHOLDER_KEY);
    // Any key-shaped token. The VS Code prompt text says "starts with
    // mk_live_" followed by a parenthesis, which this does not match.
    expect(text).not.toMatch(/mk_live_[A-Za-z0-9_]/);
  });

  it("the VS Code deep link prompts for the key through inputs", () => {
    const payload = JSON.parse(decodeURIComponent(vscodeDeepLink.split("?")[1]));
    expect(payload.env.MNEMOVERSE_API_KEY).toBe("${input:mnemoverse-api-key}");
    expect(payload.inputs.map((i: { id: string }) => i.id)).toEqual(["mnemoverse-api-key"]);
  });
});

describe("docs/snippets/cursor.md, the partial mirrored into mnemoverse-docs", () => {
  const partial = read("docs/snippets/cursor.md");

  it("carries no install link: the docs Cursor page has the hosted button in its own keyless section", () => {
    expect(cursorInstallLinks(partial)).toHaveLength(0);
    expect(partial).not.toContain("install-mcp");
  });

  it("still carries the API-key JSON for ~/.cursor/mcp.json", () => {
    expect(partial).toContain("~/.cursor/mcp.json");
    expect(partial).toContain(`"${PLACEHOLDER_KEY}"`);
  });
});
