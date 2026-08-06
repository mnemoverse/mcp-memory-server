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

/** Field names declared in the tool's `inputSchema: { … }`. */
function declaredParams(block: string): string[] {
  const schema = block.slice(block.indexOf("inputSchema: {"));
  return [...schema.matchAll(/^\s{6}([a-z_]+): z$/gm)].map((m) => m[1]);
}

/**
 * Keys the handler puts into the JSON request body.
 *
 * Two spellings count, because both are in use: a plain `name: value` entry,
 * and the conditional spread `...(name ? { name } : {})` that memory_read uses
 * to keep the body byte-identical for callers who pass no filters.
 */
function forwardedParams(block: string): string[] {
  const open = block.indexOf("body: JSON.stringify({");
  const from = block.indexOf("{", open + "body: JSON.stringify(".length);
  // Brace-match rather than searching for a closing token: a conditional
  // spread ends in `: {}),`, which contains the obvious `}),` sentinel and
  // would truncate the object at its first filter.
  let depth = 0;
  let to = from;
  for (let i = from; i < block.length; i++) {
    if (block[i] === "{") depth++;
    else if (block[i] === "}" && --depth === 0) {
      to = i;
      break;
    }
  }
  const literal = block.slice(from, to);
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
