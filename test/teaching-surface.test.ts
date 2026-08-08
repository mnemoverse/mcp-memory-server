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
  EMPTY_PERSONAL_STORE_WITH_ROOMS,
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
  it("greets on a truly empty store (total_atoms === 0, no rooms)", async () => {
    const text = await buildReadEmptyResponse(async () => ({ total_atoms: 0 }));
    expect(text).toBe(EMPTY_STORE_WELCOME);
    expect(text).toContain("memory_write");
    expect(text).toContain('"User prefers TypeScript strict mode"');
  });

  it("NEVER greets a rooms-only account — total_atoms counts the personal org only", async () => {
    // The worst finding of the 2026-08-08 review. An invited teammate with zero
    // personal writes and three full rooms was told "Your long-term memory is
    // empty — nothing has been saved yet, which is why this search returned
    // nothing": three false clauses, and the scope note appended underneath
    // contradicted them in the same payload. That reader is precisely the
    // person from the incident this release is about.
    const text = await buildReadEmptyResponse(
      async () => ({ total_atoms: 0 }),
      false,
      true, // rooms exist
    );
    expect(text).toBe(EMPTY_PERSONAL_STORE_WITH_ROOMS);
    expect(text).not.toContain(EMPTY_STORE_WELCOME);
    expect(text).not.toMatch(/nothing has been saved yet/);
    // Says what it actually knows, and points onward rather than concluding.
    expect(text).toMatch(/your own domains/i);
    expect(text).toMatch(/not the whole picture/i);
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
  it("every empty-result branch is WIRED to the scope note", () => {
    // Found by the merge gate, not by these tests: the scope note itself is
    // well covered, but the wiring is not — deleting the call from a handler
    // and replacing it with `""` left all 50 tests green. For a release whose
    // entire point is "the tool must say where it looked", a silently
    // unwired note is the failure, not a cosmetic one.
    //
    // A source assertion is weaker than a behavioural one and is here because
    // index.ts starts a stdio transport on import, so the handlers cannot be
    // invoked from a unit test. It catches the deletion, which is the
    // regression that matters. Same pattern as the instructions check above.
    const unscoped = indexSource.match(/await unsearchedRoomsNote\(/g) ?? [];
    const scoped = indexSource.match(/await domainMissNote\(/g) ?? [];
    // Three empty-result branches: the recent feed, the filtered read, and
    // the plain no-match read. Each must handle both scopes.
    expect(unscoped).toHaveLength(3);
    expect(scoped).toHaveLength(3);
    // And the note must reach the reader, not be computed and dropped.
    expect(indexSource.match(/\+ scopeNote|scopeNote,$/gm)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("NEVER normalises the domain it sends to the server", () => {
    // 0.8.1 briefly trimmed `domain` at the edge of each handler. Two reviews
    // killed it (2026-08-08): core deliberately 400s a non-canonical room
    // address so a write "can't be mis-routed and tagged with a spoofed xroom
    // domain", and trimming normalised past that guard — " xroom:room_01ABC"
    // would have landed in the ROOM's store, visible to every member, where
    // 0.8.0 hard-failed. It also silently relocated padded personal domains
    // while memory_delete_domain kept sending the raw value.
    //
    // So the wire value is untouched, and only the LOCAL choice of which
    // explanation to attach to an empty result is normalised. This test is the
    // guard: re-introducing the trim on a send path must fail here.
    expect(indexSource).not.toMatch(/const domain = rawDomain\?\.trim\(\)/);
    expect(indexSource).not.toMatch(/domain: rawDomain/);

    // The local, never-sent normalisation, in memory_read and memory_list_recent.
    expect(indexSource.match(/const scopeKey = domain\?\.trim\(\) \|\| null/g)).toHaveLength(2);
    // And the write still sends exactly what 0.8.0 sent.
    expect(indexSource).toContain('domain: domain || "general"');
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
