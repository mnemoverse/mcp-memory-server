/**
 * Keyless first, for every client; the API key in a section of its own.
 *
 * WHY. The README went from a short no-key block straight to "Get a free API
 * key", and showed Claude Desktop, Devin Desktop, Zed, JetBrains and Cline only
 * with MNEMOVERSE_API_KEY. npm renders this README, GitHub shows it, and about
 * ten directories copy the first `mcpServers` block they find as "the config"
 * (packaging lane, room atom 1865727c, 2026-10-23). So every one of them told
 * people to get a key before anything else, for a server whose hosted endpoint
 * signs them in through the browser.
 *
 * WHAT THIS HOLDS. The README's first `mcpServers` block carries no key and
 * reaches the hosted server; the two keyless regions hold no key at all; every
 * client in the API-key region also has a keyless entry above it; the bridge
 * entries are built from source.json; and every `-hosted` partial is keyless
 * while every API-key partial still carries the key.
 *
 * WHAT IT DOES NOT: whether a host's sign-in actually completes. That was run
 * live (the bridge, 2026-10-23) or by replay (Cline, 2026-10-18), and is
 * recorded next to each entry in scripts/generate-configs.mjs.
 */

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const README = read("README.md");
const SOURCE = JSON.parse(read("src/configs/source.json")) as {
  name: string;
  remotes: { type: string; url: string }[];
  bridge: { package: string; command: string; args: string[] };
};
const HOSTED_URL = SOURCE.remotes.find((r) => r.type === "streamable-http")!.url;
const KEY_MARKERS = /mk_live_|MNEMOVERSE_API_KEY/;

/** The text between a region's START and END markers. */
function region(name: string): string {
  const start = README.indexOf(`<!-- ${name}_START`);
  const end = README.indexOf(`<!-- ${name}_END -->`);
  expect(start, `${name}_START marker`).toBeGreaterThan(-1);
  expect(end, `${name}_END marker`).toBeGreaterThan(start);
  return README.slice(start, end);
}

/** Every ```json block in `text`, parsed, in order. */
function jsonBlocks(text: string): unknown[] {
  return [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!));
}

/** The bold client names that open each entry: "**Claude Code** — ...". */
function clientNames(text: string): string[] {
  return [...text.matchAll(/^\*\*([^*]+)\*\*(?: \([^)]*\))? —/gm)].map((m) => m[1]!);
}

type Entry = { command?: string; args?: string[]; url?: string; env?: Record<string, string> };

describe("the README's first mcpServers block, the one directories copy", () => {
  const first = jsonBlocks(README).find(
    (b): b is { mcpServers: Record<string, Entry> } =>
      typeof b === "object" && b !== null && "mcpServers" in b,
  );

  it("exists", () => {
    expect(first).toBeDefined();
  });

  it("carries no key and no env", () => {
    expect(JSON.stringify(first)).not.toMatch(KEY_MARKERS);
    expect(first!.mcpServers[SOURCE.name]!.env).toBeUndefined();
  });

  it("is the bridge to the hosted server, which works in any client that starts a local command", () => {
    const entry = first!.mcpServers[SOURCE.name]!;
    expect(entry.command).toBe(SOURCE.bridge.command);
    expect(entry.args).toEqual([...SOURCE.bridge.args, HOSTED_URL]);
  });
});

describe("the README's install sections", () => {
  const featured = region("INSTALL_SNIPPETS");
  const more = region("MORE_CLIENTS");
  const local = region("LOCAL_KEY_SNIPPETS");

  it("hold no key in either keyless region", () => {
    expect(featured).not.toMatch(KEY_MARKERS);
    expect(more).not.toMatch(KEY_MARKERS);
  });

  it("come in the order keyless, keyless, API key, with the key section under its own heading", () => {
    const at = (s: string) => README.indexOf(s);
    expect(at("<!-- INSTALL_SNIPPETS_START")).toBeLessThan(at("<!-- MORE_CLIENTS_START"));
    expect(at("<!-- MORE_CLIENTS_START")).toBeLessThan(at("## Local package with an API key"));
    expect(at("## Local package with an API key")).toBeLessThan(at("<!-- LOCAL_KEY_SNIPPETS_START"));
  });

  it("send nobody to a key before the keyless setup: the first key in the README is below both keyless regions", () => {
    const firstKey = README.search(KEY_MARKERS);
    expect(firstKey).toBeGreaterThan(README.indexOf("<!-- MORE_CLIENTS_END -->"));
  });

  it("give every client in the API-key section a keyless entry above it", () => {
    const keyed = clientNames(local);
    const keyless = new Set([...clientNames(featured), ...clientNames(more)]);
    expect(keyed.length).toBeGreaterThan(5);
    expect(keyed.filter((c) => !keyless.has(c))).toEqual([]);
  });

  it("name the hosted server's Authorization: Bearer form for clients that send a header", () => {
    const section = README.slice(README.indexOf("## Local package with an API key"));
    expect(section).toContain("`Authorization: Bearer mk_live_YOUR_KEY`");
    expect(section).toContain(HOSTED_URL);
  });
});

describe("the bridge entries", () => {
  it("are source.json's bridge with the hosted URL appended, and nothing else", () => {
    const entries: Entry[] = [];
    for (const block of jsonBlocks(README)) {
      const servers = (block as Record<string, Record<string, Entry>>).mcpServers ??
        (block as Record<string, Record<string, Entry>>).context_servers;
      const entry = servers?.[SOURCE.name];
      if (entry?.args?.some((a) => a.startsWith(SOURCE.bridge.package))) entries.push(entry);
    }
    // Any MCP client, Claude Desktop, Devin Desktop, Zed, JetBrains.
    expect(entries.length).toBe(5);
    for (const entry of entries) {
      expect(entry.command).toBe(SOURCE.bridge.command);
      expect(entry.args).toEqual([...SOURCE.bridge.args, HOSTED_URL]);
      expect(entry.env).toBeUndefined();
    }
  });

  it("keep npx non-interactive", () => {
    // Without -y, npx may stop at "Ok to proceed?" on a first install, which
    // nobody sees in a stdio launch.
    expect(SOURCE.bridge.args[0]).toBe("-y");
  });
});

describe("the partials", () => {
  const files = readdirSync(new URL("../docs/snippets/", import.meta.url));
  const hosted = files.filter((f) => f.endsWith("-hosted.md"));
  const keyed = files.filter((f) => f.endsWith(".md") && !f.endsWith("-hosted.md"));

  it("pair every API-key partial with a keyless one", () => {
    expect(keyed.length).toBeGreaterThan(5);
    expect(keyed.map((f) => f.replace(/\.md$/, "-hosted.md")).filter((f) => !hosted.includes(f))).toEqual([]);
  });

  it.each(hosted)("%s is keyless and reaches the hosted server", (f) => {
    const text = read(`docs/snippets/${f}`);
    expect(text).not.toMatch(KEY_MARKERS);
    expect(text).toContain(HOSTED_URL);
  });

  it.each(keyed)("%s is the API-key path", (f) => {
    expect(read(`docs/snippets/${f}`)).toMatch(KEY_MARKERS);
  });
});
