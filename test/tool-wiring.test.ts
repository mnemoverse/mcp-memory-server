/**
 * Tool-wiring contract — every parameter a tool ADVERTISES must actually reach
 * the request body.
 *
 * This is the failure mode that hurts, because it is silent: a tool declares
 * `until` in its input schema, a model reads the schema and passes `until`, the
 * handler destructures something else, and the server — which ignores unknown
 * fields rather than rejecting them — returns an unfiltered answer. Nothing
 * errors anywhere. The caller just gets the wrong memories and has no way to
 * tell.
 *
 * Reads src/index.ts as text rather than importing it: importing starts a stdio
 * transport. Same approach as teaching-surface.test.ts.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

/** Slice one `server.registerTool("<name>", …)` call out of the source. */
function toolBlock(name: string): string {
  const start = source.indexOf(`"${name}"`);
  expect(start, `${name} is not registered`).toBeGreaterThan(-1);
  const end = source.indexOf("server.registerTool(", start);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

/**
 * Field names declared in the tool's `inputSchema: { … }`.
 *
 * Indentation-agnostic and accepts `name: z` broken across lines as well as
 * `name: z.string()` on one. An earlier version demanded exactly six leading
 * spaces and `: z` at end of line, which meant a reformat or a one-line field
 * would quietly shrink the set this test checks — and a contract test that
 * silently checks less is worse than none, because it still reports green.
 */
function declaredParams(block: string): string[] {
  const at = block.indexOf("inputSchema: {");
  expect(at, "inputSchema not found — the extraction pattern has drifted").toBeGreaterThan(-1);
  const schema = braceBody(block, at);
  const names = [...schema.matchAll(/^\s*([a-z_]+)\s*:\s*z\b/gm)].map((m) => m[1]);
  expect(names.length, "no parameters extracted — pattern drift, not an empty schema").toBeGreaterThan(0);
  return names;
}

/** The `{ … }` object literal starting at or after `from`, brace-matched. */
function braceBody(block: string, from: number): string {
  const open = block.indexOf("{", from);
  expect(open, "no object literal here — the extraction pattern has drifted").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < block.length; i++) {
    if (block[i] === "{") depth++;
    else if (block[i] === "}" && --depth === 0) return block.slice(open, i);
  }
  throw new Error("unbalanced braces while slicing the object literal");
}

/**
 * Keys the handler puts into the JSON request body.
 *
 * Two spellings count, because both are in use: a plain `name: value` entry,
 * and the conditional spread `...(name ? { name } : {})` that memory_read uses
 * to keep the body byte-identical for callers who pass no filters.
 */
function forwardedParams(block: string): string[] {
  // Assert the anchor was found rather than letting indexOf return -1 and
  // brace-match some unrelated object earlier in the block: that path produces
  // a PASS from the wrong text, which is the one outcome this file must not
  // have. If the handler stops building the body inline (`JSON.stringify(body)`),
  // this fails loudly and someone updates the pattern deliberately.
  const open = block.indexOf("body: JSON.stringify({");
  expect(open, "body: JSON.stringify({ … }) not found — the handler shape changed").toBeGreaterThan(-1);
  // Brace-match rather than searching for a closing token: a conditional
  // spread ends in `: {}),`, which contains the obvious `}),` sentinel and
  // would truncate the object at its first filter.
  const literal = braceBody(block, open + "body: JSON.stringify(".length);
  const plain = [...literal.matchAll(/^\s+([a-z_]+)[:,]/gm)].map((m) => m[1]);
  const spread = [...literal.matchAll(/\.\.\.\(\s*([a-z_]+)\s*\?/g)].map((m) => m[1]);
  return [...new Set([...plain, ...spread])];
}

describe("memory_list_recent", () => {
  const block = toolBlock("memory_list_recent");

  it("advertises the filters the feed supports", () => {
    expect(declaredParams(block).sort()).toEqual([
      "cursor",
      "domain",
      "exclude_author",
      "limit",
      "since",
      "until",
    ]);
  });

  it("forwards every advertised parameter — none may be declared and dropped", () => {
    // Subset, not equality: a handler may also send constants the caller never
    // supplies. What must never happen is the other direction.
    const forwarded = forwardedParams(block);
    for (const p of declaredParams(block)) {
      expect(forwarded, `${p} is advertised but never sent`).toContain(p);
    }
  });

  it("destructures each one from the handler argument", () => {
    const handlerArgs = block.slice(block.indexOf("async ({"), block.indexOf("}) =>"));
    for (const p of declaredParams(block)) {
      expect(handlerArgs, `${p} is declared but never destructured`).toContain(p);
    }
  });
});

describe("memory_read", () => {
  const block = toolBlock("memory_read");

  it("forwards every advertised parameter", () => {
    // memory_read carries the same temporal filters; the same silent-drop
    // failure applies to it, so it is pinned by the same rule.
    const declared = declaredParams(block);
    expect(declared).toContain("since");
    expect(declared).toContain("until");
    expect(declared).toContain("exclude_author");
    const forwarded = forwardedParams(block);
    for (const p of declared) {
      expect(forwarded, `${p} is advertised but never sent`).toContain(p);
    }
  });
});
