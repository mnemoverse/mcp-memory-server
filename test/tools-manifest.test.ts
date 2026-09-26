/**
 * tools.json, the generated tool manifest, is coupled to the code and to every
 * copy that derives from it.
 *
 * WHY. The tool count lived in about thirty hand copies: the .mcpb manifest's
 * tools[] (a hand list in src/configs/source.json, ten entries while
 * src/tools.ts registered eleven), README.md, llms-install.md, docs/shared.md,
 * the header comments of src/tools.ts, and the downstream docs. Each was
 * correct when written and wrong after `memory_graph` landed (#174), and
 * nothing failed. `scripts/generate-tools-manifest.mjs` now asks the BUILT
 * server what it registers and writes tools.json; the .mcpb manifest is
 * generated from that file. `verify:configs` only checks that manifest.json
 * matches tools.json, so it passes when both are stale together; the drift
 * between tools.json and the implementation is caught HERE (a) and by the
 * release workflow's diff of the committed file against the rebuilt one.
 * This test closes the remaining gaps:
 *
 *   (a) tools.json equals a live in-memory server's tools/list, so a committed
 *       artifact that drifted from src/ fails here even before anyone builds;
 *   (b) manifest.json's tools[] is tools.json's name+description, the MCPB
 *       shape, and nothing else;
 *   (c) every prose file that states the count states tools.json's count, as
 *       an English numeral, and none of the phrasings that said "ten" survive;
 *   (d) the file ships in the npm tarball and is reachable through `exports`,
 *       so a consumer can read it from the registry instead of from a clone.
 *
 * (a) uses test/direct-register.ts rather than test/harness.ts: the harness
 * boots the real stdio server, which is right for handler tests but reads the
 * environment; a fresh McpServer with a throwing apiFetch is exactly what the
 * generator script does, so this test and the script look at the same thing.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connectMemoryTools } from "./direct-register.js";
import type { ApiFetch } from "../src/shared.js";

const read = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const TOOLS_JSON = JSON.parse(read("tools.json"));
const MANIFEST = JSON.parse(read("manifest.json"));
const PKG = JSON.parse(read("package.json"));

const neverCalled: ApiFetch = async () => {
  throw new Error("listing tools must not call the API");
};

/** The generator's own per-tool shape, applied to a live listing. `title` is
 *  read the same way the script reads it: the SDK's top-level `title` when a
 *  tool was registered with one, otherwise the `annotations.title` these tools
 *  declare (src/tools.ts). */
interface ManifestTool {
  name: string;
  title: string | undefined;
  description: string | undefined;
  annotations: Record<string, unknown>;
}

async function liveTools(): Promise<ManifestTool[]> {
  const { client, server } = await connectMemoryTools({ apiFetch: neverCalled });
  try {
    const { tools } = await client.listTools();
    return tools
      .map((t) => ({
        name: t.name,
        title: t.title ?? (t.annotations?.title as string | undefined),
        description: t.description,
        annotations: (t.annotations ?? {}) as Record<string, unknown>,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
  } finally {
    await server.close();
  }
}

describe("(a) tools.json is the built server's tools/list", () => {
  it("matches a live in-memory server: names, titles, descriptions, annotations, in name order", async () => {
    const live = await liveTools();
    expect(live.length).toBeGreaterThan(0);
    expect(TOOLS_JSON.tools).toEqual(live);
  });

  it("states its own count, and the package it describes", async () => {
    const live = await liveTools();
    expect(TOOLS_JSON.count).toBe(live.length);
    expect(TOOLS_JSON.count).toBe(TOOLS_JSON.tools.length);
    expect(TOOLS_JSON.name).toBe(PKG.name);
    expect(TOOLS_JSON.version).toBe(PKG.version);
  });

  it("says it is generated, and by what", () => {
    expect(TOOLS_JSON.$comment).toContain("scripts/generate-tools-manifest.mjs");
    expect(TOOLS_JSON.$comment).toContain("do not edit");
  });
});

describe("(b) manifest.json tools[] derives from tools.json", () => {
  it("is tools.json's name and description per tool, same order, nothing more", () => {
    const expected = TOOLS_JSON.tools.map(
      ({ name, description }: { name: string; description: string }) => ({ name, description }),
    );
    expect(MANIFEST.tools).toEqual(expected);
  });
});

describe("(c) every prose copy of the count says what tools.json says", () => {
  /** The files that state the count in a sentence. Each is here because it
   *  said "ten" after the eleventh tool landed, and each is a place a reader
   *  trusts: the README's stability contract, the agent install guide, the
   *  /shared consumer guide, and the source file's own header. */
  const COUNTED = ["README.md", "llms-install.md", "docs/shared.md", "src/tools.ts"] as const;

  const NUMERALS = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
  ];
  const numeral = NUMERALS[TOOLS_JSON.count];

  /** The exact phrasings that carried the old count on 2026-09-25. A net for
   *  the sentences that existed, not a proof about prose in general; if the
   *  surface ever shrinks back to ten this list is what the true count reads
   *  as, and the check needs rethinking rather than deleting. */
  const STALE = ["ten tools", "same ten", "The ten memory tools", "all ten", "these ten"];

  it("tools.json's count has an English numeral this test knows", () => {
    expect(numeral, `no numeral for count ${TOOLS_JSON.count}`).toBeDefined();
  });

  it.each(COUNTED)("%s counts the tools as tools.json does", (rel) => {
    const text = read(rel);
    // The counting sentence: "<numeral> tools" or "<numeral> memory tools",
    // whichever the file uses ("Eleven tools." opens a paragraph in
    // llms-install.md, so the match ignores case).
    expect(text).toMatch(new RegExp(`\\b${numeral}(?: memory)? tools\\b`, "i"));
    const lower = text.toLowerCase();
    for (const phrase of STALE) {
      expect(lower, `${rel} still says "${phrase}"`).not.toContain(phrase.toLowerCase());
    }
  });
});

describe("(d) tools.json is published with the package", () => {
  it("is in package.json `files`, so the tarball carries it", () => {
    expect(PKG.files).toContain("tools.json");
  });

  it("is reachable through package.json `exports`", () => {
    expect(PKG.exports["./tools.json"]).toBe("./tools.json");
  });
});
