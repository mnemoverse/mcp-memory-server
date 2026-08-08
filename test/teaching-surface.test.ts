/**
 * Teaching-surface contract — the strings that teach a connected model how to
 * use this memory, and the first-contact greeting branch logic.
 *
 * WHAT IS STILL HERE, AND WHY. This file used to carry a second job: source
 * assertions standing in for behavioural ones, because src/index.ts opened a
 * stdio transport on import and its handlers could not be invoked from a test.
 * They can now (test/harness.ts), and every check that was a stand-in has moved
 * to test/handlers.test.ts as a real call — the instructions handshake, the tool
 * descriptions, the scope-note wiring, the boundary copy, the exact naming of a
 * store. What remains below is either a unit test of src/teaching.ts or one of
 * the few contracts that are genuinely ABOUT THE SOURCE, each labelled with why
 * no call can establish it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SERVER_INSTRUCTIONS,
  EMPTY_STORE_WELCOME,
  EMPTY_PERSONAL_STORE_WITH_ROOMS,
  EMPTY_PERSONAL_STORE_ROOMS_UNCHECKED,
  NO_MATCH_MESSAGE,
  NO_MATCH_HINT,
  NO_MATCH_SCOPED_HINT,
  buildReadEmptyResponse,
} from "../src/teaching.js";
import { classifyRooms, type ReadScope, type RoomScope } from "../src/scope.js";
import { safeInline } from "../src/render.js";

/**
 * Scope fixtures. `buildReadEmptyResponse` now takes the KNOWLEDGE rather than
 * two booleans, so every call has to say where it looked — which is the point:
 * the pair it replaced could describe a scope nobody searched, and did.
 */
const ROOM = { room_id: "room_01ABC", name: "me-and-olya", address: "xroom:room_01ABC" };
const ARCHIVED = { ...ROOM, room_id: "room_01OLD", name: "last-quarter", archived: true };

const own = (rooms: RoomScope): ReadScope => ({ kind: "own-domains", rooms });
const NO_ROOMS = own({ state: "none" });
const LIVE_ROOMS = own(classifyRooms([ROOM], safeInline));
const ARCHIVED_ROOMS = own(classifyRooms([ARCHIVED], safeInline));
const ROOMS_UNKNOWN = own(classifyRooms({ nope: true }, safeInline));
const NAMED_PRESENT: ReadScope = {
  kind: "named",
  named: { state: "present", name: "engineering" },
};

const indexSource = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);

// That these instructions REACH a connected client — the wiring the source
// check `toContain("{ instructions: SERVER_INSTRUCTIONS }")` could only guess at
// — is asserted by calling getInstructions() on a real client in
// test/handlers.test.ts. What is left here is the content of the string itself.
describe("server instructions", () => {
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

// The tool descriptions were checked here by grepping src/index.ts, which also
// matched the same words in a comment and said nothing about what a model is
// actually served. Both checks now read the ADVERTISED descriptions off
// tools/list — see test/handlers.test.ts.

describe("buildReadEmptyResponse (first-contact greeting branch)", () => {
  it("greets on a truly empty store (total_atoms === 0, no rooms)", async () => {
    const text = await buildReadEmptyResponse(async () => ({ total_atoms: 0 }), NO_ROOMS);
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
    const text = await buildReadEmptyResponse(async () => ({ total_atoms: 0 }), LIVE_ROOMS);
    expect(text.startsWith(EMPTY_PERSONAL_STORE_WITH_ROOMS)).toBe(true);
    expect(text).not.toContain(EMPTY_STORE_WELCOME);
    expect(text).not.toMatch(/nothing has been saved yet/);
    // Says what it actually knows, and points onward rather than concluding.
    expect(text).toMatch(/your own domains/i);
    expect(text).toMatch(/not the whole picture/i);
    // The colon is a promise, and the disclosure that keeps it now comes out of
    // the same value as the head. It used to come from a separate computation
    // over a different set of rooms.
    expect(text).toContain("1 room went unsearched");
    expect(text.trimEnd().endsWith(":")).toBe(false);
  });

  it("does not greet, and does not go silent, when the room probe failed", async () => {
    // The state that had no arm of its own: rooms were "found" whenever the note
    // was non-empty, and the failure branch returns a non-empty note — so this
    // fell to the OTHER side and a genuinely-unknown account could be told
    // "nothing has been saved yet" in the same answer that admits the room list
    // could not be read.
    const text = await buildReadEmptyResponse(
      async () => ({ total_atoms: 0 }),
      ROOMS_UNKNOWN,
    );
    expect(text.startsWith(EMPTY_PERSONAL_STORE_ROOMS_UNCHECKED)).toBe(true);
    expect(text).not.toContain(EMPTY_STORE_WELCOME);
    expect(text).not.toMatch(/nothing has been saved yet/);
    expect(text).toMatch(/could not be checked/);
    expect(text).toMatch(/shape this client does not recognise/);
    expect(text.trimEnd().endsWith(":")).toBe(false);
  });

  it("does not claim the memory is empty when the only room is archived", async () => {
    const text = await buildReadEmptyResponse(
      async () => ({ total_atoms: 0 }),
      ARCHIVED_ROOMS,
    );
    expect(text.startsWith(EMPTY_PERSONAL_STORE_WITH_ROOMS)).toBe(true);
    expect(text).not.toMatch(/nothing has been saved yet/);
    expect(text).toContain("1 shared room");
    expect(text).toMatch(/archived/i);
    expect(text.trimEnd().endsWith(":")).toBe(false);
  });

  it("returns no-match + broaden hint when the store has memories", async () => {
    const text = await buildReadEmptyResponse(async () => ({ total_atoms: 42 }), NO_ROOMS);
    expect(text).toBe(NO_MATCH_MESSAGE + NO_MATCH_HINT);
    expect(text).not.toContain(EMPTY_STORE_WELCOME);
  });

  it("keeps the disclosure on every unscoped answer, whatever stats said", async () => {
    // A stats failure is not a reason to drop what we know about the rooms —
    // that concatenation used to live at the call site and could be forgotten.
    for (const stats of [
      async () => ({ total_atoms: 42 }),
      async () => ({}),
      async () => {
        throw new Error("core unreachable");
      },
    ]) {
      const text = await buildReadEmptyResponse(stats, LIVE_ROOMS);
      expect(text).toContain("1 room went unsearched");
    }
  });

  it("fails open to the plain old message when stats throws", async () => {
    const text = await buildReadEmptyResponse(async () => {
      throw new Error("core unreachable");
    }, NO_ROOMS);
    expect(text).toBe(NO_MATCH_MESSAGE);
  });

  it("fails open to the plain old message on a malformed stats response", async () => {
    const text = await buildReadEmptyResponse(async () => ({}), NO_ROOMS);
    expect(text).toBe(NO_MATCH_MESSAGE);
  });

  it("makes exactly one stats call", async () => {
    let calls = 0;
    await buildReadEmptyResponse(async () => {
      calls++;
      return { total_atoms: 0 };
    }, NO_ROOMS);
    expect(calls).toBe(1);
  });

  it("no answer ever ends on a dangling colon, for any combination of states", async () => {
    // The colon-carrying heads are a promise that something follows. Only the
    // room states that carry a `note` may use them, and that is a type-level
    // property now — this asserts it over the whole matrix anyway, because the
    // failure it guards against shipped.
    const scopes: ReadScope[] = [
      NO_ROOMS,
      LIVE_ROOMS,
      ARCHIVED_ROOMS,
      ROOMS_UNKNOWN,
      own(classifyRooms([ROOM, ARCHIVED], safeInline)),
      NAMED_PRESENT,
      { kind: "named", named: { state: "no-such-room", name: "xroom:room_X", note: "\n\nno" } },
      {
        kind: "named",
        named: {
          state: "unchecked",
          name: "engineering",
          probed: "domains",
          reason: "fetch-failed",
          note: "\n\nunknown",
        },
      },
    ];
    for (const scope of scopes) {
      for (const stats of [
        async () => ({ total_atoms: 0 }),
        async () => ({ total_atoms: 9 }),
        async () => ({}),
        async () => {
          throw new Error("down");
        },
      ]) {
        const text = await buildReadEmptyResponse(stats, scope);
        expect(text.trim().length, JSON.stringify(scope)).toBeGreaterThan(0);
        expect(text.trimEnd().endsWith(":"), text).toBe(false);
      }
    }
  });

  // Review finding: the stats probe measures the PERSONAL store, so a
  // domain-scoped read (e.g. a shared room) must never claim "the store is
  // empty" about a domain that has memories the query merely missed.
  it("NEVER greets a domain-scoped read, and never tells the reader to drop the scope", async () => {
    let calls = 0;
    const text = await buildReadEmptyResponse(async () => {
      calls++;
      return { total_atoms: 0 };
    }, NAMED_PRESENT);
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
    const text = await buildReadEmptyResponse(async () => ({ total_atoms: 7 }), NO_ROOMS);
    expect(text).not.toMatch(/drop the domain filter/i);
  });

  it("an unchecked scope keeps the advice AND admits it could not look", async () => {
    // "Unchecked" is not a diagnosis, so it does not replace the generic hint the
    // way "no such store" does — it is added to it. Spelling it the same as
    // "present" (an empty string) is the defect this stage closes.
    let calls = 0;
    const text = await buildReadEmptyResponse(
      async () => {
        calls++;
        return { total_atoms: 0 };
      },
      {
        kind: "named",
        named: {
          state: "unchecked",
          name: "engineering",
          probed: "domains",
          reason: "unrecognised-shape",
          note: "\n\nWhether a store with that exact name exists could not be checked.",
        },
      },
    );
    expect(calls).toBe(0);
    expect(text.startsWith(NO_MATCH_MESSAGE + NO_MATCH_SCOPED_HINT)).toBe(true);
    expect(text).toMatch(/could not be checked/);
  });

  // Retired from here: `every empty-result branch is WIRED to the scope note`,
  // which counted `unsearchedRoomsNote(` / `domainMissNote(` occurrences. All six
  // branch/scope combinations are now called for real (test/handlers.test.ts).
  // Its comment also claimed "a whitespace-only domain is not a real filter — the
  // caller trims before computing the scoped flag, so the greeting still fires",
  // which described a draft that no longer exists: the trim was removed,
  // `searchedScope(" ")` returns `" "`, so `" "` IS a scope and the greeting does
  // not fire. The correct behaviour is now asserted by calling the tool.

  // THIS ONE STAYS A SOURCE ASSERTION, and it is the clearest example of a
  // contract that has to be: it is a UNIVERSAL claim about the implementation —
  // no handler normalises a domain, for the wire or for a local decision — and no
  // finite set of calls can establish "never". The behavioural anchors show a
  // padded name surviving to the wire and an empty one being dropped
  // (test/tool-wiring.test.ts) and the raw name driving the diagnosis
  // (test/handlers.test.ts); this shows there is no third path.
  it("keeps handlers free of ad-hoc domain normalisation", () => {
    // 0.8.1 briefly trimmed `domain` at the edge of each handler. Two reviews
    // killed it (2026-08-08): core deliberately 400s a non-canonical room
    // address so a write "can't be mis-routed and tagged with a spoofed xroom
    // domain", and trimming normalised past that guard — " xroom:room_01ABC"
    // would have landed in the ROOM's store, visible to every member, where
    // 0.8.0 hard-failed. It also silently relocated padded personal domains
    // while memory_delete_domain kept sending the raw value.
    //
    // No handler may `.trim()` a domain at all — not for the wire, and not for
    // a local decision either. A trimmed copy used only for wording still
    // desynced from the value that was searched, which silenced the diagnosis
    // in the release's own founding case and, for a whitespace-only domain,
    // claimed a scope that had not been searched.
    expect(indexSource).not.toMatch(/domain\?\.trim\(\)/);
    expect(indexSource).not.toMatch(/domain: rawDomain/);
    expect(indexSource).not.toMatch(/domain\.trim\(\)/);
    // The two checks that used to follow — that the builders are called, and
    // that both handlers derive their decision from `searchedScope(domain)` —
    // were counts over the source. Both are now consequences of a behavioural
    // assertion: a padded domain that reaches the wire unchanged AND drives the
    // diagnosis in the answer can only have come from one shared raw value
    // (test/tool-wiring.test.ts, test/handlers.test.ts).
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

/**
 * The load-bearing sentences of 0.8.1 were pinned here by seven source needles,
 * plus a denylist for the four sentences they replaced. That existed because a
 * review had reverted four of these messages to their 0.8.0 wording, deleted 32
 * lines, and the suite stayed 60/60 green — the copy IS this release and it had
 * no mechanical protection at all.
 *
 * All seven are now assertions on what a caller receives, for the response that
 * triggers the branch (test/handlers.test.ts → "the load-bearing sentences, as
 * returned"), and the four replaced sentences are asserted absent from the same
 * returned text. A needle proved a string existed somewhere in 1300 lines; it
 * could not prove the branch that prints it is reachable, and one of these
 * needles — `'"unknown"'` — would have matched the word in a comment.
 *
 * ONE PART OF IT IS GENUINELY ABOUT THE SOURCE and stays: the replaced sentences
 * are quoted in the comments that explain why they were replaced. That record is
 * the reason the release exists, and nothing a caller can observe protects it.
 */
describe("the record of what went wrong stays in the source", () => {
  it("keeps the replaced sentences quoted in the comments that explain them", () => {
    // Not the code — the history. If this ever fails, check whether the comment
    // was deleted or whether the sentence came BACK: the second is a regression
    // the behavioural tests will already have caught.
    expect(indexSource).toContain("Nothing new since your watermark.");
    expect(indexSource).toContain("Below importance threshold");
  });
});

/**
 * Naming a store: the sanitiser must never be the renderer.
 *
 * `safeInline` is lossy and non-injective by design — it is the anti-injection
 * treatment for a value chosen by a DIFFERENT principal (a room name, an agent
 * name), which the reader only ever looks at. A domain name is the opposite: the
 * engine matches it byte-for-byte, so the reader has to be able to send it back.
 * Rendering one through the other merged `" engineering"` with `"engineering"`
 * and printed two Cyrillic stores as one name.
 *
 * ONE ASSERTION LEFT, AND IT IS SOURCE BY NECESSITY. That every name a reader
 * must reproduce is printed exactly is now checked by calling the tools
 * (test/handlers.test.ts → "naming a store the reader has to reproduce": the
 * stats domain line, the twin diagnosis, the destructive confirmation, the
 * escape legend, and the room-name carve-out in the other direction). What no
 * call can establish is the NEGATIVE, which is the actual rule: not one of the
 * twelve handlers, on any branch, for any input, sends such a value through the
 * sanitiser. A denylist over the source is the only instrument for a "never", and
 * every entry in it is a call site that really existed.
 */
describe("naming a store", () => {
  it("never renders a domain through safeInline", () => {
    for (const banned of [
      "safeInline(searched",
      "safeInline(domain",
      "safeInline(d)",
      "safeInline(r?.domain",
      "safeInline(r.reason",
      "safeInline(wiped",
    ]) {
      expect(indexSource, `${banned} sends a value the reader must reproduce through the sanitiser`).not.toContain(
        banned,
      );
    }
  });
});
