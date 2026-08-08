/**
 * The WHOLE answer, as a caller receives it — head sentence, diagnosis, scope
 * disclosure, escape legend, all concatenated.
 *
 * WHY A SEPARATE FILE FROM handlers.test.ts. That file asks whether each clause
 * is present and correct. This one asks whether the clauses, put together, say
 * one thing. The distinction is not academic: a review of this release assembled
 * the empty-result answers by hand and found several that read as two voices
 * arguing — one sentence asserting the reader was caught up, the next explaining
 * that the first was meaningless; a head promising "that is not the whole
 * picture:" with nothing after the colon; a greeting claiming nothing had ever
 * been saved directly above an admission that the room list could not be
 * fetched. Every one of those defects is invisible to a per-clause assertion,
 * because every individual clause was true.
 *
 * SO THE ASSERTIONS ARE PROPERTIES OF THE STRING, not of its parts. Five of them
 * hold for every answer in this file, and they are the release's own rules
 * turned into code:
 *
 *   1. No sentence asserts absence beyond the scope that was searched. An
 *      unscoped answer either discloses the rooms it did not cover or has
 *      ESTABLISHED (probe answered) that there are none; a scoped answer says
 *      nothing about the caller's other domains at all.
 *   2. No answer ends on a colon or any other dangling connective, and every
 *      colon that promises a continuation gets one.
 *   3. No answer explains the same emptiness twice — exactly one head sentence,
 *      at most one scope disclosure, at most one escape legend, and never a
 *      "could not look" admission beside a definitive absence claim.
 *   4. Any domain named in the answer is reproducible byte-for-byte: a lossy
 *      rendering of the searched name must not appear as a quoted name, and a
 *      name that differs only in case or padding may be printed only inside the
 *      sentence that says so.
 *   5. Generic advice never precedes (or accompanies) a specific diagnosis. An
 *      ADMISSION is not a diagnosis and is deliberately exempt — src/teaching.ts
 *      adds it to the advice rather than substituting for it, because "we could
 *      not check" gives the reader nothing to act on that the hint does not.
 *
 * Properties survive a rewording and fail a change of meaning, which is the
 * point. Where a claim cannot be expressed as a property the prose is pinned and
 * the comment says so: the first-contact greeting (its identity is the whole
 * claim), the verbatim server reason (asserted by decoding it back to the
 * server's exact bytes), and the un-quotable-reason clause (a fixed phrase whose
 * job is to exist at all).
 *
 * Every row of the table is one situation. The table is replayed once more at the
 * bottom for the cross-situation properties — chiefly that exactly ONE situation
 * in the whole matrix may tell the reader their memory has never been written to.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  httpError,
  networkDown,
  startMemoryServer,
  type Harness,
  type Route,
} from "./harness.js";
import { EMPTY_STORE_WELCOME } from "../src/teaching.js";
import { safeInline } from "../src/render.js";

let mcp: Harness;

beforeAll(async () => {
  mcp = await startMemoryServer();
});
afterAll(async () => {
  await mcp.close();
});
beforeEach(() => {
  mcp.reset();
});

/* ========================================================================= *
 * FIXTURES
 * ========================================================================= */

const READ = "POST /memory/read";
const RECENT = "POST /memory/recent";
const WRITE = "POST /memory/write";
const STATS = "GET /memory/stats";
const ROOMS = "GET /memory/rooms";
const FEEDBACK = "POST /memory/feedback";
const del = (id: string) => `DELETE /memory/atoms/${encodeURIComponent(id)}`;
const wipe = (d: string) => `DELETE /memory/domain/${encodeURIComponent(d)}`;

/** One live room, in the shape core returns. */
const ROOM = {
  room_id: "room_01ABC",
  name: "me-and-olya",
  address: "xroom:room_01ABC",
  role: "owner",
  scope: "read_write",
};

/** An archived room: still listed for its owner, readable by nobody, with no
 *  operation anywhere in this client that reopens it. */
const ARCHIVED_ROOM = {
  room_id: "room_01OLD",
  name: "last-quarter",
  address: "xroom:room_01OLD",
  role: "owner",
  scope: "read_write",
  archived: true,
};

/** A store whose name ends in U+200B: real, reachable, and addressable by no
 *  clean spelling. Written as an escape because a literal ZWSP in a test file is
 *  exactly as invisible as it is in tool output. */
const ZWSP_NAME = "engineering​";
const ZWSP_LITERAL = '"engineering\\u200b"';

/** Two Cyrillic names that `safeInline` rendered as the SAME string, ":acme" —
 *  one lossy transform, two distinct stores. The alphabet the old guard silenced
 *  altogether. */
const CYRILLIC = "проект:acme";
const CYRILLIC_TWIN = "Проект:acme";

/** Core's only write-rejection reason. Every character outside the sanitiser's
 *  charset here is load-bearing. */
const GATE_REASON = "Below importance threshold (0.412 < 0.500)";

/** Which endpoints the answer consulted — the evidence behind its claims. */
const probed = () => mcp.calls.map((c) => c.key);

/* ========================================================================= *
 * THE PROPERTY VOCABULARY
 * ========================================================================= */

/** The clause every unscoped disclosure carries (SCOPE_PREFIX, src/scope.ts). */
const SCOPE_DISCLOSURE =
  "Shared rooms are separate stores and are NOT included in an unscoped read";

/** Substring identifying the escape legend (src/names.ts). */
const LEGEND = "printed as JSON string literals";

/** A claim that the account as a whole has never been written to. Establishable
 *  only when the stats probe answered zero AND the room probe answered "none". */
const ACCOUNT_IS_EMPTY = [/nothing has been saved yet/, /Your long-term memory is empty/];

/** An admission that a probe did not answer. */
const COULD_NOT_LOOK = [
  /could not be checked/i,
  /could not be fetched/i,
  /shape this client does not recognise/i,
  /cannot say whether any room went unsearched/i,
];

/** Absence asserted definitively about a named thing. */
const DEFINITE_ABSENCE = [
  /No store has that exact name/,
  /is not in your list/,
  /You have no shared rooms yet/,
];

/**
 * A diagnosis specific enough to make the generic hint wrong: the scope the hint
 * talks about does not exist. src/teaching.ts substitutes the note FOR the hint
 * on exactly these arms. An "unchecked" admission is NOT in this list on purpose
 * — it tells the reader nothing to do, so the hint stays and the admission is
 * added to it.
 */
const SPECIFIC_DIAGNOSIS = [
  /No store has that exact name/,
  /is not the same store as/,
  /is not in your list/,
];

const GENERIC_ADVICE = [/Try a broader query/];

/**
 * Sentences this release withdrew. Finding one in RETURNED TEXT is a regression —
 * and unlike the source denylist this replaces, it cannot be satisfied by
 * deleting the sentence from a comment, nor evaded by a branch that is never
 * reached.
 */
const WITHDRAWN = [
  "Nothing new since your watermark.",
  "No memories here yet.",
  "No memory found with id",
  "Feedback recorded for 0",
  "either the address is wrong or you are not a member",
  "or drop the domain filter",
  "Most often that means",
];

/**
 * The mutually exclusive head sentences. An empty answer must open with exactly
 * ONE of them: two heads is the "two voices" defect, zero means the answer opens
 * with a note that was written to follow something.
 */
const HEADS: readonly (readonly [string, RegExp])[] = [
  ["plain no-match", /^No memories found for this query\./m],
  ["own domains empty, rooms disclosed", /hold no memories yet\. That is not the whole picture:/],
  [
    "own domains empty, rooms unchecked",
    /hold no memories yet\. Whether that is the whole picture could not be checked:/,
  ],
  ["first contact", /Your long-term memory is empty/],
  ["filtered read", /matches within the given time\/author filters\./],
  ["feed with a watermark", /^Nothing new in .* since your watermark\./m],
  ["feed with no watermark", /^No memories in .* yet\./m],
];

/**
 * An answer may not END here. The list is the punctuation and the function words
 * that promise something after them — the live bug was a colon, and a colon is
 * not the only way to leave a sentence open.
 */
const DANGLING_TAIL =
  /(?:[:;,]|—|–|\s-|\b(?:and|or|but|so|because|e\.g|i\.e|such as|including|the following|with|to|for|from|of|in|at|by|is|are|was|were)\b)$/i;

/** Every quoted JSON string literal in the text, as printed and as decoded. */
function quotedLiterals(text: string): { literal: string; value: string }[] {
  const out: { literal: string; value: string }[] = [];
  for (const m of text.matchAll(/"(?:[^"\\\n]|\\.)*"/g)) {
    try {
      const v = JSON.parse(m[0]) as unknown;
      if (typeof v === "string") out.push({ literal: m[0], value: v });
    } catch {
      // Not a JSON literal — not a name printed by src/names.ts, so not ours.
    }
  }
  return out;
}

/** The decoded value of every quoted name on the page. */
const quotedNames = (text: string): string[] => quotedLiterals(text).map((q) => q.value);

/**
 * True when some quoted name carries an escape — i.e. the text between the
 * quotes is NOT the name and has to be decoded before it is sent back.
 *
 * Compared literal-against-value rather than via `JSON.stringify`, because
 * `exactLiteral` escapes MORE than `JSON.stringify` does: a zero-width space
 * survives `JSON.stringify` raw and is the whole reason the escaping exists.
 * This is the same test as the `escaped` flag in src/names.ts, computed from the
 * finished page instead of from the value.
 */
function hasEscapedName(text: string): boolean {
  return quotedLiterals(text).some((q) => q.literal.slice(1, -1) !== q.value);
}

const count = (text: string, needle: string): number =>
  text.split(needle).length - 1;

/* ========================================================================= *
 * THE UNIVERSAL CHECK
 * ========================================================================= */

interface Bounds {
  /**
   * `empty-read` — a zero-result answer from memory_read / memory_list_recent,
   * where the scope invariants apply. `other` — every other surface, which has
   * no room probe and must bound its absence claim in its own words.
   */
  surface: "empty-read" | "other";
  /** The exact value that went over the wire as `domain`; absent = unscoped. */
  searched?: string;
  /** The room probe ANSWERED that there are none, so nothing was missed and
   *  there is nothing to disclose. Only meaningful on an unscoped read. */
  roomsKnownEmpty?: boolean;
  /** Both probes answered zero — the one situation that may tell the reader the
   *  account holds nothing. */
  mayClaimAccountEmpty?: boolean;
  /** Endpoints this answer must be able to prove it did not consult. */
  mustNotProbe?: readonly string[];
  /** For a non-read surface that asserts absence: the phrase bounding it. */
  boundedBy?: RegExp;
}

function expectHonestAnswer(text: string, b: Bounds): void {
  const scoped = b.searched !== undefined;

  // ---- 0. There is an answer.
  expect(text.trim().length, "empty answer").toBeGreaterThan(0);
  for (const junk of ["undefined", "null", "NaN", "[object Object]"]) {
    expect(text, `interpolation leaked ${junk}`).not.toContain(junk);
  }

  // ---- 1. Nothing withdrawn is back.
  for (const gone of WITHDRAWN) {
    expect(text, `withdrawn sentence is back: ${gone}`).not.toContain(gone);
  }

  // ---- 2. Nothing dangles.
  const tail = text.trimEnd();
  expect(
    DANGLING_TAIL.test(tail),
    `answer ends on a dangling connective: …${tail.slice(-70)}`,
  ).toBe(false);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (!/[:;]$/.test(line.trimEnd())) return;
    const after = lines.slice(i + 1).join("").trim();
    expect(
      after.length,
      `a line promises a continuation and gets none: ${line.trim()}`,
    ).toBeGreaterThan(0);
  });

  // ---- 3. One emptiness, one explanation.
  const heads = HEADS.filter(([, re]) => re.test(text)).map(([name]) => name);
  if (b.surface === "empty-read") {
    expect(heads, `an empty answer must open with exactly one head\n${text}`).toHaveLength(1);
  }
  expect(count(text, SCOPE_DISCLOSURE), "two scope disclosures").toBeLessThanOrEqual(1);
  expect(count(text, LEGEND), "two escape legends").toBeLessThanOrEqual(1);
  const admits = COULD_NOT_LOOK.some((re) => re.test(text));
  const asserts = DEFINITE_ABSENCE.some((re) => re.test(text));
  expect(
    admits && asserts,
    `one answer both admits it could not look and asserts an absence:\n${text}`,
  ).toBe(false);

  // ---- 4. Absence stays inside the scope that was searched.
  const claimsAccountEmpty = ACCOUNT_IS_EMPTY.some((re) => re.test(text));
  expect(
    claimsAccountEmpty && !b.mayClaimAccountEmpty,
    `claims the account holds nothing without having established it:\n${text}`,
  ).toBe(false);
  if (b.surface === "empty-read") {
    if (scoped) {
      // A scoped read covered ONE store. It knows nothing about the others and
      // nothing about the rooms, and must therefore say nothing about either.
      expect(text, "a scoped answer talks about the caller's own domains").not.toContain(
        "your own domains",
      );
      expect(text, "a scoped answer discloses a room boundary it never probed").not.toContain(
        SCOPE_DISCLOSURE,
      );
    } else if (b.roomsKnownEmpty) {
      // Nothing outside the scope, so nothing to disclose — and nothing may be
      // said about rooms either, since there are none to describe.
      expect(text, "discloses rooms for an account that has none").not.toMatch(/shared room/i);
      expect(text).not.toMatch(/went unsearched/);
    } else {
      // Rooms exist, or we could not find out. Either way the boundary is owed.
      expect(text, `an unscoped answer that does not disclose its boundary:\n${text}`).toContain(
        SCOPE_DISCLOSURE,
      );
    }
  }
  if (b.boundedBy) {
    expect(text, "an absence claim with no boundary").toMatch(b.boundedBy);
  }

  // ---- 5. Advice does not stand in front of a diagnosis.
  if (SPECIFIC_DIAGNOSIS.some((re) => re.test(text))) {
    for (const advice of GENERIC_ADVICE) {
      expect(
        advice.test(text),
        `generic advice beside a specific diagnosis:\n${text}`,
      ).toBe(false);
    }
  }

  // ---- 6. A name is reproducible, or it is not printed.
  if (b.searched !== undefined) expectNameFidelity(text, b.searched);
  if (hasEscapedName(text)) {
    expect(count(text, LEGEND), "an escaped name with no legend to decode it").toBe(1);
  } else {
    expect(count(text, LEGEND), "a legend explaining escapes in a name with none").toBe(0);
  }

  // ---- 7. The evidence behind the claim.
  for (const endpoint of b.mustNotProbe ?? []) {
    expect(probed(), `consulted ${endpoint}`).not.toContain(endpoint);
  }
}

/**
 * The searched name is printed exactly, or not printed.
 *
 * Three ways it went wrong in this release, all checkable from the text alone: a
 * `safeInline` rendering appeared as a quoted name (`" engineering"` printed as
 * `"engineering"`, `"проект:acme"` as `":acme"`); a trimmed copy appeared; and a
 * name differing only in case was printed as though it were the one searched. The
 * third is legitimate in exactly one sentence — the twin note, which exists to
 * say the two are different stores — so it is allowed only there.
 */
function expectNameFidelity(text: string, raw: string): void {
  const lossy = safeInline(raw);
  if (lossy !== raw && lossy !== "") {
    expect(text, `a lossy rendering of ${JSON.stringify(raw)} is on the page`).not.toContain(
      `"${lossy}"`,
    );
  }
  const trimmed = raw.trim();
  if (trimmed !== raw && trimmed !== "") {
    expect(text, "a trimmed copy of the searched name is on the page").not.toContain(
      `"${trimmed}"`,
    );
  }
  const confusable = quotedNames(text).filter(
    (n) => n !== raw && n.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (confusable.length > 0) {
    expect(
      text,
      `${JSON.stringify(confusable[0])} is named beside ${JSON.stringify(raw)} without ` +
        `saying they are different stores`,
    ).toContain("is not the same store as");
  }
}

/* ========================================================================= *
 * THE SITUATIONS
 * ========================================================================= */

interface Situation {
  /** The letter from the brief, or a following letter for one it did not name. */
  id: string;
  /** What is true of the world in this situation. */
  what: string;
  tool: string;
  args: Record<string, unknown>;
  routes: Record<string, Route>;
  bounds: Bounds;
  /** What the answer must MEAN, beyond the universal properties. */
  meaning?: (text: string) => void;
}

const SITUATIONS: readonly Situation[] = [
  {
    id: "a",
    what: "unscoped read, no match, personal store has memories, live rooms exist",
    tool: "memory_read",
    args: { query: "any new messages" },
    routes: { [READ]: { items: [] }, [ROOMS]: [ROOM], [STATS]: { total_atoms: 42 } },
    bounds: { surface: "empty-read" },
    meaning(text) {
      // The store is real and the query missed, so broadening is apt advice —
      // and the boundary is still owed, with an address the reader can use.
      expect(text).toMatch(/Try a broader query/);
      expect(text).toMatch(/1 room went unsearched/);
      expect(text).toContain('domain="xroom:room_01ABC"');
      expect(text).toMatch(/Re-run with domain set/);
      // The advice-then-disclosure order is correct here and only here: the
      // disclosure is not a diagnosis, it is the rest of the scope.
      expect(text.indexOf("Try a broader query")).toBeLessThan(text.indexOf(SCOPE_DISCLOSURE));
    },
  },
  {
    id: "b",
    what: "unscoped read, no match, personal store EMPTY, live rooms exist",
    tool: "memory_read",
    args: { query: "any new messages" },
    routes: { [READ]: { items: [] }, [ROOMS]: [ROOM], [STATS]: { total_atoms: 0 } },
    bounds: { surface: "empty-read" },
    meaning(text) {
      // The reader from the 2026-08-07 incident: every memory they have lives in
      // a room. The old answer greeted them as a new account and contradicted
      // itself two lines down.
      expect(text).toMatch(/hold no memories yet/);
      expect(text).toMatch(/1 room went unsearched/);
      // No hint: there is no query to broaden against an empty personal store.
      expect(text).not.toMatch(/Try a broader query/);
    },
  },
  {
    id: "c",
    what:
      "unscoped read, no match, personal store empty, NO rooms — the only situation " +
      "that may greet, because it is the only one where the claim was established",
    tool: "memory_read",
    args: { query: "any new messages" },
    routes: { [READ]: { items: [] }, [ROOMS]: [], [STATS]: { total_atoms: 0 } },
    bounds: { surface: "empty-read", roomsKnownEmpty: true, mayClaimAccountEmpty: true },
    meaning(text) {
      // PROSE PINNED, deliberately: the greeting's identity IS the claim. Its
      // wording is a product decision, but the fact that this answer and no
      // other one is the greeting is the property, and equality is the only way
      // to state it.
      expect(text).toBe(EMPTY_STORE_WELCOME);
      // Both probes were made. A greeting on fewer than two answers is a guess.
      expect(probed()).toContain(ROOMS);
      expect(probed()).toContain(STATS);
    },
  },
  {
    id: "c2",
    what: "unscoped read, no match, personal store has memories, NO rooms",
    tool: "memory_read",
    args: { query: "any new messages" },
    routes: { [READ]: { items: [] }, [ROOMS]: [], [STATS]: { total_atoms: 7 } },
    bounds: { surface: "empty-read", roomsKnownEmpty: true },
    meaning(text) {
      // The absence claim is unqualified and that is CORRECT here: the searched
      // scope is everything the account has, established by a probe that
      // answered. Silence is right in exactly this one case.
      expect(text).toContain("No memories found for this query.");
      expect(text).toMatch(/Try a broader query/);
    },
  },
  {
    id: "d",
    what: "unscoped read, no match, personal store empty, rooms probe FAILED",
    tool: "memory_read",
    args: { query: "any new messages" },
    routes: {
      [READ]: { items: [] },
      [ROOMS]: httpError(503, "upstream down"),
      [STATS]: { total_atoms: 0 },
    },
    bounds: { surface: "empty-read" },
    meaning(text) {
      expect(text).toMatch(/Whether that is the whole picture could not be checked/);
      expect(text).toMatch(/the room list could not be fetched just now/);
      // The head and the note are the two halves of ONE sentence across a colon,
      // not two explanations: the head says the personal store measured zero,
      // the note says what could not be measured. Neither claims the other's
      // territory.
      expect(text).not.toMatch(/went unsearched:/);
    },
  },
  {
    id: "d2",
    what: "unscoped read, no match, personal store empty, room list came back UNREADABLE",
    tool: "memory_read",
    args: { query: "any new messages" },
    routes: { [READ]: { items: [] }, [ROOMS]: { rooms: "surprise" }, [STATS]: { total_atoms: 0 } },
    bounds: { surface: "empty-read" },
    meaning(text) {
      // A contract violation is not evidence about the account. `Array.isArray(x)
      // ? x : []` made it evidence, three times over.
      expect(text).toMatch(/shape this client does not recognise/);
    },
  },
  {
    id: "d3",
    what: "unscoped read, no match, room probe fails at the TRANSPORT (offline)",
    tool: "memory_read",
    args: { query: "any new messages" },
    routes: { [READ]: { items: [] }, [ROOMS]: networkDown(), [STATS]: { total_atoms: 0 } },
    bounds: { surface: "empty-read" },
    meaning(text) {
      expect(text).toMatch(/could not be fetched just now/);
    },
  },
  {
    id: "e",
    what: "scoped read on a domain that does not exist",
    tool: "memory_read",
    args: { query: "deploy notes", domain: "marketing" },
    routes: { [READ]: { items: [] }, [STATS]: { domains: ["engineering"] } },
    bounds: { surface: "empty-read", searched: "marketing", mustNotProbe: [ROOMS] },
    meaning(text) {
      expect(text).toContain("No store has that exact name.");
      // The absence is narrowed to what is knowable: names match byte-for-byte,
      // so a store can exist and be unreachable from a clean spelling. Hence
      // "no store with that exact name", never "no such store".
      expect(text).toMatch(/byte-for-byte/);
      expect(text).not.toMatch(/no such (store|domain)/i);
    },
  },
  {
    id: "f",
    what:
      "scoped read on a clean name where the store exists only in a PADDED form — " +
      "the store is real, and no clean spelling can reach it",
    tool: "memory_read",
    args: { query: "deploy notes", domain: "engineering" },
    routes: { [READ]: { items: [] }, [STATS]: { domains: [" engineering"] } },
    bounds: { surface: "empty-read", searched: "engineering", mustNotProbe: [ROOMS] },
    meaning(text) {
      expect(mcp.requestTo(READ).body).toMatchObject({ domain: "engineering" });
      expect(text).toContain("No store has that exact name.");
      // The mechanism is named — a stray space makes a separate store — and the
      // padded twin is NOT named, because `noSuchDomainNote` only claims an
      // exact case-insensitive match and " engineering" is not one. A guess that
      // named the wrong store would be worse than the mechanism, since the
      // reader trusts a named store. So: no quoted name at all on this page.
      expect(quotedNames(text)).toHaveLength(0);
    },
  },
  {
    id: "f2",
    what:
      "scoped read on a PADDED name while the clean store exists — the founding " +
      "case: the diagnosis must be driven by the raw value that went over the wire",
    tool: "memory_read",
    args: { query: "deploy notes", domain: " engineering" },
    routes: { [READ]: { items: [] }, [STATS]: { domains: ["engineering"] } },
    bounds: { surface: "empty-read", searched: " engineering", mustNotProbe: [ROOMS] },
    meaning(text) {
      // If any part of the pipeline trimmed, stats would report a name that
      // matched and this sentence would be suppressed — precisely when a stray
      // space had caused the miss.
      expect(mcp.requestTo(READ).body).toMatchObject({ domain: " engineering" });
      expect(text).toContain("No store has that exact name.");
    },
  },
  {
    id: "f3",
    what:
      "scoped read whose NAME probe failed — an admission, and the only situation " +
      "where generic advice may stand beside one",
    tool: "memory_read",
    args: { query: "deploy notes", domain: "engineering" },
    routes: { [READ]: { items: [] }, [STATS]: httpError(503, "down") },
    bounds: { surface: "empty-read", searched: "engineering", mustNotProbe: [ROOMS] },
    meaning(text) {
      // This is the state the old code spelled as `""` — i.e. byte-identically
      // to "the store is there and your query missed". It is an ADMISSION, not a
      // diagnosis: it gives the reader nothing to act on, so the hint stays and
      // the admission is ADDED rather than substituted. Hence the exemption in
      // property 5, asserted here so the exemption is not silently widened to
      // cover a real diagnosis.
      expect(text).toMatch(/Try a broader query, or a different domain/);
      expect(text).toMatch(/could not be checked/);
      expect(text).toMatch(/could not be fetched just now/);
      expect(text).toMatch(/not evidence that the name is wrong/);
      // And the definitive claim is gone: appending the admission to it instead
      // of replacing it is the exact mistake this release made twice.
      expect(text).not.toContain("No store has that exact name");
    },
  },
  {
    id: "f4",
    what:
      "scoped read whose NAME probe answered in a shape this client cannot read — " +
      "core always sends `domains` on a 200, so a missing key is not an empty store",
    tool: "memory_read",
    args: { query: "deploy notes", domain: "engineering" },
    routes: { [READ]: { items: [] }, [STATS]: { total_atoms: 5 } },
    bounds: { surface: "empty-read", searched: "engineering", mustNotProbe: [ROOMS] },
    meaning(text) {
      expect(text).toMatch(/shape this client does not recognise/);
      expect(text).not.toContain("No store has that exact name");
      // A 200 with total_atoms and no domains list is a body that is not core's.
      // Reading it as an empty domain list is how a contract violation became a
      // definitive claim about the caller's stores.
      expect(text).toMatch(/memory_stats lists them exactly/);
    },
  },
  {
    id: "g",
    what: "scoped read on a VALID room address, no match",
    tool: "memory_read",
    args: { query: "anything", domain: "xroom:room_01ABC" },
    routes: { [READ]: { items: [] }, [ROOMS]: [ROOM] },
    bounds: {
      surface: "empty-read",
      searched: "xroom:room_01ABC",
      // CodeRabbit #65: a room address probed against /memory/stats answers "No
      // store has that exact name" about a room the caller is a member of.
      mustNotProbe: [STATS],
    },
    meaning(text) {
      expect(text).not.toMatch(/is not in your list/);
      expect(text).not.toContain("No store has that exact name");
      // The one piece of advice that must never appear for a room: dropping the
      // domain is the single move guaranteed to lose the content, because an
      // unscoped read does not cover rooms at all.
      expect(text).not.toMatch(/drop the domain/i);
    },
  },
  {
    id: "g2",
    what: "scoped read on a room address that is NOT in the caller's list",
    tool: "memory_read",
    args: { query: "anything", domain: "xroom:room_NOPE" },
    routes: { [READ]: { items: [] }, [ROOMS]: [ROOM] },
    bounds: { surface: "empty-read", searched: "xroom:room_NOPE", mustNotProbe: [STATS] },
    meaning(text) {
      expect(text).toMatch(/That room is not in your list/);
      // Three causes, not two. A room the caller merely JOINED leaves core's
      // list the moment its owner archives it, so for exactly the invited
      // teammate this release is about, both of the old two causes were false.
      expect(text).toMatch(/archived/i);
      expect(text).toMatch(/memory_list_rooms/);
    },
  },
  {
    id: "h",
    what:
      "scoped read on a CYRILLIC domain that does not exist, while a case-twin does — " +
      "the sentence a whole alphabet used to be excluded from",
    tool: "memory_read",
    args: { query: "заметки", domain: CYRILLIC },
    routes: { [READ]: { items: [] }, [STATS]: { domains: [CYRILLIC_TWIN, "план:acme"] } },
    bounds: { surface: "empty-read", searched: CYRILLIC, mustNotProbe: [ROOMS] },
    meaning(text) {
      // Both names printed exactly. The old guard was `sanitize(x) === x`, which
      // no Cyrillic name can pass, so the most useful sentence in the module went
      // silent for every non-Latin store; an earlier draft printed through the
      // sanitiser and asserted facts about ":acme", a store that exists nowhere.
      expect(text).toContain(`"${CYRILLIC}" is not the same store as "${CYRILLIC_TWIN}"`);
      expect(text).not.toContain('":acme"');
      // No escape is needed for Cyrillic, so no legend — a caveat about nothing
      // trains readers to skip caveats.
      expect(count(text, LEGEND)).toBe(0);
    },
  },
  {
    id: "h2",
    what:
      "feed scoped to a Cyrillic domain that does not exist and has no twin — the " +
      "name is still reproduced inside the head sentence",
    tool: "memory_list_recent",
    args: { domain: CYRILLIC },
    routes: { [RECENT]: { items: [] }, [STATS]: { domains: ["engineering"] } },
    bounds: { surface: "empty-read", searched: CYRILLIC, mustNotProbe: [ROOMS] },
    meaning(text) {
      expect(mcp.requestTo(RECENT).body).toMatchObject({ domain: CYRILLIC });
      expect(text).toContain(`No memories in "${CYRILLIC}" yet.`);
      expect(text).toContain("No store has that exact name.");
    },
  },
  {
    id: "i",
    what: "memory_list_recent, watermark in the FUTURE, unscoped, live rooms exist",
    tool: "memory_list_recent",
    args: { since: "2999-01-01T00:00:00" },
    routes: { [RECENT]: { items: [] }, [ROOMS]: [ROOM] },
    bounds: { surface: "empty-read" },
    meaning(text) {
      // Two limitations, not two explanations: the watermark makes the result
      // uninformative, the scope excludes the rooms. Both are true, both are
      // separately actionable, and the SPECIFIC one comes first.
      expect(text).toMatch(/that watermark is in the FUTURE/);
      expect(text).toMatch(/says nothing about whether you are caught up/);
      expect(text).toMatch(/1 room went unsearched/);
      expect(text.indexOf("FUTURE")).toBeLessThan(text.indexOf(SCOPE_DISCLOSURE));
      // Naive ISO is UTC, as core's schema and this client's own tool
      // descriptions say. Parsing it as LOCAL made this note lie in both
      // directions depending on the runner's timezone.
      expect(text).toMatch(/This client's clock reads \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z/);
    },
  },
  {
    id: "j",
    what: "memory_list_recent scoped to a room the caller IS in, no new entries",
    tool: "memory_list_recent",
    args: { domain: "xroom:room_01ABC", since: "2020-01-01T00:00:00Z" },
    routes: { [RECENT]: { items: [] }, [ROOMS]: [ROOM] },
    bounds: { surface: "empty-read", searched: "xroom:room_01ABC", mustNotProbe: [STATS] },
    meaning(text) {
      // The scope is IN the sentence. This is the exact call from the incident,
      // and "Nothing new since your watermark." — with no scope in it — is what
      // it used to answer, for a room whose write had landed correctly.
      expect(text).toBe("Nothing new in that room since your watermark.");
      // The room's own NAME is deliberately not printed: the address is already
      // in the caller's hand, and the name belongs to another principal.
      expect(text).not.toContain("me-and-olya");
    },
  },
  {
    id: "j2",
    what: "memory_list_recent scoped to a room, no watermark at all",
    tool: "memory_list_recent",
    args: { domain: "xroom:room_01ABC" },
    routes: { [RECENT]: { items: [] }, [ROOMS]: [ROOM] },
    bounds: { surface: "empty-read", searched: "xroom:room_01ABC", mustNotProbe: [STATS] },
    meaning(text) {
      expect(text).toBe("No memories in that room yet.");
    },
  },
  {
    id: "k",
    what:
      "owner whose ONLY room is archived, unscoped read, personal store empty — " +
      "THE live bug: a head promising a disclosure that had been filtered out",
    tool: "memory_read",
    args: { query: "anything" },
    routes: { [READ]: { items: [] }, [ROOMS]: [ARCHIVED_ROOM], [STATS]: { total_atoms: 0 } },
    bounds: { surface: "empty-read" },
    meaning(text) {
      expect(text).toMatch(/That is not the whole picture:/);
      // …and something after the colon. The flag counted all rooms; the note it
      // gated counted the live ones; an owner with one archived room got the
      // colon and nothing else.
      expect(text).toMatch(/You have 1 shared room, which is archived/);
      expect(text).toMatch(/Archiving did not delete/);
      // No recovery is promised, because none exists: core has archive with no
      // inverse — no route, no store method, no tool.
      expect(text).not.toMatch(/unarchiv/i);
      // Counted, not named: there is no address that would do the reader any good.
      expect(text).not.toContain("last-quarter");
      expect(text).not.toMatch(/went unsearched/);
    },
  },
  {
    id: "k2",
    what: "owner whose ONLY room is archived, on the feed",
    tool: "memory_list_recent",
    args: {},
    routes: { [RECENT]: { items: [] }, [ROOMS]: [ARCHIVED_ROOM] },
    bounds: { surface: "empty-read" },
    meaning(text) {
      expect(text).toContain("No memories in your own domains yet.");
      expect(text).toMatch(/all of which are archived|which is archived/);
    },
  },
  {
    id: "k3",
    what:
      "owner whose ONLY room is archived, asking for the inventory — here the room " +
      "IS named and tagged, because this tool's job is the list",
    tool: "memory_list_rooms",
    args: {},
    routes: { [ROOMS]: [ARCHIVED_ROOM] },
    bounds: { surface: "other" },
    meaning(text) {
      expect(text).toContain("Your shared rooms (1)");
      expect(text).toContain("[archived]");
      expect(text).toContain('"last-quarter"');
      // Not "you have no rooms" — the room exists and is merely unreadable.
      expect(text).not.toContain("You have no shared rooms yet");
    },
  },
  {
    id: "l",
    what: "memory_write rejected by the gate, WITH a reason field",
    tool: "memory_write",
    args: { content: "a near-duplicate" },
    routes: { [WRITE]: { stored: false, importance: 0.412, reason: GATE_REASON } },
    bounds: { surface: "other" },
    meaning(text) {
      // The outcome, not just the mechanism: "Filtered — …" read as a soft
      // success and ate a correction in dogfooding.
      expect(text.startsWith("NOT STORED — nothing was saved.")).toBe(true);
      expect(text).not.toContain("Stored (importance");
      // VERBATIM means verbatim, and this is the property rather than the prose:
      // pull the quoted reason back out of the answer, decode it, and require
      // core's exact bytes. safeInline relayed it as "Below importance threshold
      // 0.412 0.500" — the `<` and both parentheses deleted from a quote whose
      // label promises it is unaltered.
      expect(quotedNames(text)).toContain(GATE_REASON);
      expect(text).toContain("Novelty score 0.41");
    },
  },
  {
    id: "l2",
    what: "memory_write rejected by the gate with NO reason and NO score",
    tool: "memory_write",
    args: { content: "x" },
    routes: { [WRITE]: { stored: false } },
    bounds: { surface: "other" },
    meaning(text) {
      expect(text.startsWith("NOT STORED — nothing was saved.")).toBe(true);
      // A live surface answers {"stored":false} with neither field. Printing
      // "0.00" fabricates the gate's verdict; naming a cause the server did not
      // give asserts one on no evidence.
      expect(text).not.toContain("Server reason");
      expect(text).not.toContain("Novelty score");
      expect(text).not.toContain("0.00");
      // The general mechanism may still be stated — it is a property of the
      // gate, not a claim about this call.
      expect(text).toMatch(/Writes are gated on/);
    },
  },
  {
    id: "l3",
    what: "memory_write rejected with a reason too long to quote exactly",
    tool: "memory_write",
    args: { content: "x" },
    routes: { [WRITE]: { stored: false, reason: "R".repeat(500) } },
    bounds: { surface: "other" },
    meaning(text) {
      // PROSE PINNED: the clause's job is to EXIST. Dropping it would report a
      // server that gave no reason, and truncating it would break the promise
      // the label makes. Neither can be expressed as a property of the text, so
      // the phrase is pinned.
      expect(text).toContain("Server reason: (too long to quote exactly).");
      // Not one character of the unreproducible value is printed.
      expect(text).not.toContain("RR");
    },
  },
  {
    id: "m",
    what: "memory_feedback matching zero ids",
    tool: "memory_feedback",
    args: { atom_ids: ["atom_from_a_room"], outcome: 1 },
    routes: { [FEEDBACK]: { updated_count: 0 } },
    bounds: { surface: "other", boundedBy: /in your own domains/ },
    meaning(text) {
      // One character from the success line and it read like one.
      expect(text).toContain("No feedback was recorded");
      // The cause the caller cannot guess comes first, because it is invisible
      // from the tool surface: this tool exposes no domain argument at all, so
      // ids taken off a room read silently miss every time.
      const room = text.indexOf("shared room");
      const deleted = text.indexOf("was deleted");
      expect(room).toBeGreaterThan(-1);
      expect(room).toBeLessThan(deleted);
      // Causes are offered as possibilities. "Most often that means…" was a
      // statistic nobody has.
      expect(text).toMatch(/Possible causes/);
    },
  },
  {
    id: "n",
    what: "memory_delete on an id that is not in the caller's store",
    tool: "memory_delete",
    args: { atom_id: "atom_room_9" },
    routes: { [del("atom_room_9")]: { deleted: 0 } },
    bounds: { surface: "other", boundedBy: /in your own domains/ },
    meaning(text) {
      // NOT "no such memory". Deletion is scoped to the caller's own store and
      // core has no room-scoped delete at all, so a room atom's id lands here
      // while the memory plainly exists — and this release made room ids MORE
      // visible in read results.
      expect(text).toContain("atom_room_9");
      expect(text).toMatch(/CANNOT be deleted through this tool/);
      expect(text).toMatch(/it still exists and is untouched/);
      expect(text).not.toMatch(/never existed|no such memory/i);
    },
  },
  {
    id: "o",
    what: "memory_delete_domain matching zero rows",
    tool: "memory_delete_domain",
    args: { domain: "Project X", confirm: true },
    routes: { [wipe("Project X")]: { deleted: 0, domain: "Project X" } },
    bounds: { surface: "other", searched: "Project X", boundedBy: /in your own store/ },
    meaning(text) {
      // Zero is not a successful wipe. "Deleted 0 memories from domain 'Project
      // X'" implied a domain that existed and is now empty — so the user says
      // "forget everything about project X", the agent passes "Project X", reads
      // a success-shaped line, reports done, and the atoms live on under
      // "project x".
      expect(text.startsWith("NOTHING was deleted")).toBe(true);
      expect(text).not.toMatch(/^Deleted 0/);
      expect(text).toContain('domain "Project X"');
      expect(text).toMatch(/before reporting this as done/);
    },
  },
  {
    id: "o2",
    what:
      "memory_delete_domain matching zero rows for a name whose last character is " +
      "invisible — a destructive confirmation is where an unreproducible name is worst",
    tool: "memory_delete_domain",
    args: { domain: ZWSP_NAME, confirm: true },
    routes: { [wipe(ZWSP_NAME)]: { deleted: 0, domain: ZWSP_NAME } },
    bounds: { surface: "other", searched: ZWSP_NAME, boundedBy: /in your own store/ },
    meaning(text) {
      expect(text).toContain(`no memories matched domain ${ZWSP_LITERAL}`);
      // The name carries an escape, so the answer must explain the escape —
      // once. Asserted universally above; named here because this is the surface
      // where a misread name deletes the wrong store.
      expect(count(text, LEGEND)).toBe(1);
    },
  },
  {
    id: "p",
    what:
      "filtered read scoped to a domain too long to be quoted at all — the case " +
      "where the rule 'print it exactly or not at all' has to give up the name",
    tool: "memory_read",
    args: { query: "x", domain: "d".repeat(300), since: "2020-01-01T00:00:00Z" },
    routes: { [READ]: { items: [] }, [STATS]: { domains: ["engineering"] } },
    bounds: { surface: "empty-read", searched: "d".repeat(300), mustNotProbe: [ROOMS] },
    meaning(text) {
      // A truncated name is not reproducible, so the sentence names nothing and
      // stays true.
      expect(text).toContain("Nothing in the domain you passed matches");
      expect(text).not.toContain("dddd");
      expect(quotedNames(text)).toHaveLength(0);
    },
  },
  {
    id: "t",
    what: "filtered read scoped to an absent domain — head names the scope, note diagnoses it",
    tool: "memory_read",
    args: { query: "x", domain: "marketing", since: "2020-01-01T00:00:00Z" },
    routes: { [READ]: { items: [] }, [STATS]: { domains: ["engineering"] } },
    bounds: { surface: "empty-read", searched: "marketing", mustNotProbe: [ROOMS] },
    meaning(text) {
      expect(text).toContain('Nothing in "marketing" matches within the given time/author filters.');
      expect(text).toContain("No store has that exact name.");
      // A bounded read that finds nothing is not a bad query, so this branch
      // makes no stats call for the total — only the one that checks the name.
      expect(mcp.calls.filter((c) => c.key === STATS)).toHaveLength(1);
    },
  },
  {
    id: "u",
    what:
      "feed with a FUTURE watermark AND an absent domain — the longest concatenation " +
      "this client can produce: head, temporal diagnosis, name diagnosis",
    tool: "memory_list_recent",
    args: { domain: "marketing", since: "2999-01-01T00:00:00Z" },
    routes: { [RECENT]: { items: [] }, [STATS]: { domains: ["engineering"] } },
    bounds: { surface: "empty-read", searched: "marketing", mustNotProbe: [ROOMS] },
    meaning(text) {
      expect(text).toContain('Nothing new in "marketing" since your watermark.');
      expect(text).toMatch(/that watermark is in the FUTURE/);
      expect(text).toContain("No store has that exact name.");
      // Two independent faults, each named once, in the order a reader can act
      // on them. Neither retracts the other.
      expect(text.indexOf("FUTURE")).toBeLessThan(text.indexOf("No store has that exact name"));
    },
  },
  {
    id: "v",
    what: "filtered UNSCOPED read whose room list came back unreadable",
    tool: "memory_read",
    args: { query: "x", until: "2020-01-01T00:00:00Z" },
    routes: { [READ]: { items: [] }, [ROOMS]: { nope: true } },
    bounds: { surface: "empty-read", mustNotProbe: [STATS] },
    meaning(text) {
      expect(text).toContain(
        "Nothing in your own domains matches within the given time/author filters.",
      );
      expect(text).toMatch(/cannot say whether any room went unsearched/);
    },
  },
  {
    id: "w",
    what:
      "memory_list_recent against a core that does not have the feed endpoint — the " +
      "answer must not turn a missing endpoint into a statement about memories",
    tool: "memory_list_recent",
    args: {},
    routes: { [RECENT]: httpError(404, "Not Found") },
    bounds: { surface: "other", mustNotProbe: [ROOMS, STATS] },
    meaning(text) {
      // No absence claim of any kind, and a route to the same data. The wording
      // is NOT pinned: it attributes the 404 to the service, which a gateway or
      // a wrong base URL can also produce — see the report for that finding.
      expect(text).not.toMatch(/no memories/i);
      expect(text).not.toMatch(/nothing/i);
      expect(text).toContain("memory_read");
    },
  },
];

/* ========================================================================= *
 * ONE TEST PER SITUATION
 * ========================================================================= */

describe("the assembled answer, situation by situation", () => {
  for (const s of SITUATIONS) {
    it(`(${s.id}) ${s.what}`, async () => {
      for (const [key, reply] of Object.entries(s.routes)) mcp.on(key, reply);
      const text = await mcp.callText(s.tool, s.args);
      expectHonestAnswer(text, s.bounds);
      s.meaning?.(text);
    });
  }
});

/* ========================================================================= *
 * PROPERTIES ACROSS THE WHOLE MATRIX
 *
 * Some claims are only checkable by comparing situations. "This is the only
 * answer that may say the memory has never been written to" cannot be tested
 * inside the situation that says it — it is a statement about all the others.
 * ========================================================================= */

describe("properties that only hold across situations", () => {
  /** Replay every row and keep the text beside its id. */
  async function replay(): Promise<{ id: string; text: string }[]> {
    const out: { id: string; text: string }[] = [];
    for (const s of SITUATIONS) {
      mcp.reset();
      for (const [key, reply] of Object.entries(s.routes)) mcp.on(key, reply);
      out.push({ id: s.id, text: await mcp.callText(s.tool, s.args) });
    }
    return out;
  }

  it("exactly ONE situation may tell the reader their memory has never been written to", async () => {
    const greeting = (await replay()).filter(({ text }) =>
      ACCOUNT_IS_EMPTY.some((re) => re.test(text)),
    );
    // Not "the greeting is correct in case (c)" — that is asserted there. This is
    // that no OTHER situation reached it: a probe that failed, a room list that
    // could not be parsed, a rooms-only account, a scoped miss. Every one of
    // those reached it at some point in this release's three review rounds.
    expect(greeting.map((g) => g.id)).toEqual(["c"]);
  });

  it("no situation produces an answer that both admits and asserts", async () => {
    for (const { id, text } of await replay()) {
      const admits = COULD_NOT_LOOK.some((re) => re.test(text));
      const asserts = DEFINITE_ABSENCE.some((re) => re.test(text));
      expect(admits && asserts, `(${id}) admits and asserts in one answer:\n${text}`).toBe(false);
    }
  });

  it("no situation produces an answer that ends unfinished", async () => {
    for (const { id, text } of await replay()) {
      expect(DANGLING_TAIL.test(text.trimEnd()), `(${id}) ends unfinished:\n${text}`).toBe(false);
    }
  });

  it("no situation explains its escaping more than once, or without a reason", async () => {
    for (const { id, text } of await replay()) {
      expect(count(text, LEGEND), `(${id}) legend count`).toBe(hasEscapedName(text) ? 1 : 0);
    }
  });
});
