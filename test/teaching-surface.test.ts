/**
 * Teaching-surface contract — the strings that teach a connected model how to
 * use this memory, and the first-contact greeting branch logic.
 *
 * Imports src/teaching.ts directly (NOT src/index.ts, which starts a stdio
 * transport on import); the tool-description polarity check reads src/index.ts
 * as text for the same reason.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SERVER_INSTRUCTIONS,
  EMPTY_STORE_WELCOME,
  NO_MATCH_MESSAGE,
  NO_MATCH_HINT,
  NO_MATCH_SCOPED_HINT,
  buildReadEmptyResponse,
} from "../src/teaching.js";

const indexSource = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);

describe("server instructions", () => {
  it("exist and are wired into the McpServer constructor", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(indexSource).toContain("{ instructions: SERVER_INSTRUCTIONS }");
  });

  it("carry active polarity — no user-gating brakes", () => {
    for (const brake of [
      "only when the user explicitly asks",
      "only when the user asks",
      "wait to be asked to", // "don't wait to be asked" is the flip, not a brake
    ]) {
      expect(SERVER_INSTRUCTIONS.toLowerCase()).not.toContain(brake);
    }
  });

  it("mention every tool family: read/write/stats/feedback + delete + rooms + vault", () => {
    for (const tool of [
      "memory_read",
      "memory_write",
      "memory_stats",
      "memory_feedback",
      "memory_delete",
      "room",
      "vault",
    ]) {
      expect(SERVER_INSTRUCTIONS.toLowerCase()).toContain(tool);
    }
  });

  it("front-load the core habit in the first 512 chars (ChatGPT weighting) and stay 500-800 chars", () => {
    const head = SERVER_INSTRUCTIONS.slice(0, 512);
    expect(head).toContain("memory_read");
    expect(head).toContain("memory_write");
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThanOrEqual(500);
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(800);
  });

  it("keep the never-store-secrets safety line (honesty constraint)", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/Never store passwords/);
    // No over-claiming: "zero-knowledge" language is banned on this surface.
    expect(SERVER_INSTRUCTIONS.toLowerCase()).not.toContain("zero-knowledge");
  });
});

describe("tool descriptions in src/index.ts", () => {
  it("contain no suppressive polarity", () => {
    for (const brake of [
      "only when the user explicitly asks",
      "Never delete on your own initiative",
      "Never call this speculatively",
      "only on an explicit user request",
    ]) {
      expect(indexSource).not.toContain(brake);
    }
  });

  it("keep the never-store-secrets safety line on memory_write", () => {
    expect(indexSource).toContain(
      "Never store passwords, API keys, payment data, MFA codes, government IDs, or health records",
    );
  });
});

describe("buildReadEmptyResponse (first-contact greeting branch)", () => {
  it("greets on a truly empty store (total_atoms === 0)", async () => {
    const text = await buildReadEmptyResponse(async () => ({ total_atoms: 0 }));
    expect(text).toBe(EMPTY_STORE_WELCOME);
    expect(text).toContain("memory_write");
    expect(text).toContain('"User prefers TypeScript strict mode"');
  });

  it("returns no-match + broaden hint when the store has memories", async () => {
    const text = await buildReadEmptyResponse(async () => ({
      total_atoms: 42,
    }));
    expect(text).toBe(NO_MATCH_MESSAGE + NO_MATCH_HINT);
    expect(text).not.toContain(EMPTY_STORE_WELCOME);
  });

  it("fails open to the plain old message when stats throws", async () => {
    const text = await buildReadEmptyResponse(async () => {
      throw new Error("core unreachable");
    });
    expect(text).toBe(NO_MATCH_MESSAGE);
  });

  it("fails open to the plain old message on a malformed stats response", async () => {
    const text = await buildReadEmptyResponse(async () => ({}));
    expect(text).toBe(NO_MATCH_MESSAGE);
  });

  it("makes exactly one stats call", async () => {
    let calls = 0;
    await buildReadEmptyResponse(async () => {
      calls++;
      return { total_atoms: 0 };
    });
    expect(calls).toBe(1);
  });

  // Review finding: the stats probe measures the PERSONAL store, so a
  // domain-scoped read (e.g. a shared room) must never claim "the store is
  // empty" about a domain that has memories the query merely missed.
  it("NEVER greets a domain-scoped read, and never tells the reader to drop the scope", async () => {
    let calls = 0;
    const text = await buildReadEmptyResponse(async () => {
      calls++;
      return { total_atoms: 0 };
    }, true);
    expect(calls).toBe(0); // scoped reads skip the probe entirely
    expect(text).toBe(NO_MATCH_MESSAGE + NO_MATCH_SCOPED_HINT);
    // This assertion used to REQUIRE "drop the domain filter", on the
    // reasoning that a filter genuinely exists so suggesting its removal is
    // honest. Dogfooding proved that harmful: when the domain is a ROOM,
    // dropping it is the one move that guarantees the content stays hidden,
    // because an unscoped read does not cover rooms at all. It is the exact
    // step that cost two agents a working day (2026-08-07). The hint now
    // suggests a wider query or a different domain — both can actually find
    // something — and the test guards against the old advice returning.
    expect(text).not.toMatch(/drop the domain filter/i);
    expect(text).toMatch(/different domain/i);
    expect(text).not.toContain(EMPTY_STORE_WELCOME);
  });

  it("the unscoped broaden hint does NOT advise dropping a filter that was never set", async () => {
    const text = await buildReadEmptyResponse(async () => ({ total_atoms: 7 }));
    expect(text).not.toMatch(/drop the domain filter/i);
  });

  // Copilot: a whitespace-only domain is not a real filter — the caller trims
  // before computing the scoped flag, so the greeting still fires. This pins
  // the caller-side contract as source text (the handler is not bootable in
  // tests — importing src/index.ts starts the stdio transport).
  it("every scope-taking handler normalises the domain at the edge", () => {
    // A whitespace-only domain is not a filter. This used to be enforced by a
    // trim at ONE decision point, which is how the same call could be "scoped"
    // for the greeting and "unscoped" three branches down while sending "   "
    // to the server (CodeRabbit, #65). The rule now lives at the edge of each
    // handler, so there is one normalised value and no second opinion.
    const normalisations = indexSource.match(
      /const domain = rawDomain\?\.trim\(\) \|\| (undefined|"general")/g,
    );
    // memory_read, memory_list_recent, memory_write.
    expect(normalisations).toHaveLength(3);

    // And nothing downstream re-derives its own answer from the raw value.
    expect(indexSource).not.toContain("domain != null && domain.trim()");
    expect(indexSource).not.toContain("domain: domain || undefined");
  });
});

describe("install-command canon", () => {
  const CANON_ARGS = ["-y", "@mnemoverse/mcp-memory-server@latest"];

  it("source.json pins the canonical npx command", () => {
    const source = JSON.parse(
      readFileSync(new URL("../src/configs/source.json", import.meta.url), "utf8"),
    );
    expect(source.command).toBe("npx");
    expect(source.args).toEqual(CANON_ARGS);
  });

  it("README.md and the claude-code snippet carry the flat canonical command", () => {
    const flat = "npx -y @mnemoverse/mcp-memory-server@latest";
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const snippet = readFileSync(
      new URL("../docs/snippets/claude-code.md", import.meta.url),
      "utf8",
    );
    expect(readme).toContain(flat);
    expect(snippet).toContain(flat);
  });
});
