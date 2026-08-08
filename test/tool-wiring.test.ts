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
import {
  readRequestBody,
  recentRequestBody,
  writeRequestBody,
} from "../src/requests.js";

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
 * Keys the handler actually puts into the request body — measured by CALLING
 * the builder, not by pattern-matching the source.
 *
 * This used to brace-match `body: JSON.stringify({ … })` inside src/index.ts.
 * That was honest about its own fragility (it asserted the anchor existed, so
 * it would fail loudly rather than pass from the wrong text) and it did exactly
 * that when the bodies moved into src/requests.ts. Reading them from the real
 * functions is strictly better: it survives a reformat, and it checks the value
 * that ships instead of the text that describes it.
 *
 * Every declared parameter gets a type-appropriate sentinel, because a body
 * builder may legitimately drop a falsy value (`limit: 0` becomes the default)
 * and a test that fed `undefined` everywhere would pass while forwarding
 * nothing.
 */
const SENTINEL: Record<string, unknown> = {
  query: "sentinel-query",
  content: "sentinel-content",
  concepts: ["sentinel-concept"],
  domain: "sentinel-domain",
  order_by: "recency",
  since: "2026-08-01T00:00:00Z",
  until: "2026-08-02T00:00:00Z",
  exclude_author: "sentinel-author",
  top_k: 7,
  limit: 11,
  cursor: "sentinel-cursor",
};

function forwardedParams(
  build: (a: never) => Record<string, unknown>,
  declared: string[],
): string[] {
  const args: Record<string, unknown> = {};
  for (const p of declared) {
    expect(SENTINEL, `no sentinel defined for the new parameter "${p}"`).toHaveProperty(p);
    args[p] = SENTINEL[p];
  }
  const body = build(args as never);
  return declared.filter((p) => body[p] !== undefined);
}

/**
 * The HANDLER-to-builder link.
 *
 * forwardedParams above calls the builders directly, which proves the builders
 * forward — and proves nothing about whether the handlers hand them the
 * parameters they advertise. CodeRabbit caught that on PR #65: if a handler
 * stops passing `until`, those tests still pass, because the test supplies
 * `until` to the builder itself. Losing the link while moving a check to where
 * it was testable is the same mistake this whole release is about.
 *
 * This closes the gap the cheap way — asserting each handler's builder call
 * mentions every parameter it destructures. It is a TRIPWIRE, not a guarantee:
 * a source check cannot see a value that is renamed or shadowed on the way in.
 * The real fix is to connect a client over the SDK's in-memory transport and
 * invoke the tools for real, which needs src/index.ts to stop opening a stdio
 * transport on import. That is filed for 0.9 rather than rushed here.
 */
function builderCall(block: string, builder: string): string {
  const at = block.indexOf(`${builder}({`);
  expect(at, `${builder} is not called in this handler`).toBeGreaterThan(-1);
  return braceBody(block, at);
}

describe("handler -> builder forwarding", () => {
  const CASES: Array<[tool: string, builder: string]> = [
    ["memory_read", "readRequestBody"],
    ["memory_list_recent", "recentRequestBody"],
    ["memory_write", "writeRequestBody"],
  ];

  for (const [tool, builder] of CASES) {
    it(`${tool} hands every advertised parameter to ${builder}`, () => {
      const block = toolBlock(tool);
      const call = builderCall(block, builder);
      for (const p of declaredParams(block)) {
        // `confirm` is a Zod safety interlock, validated before the handler
        // runs and never part of a request body.
        if (p === "confirm") continue;
        expect(call, `${p} is advertised but not passed to ${builder}`).toContain(p);
      }
    });
  }
});

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
    const declared = declaredParams(block);
    const forwarded = forwardedParams(recentRequestBody, declared);
    for (const p of declared) {
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
    const forwarded = forwardedParams(readRequestBody, declared);
    for (const p of declared) {
      expect(forwarded, `${p} is advertised but never sent`).toContain(p);
    }
  });
});

describe("memory_write", () => {
  const block = toolBlock("memory_write");

  it("forwards every advertised parameter", () => {
    const declared = declaredParams(block);
    const forwarded = forwardedParams(writeRequestBody, declared);
    for (const p of declared) {
      expect(forwarded, `${p} is advertised but never sent`).toContain(p);
    }
  });
});
