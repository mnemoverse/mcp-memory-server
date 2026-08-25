/**
 * Pins the rendered item contract — the #404 temporal work, plus everything
 * 0.8.1 added to or removed from a result line.
 *
 * What this file guarantees, in the order the cases appear:
 * 1. Every item with an atom_id renders the FULL id — memory_feedback is
 *    uncallable without exact ids, and the tool description has promised
 *    them all along (the pre-#404 render never delivered any: the standing
 *    dead-id bug).
 * 2. created_at renders as a compact UTC date tag — a reader cannot
 *    reason about recency it cannot see.
 * 3. NO relevance score reaches a reader, on either surface, at any value
 *    (0.8.1 removal — see the cases in `formatReadItem`).
 * 4. The human `principal` is never surfaced, only agent identity, and a
 *    hostile agent name is sanitised (CN-032).
 * 5. `@"domain"` is an EXACT literal: two stores that differ by a space, a
 *    case or an alphabet render as two tags, an unprintable name says so
 *    instead of vanishing, and every tag round-trips through JSON.parse.
 * 6. The renderers return the page BODY with no escape legend — the caller
 *    (src/index.ts) appends the legend AFTER capResult, so truncation cannot
 *    eat it (truth F6; behavioural pins in test/handlers.test.ts).
 * 7. A value that arrives with the wrong WIRE TYPE degrades the part of the
 *    line it belongs to, and nothing else: it neither throws nor moves a
 *    timestamp into another day (the two cases below).
 *
 * 7. `formatRecentPage`'s end-of-feed tail is a real three-way branch (#67):
 *    no cursor, a cursor that fails the opaque-shape check, and a cursor that
 *    passes it each get their own sentence — a malformed/oversized cursor no
 *    longer prints the same "(end of feed — nothing older)" as an actually
 *    empty feed.
 */
import { describe, expect, it } from "vitest";

import {
  formatAuthorTag,
  formatDateTag,
  formatDomainTag,
  formatReadItem,
  formatRecentItem,
  formatRecentPage,
  safeInline,
} from "../src/render.js";

const ID = "ee5f3a08-2321-4100-9a4b-91ff820c2f96";

describe("formatReadItem", () => {
  it("renders content, concepts, author, date and the FULL id — and no score", () => {
    const line = formatReadItem(
      {
        atom_id: ID,
        content: "Retry with backoff fixed it",
        relevance: 0.82,
        concepts: ["retry", "backoff"],
        created_at: "2026-08-01T21:04:41.605Z",
        provenance: { agent_name: "codex", is_external: true },
      },
      0,
    );
    expect(line).toContain("1. Retry with backoff fixed it (retry, backoff)");
    expect(line).toContain("[by codex · external]");
    expect(line).toContain("· 2026-08-01 21:04Z");
    expect(line).toContain(`id: ${ID}`); // full, untruncated — feedback needs it
    // NO score, as of 0.8.1. There IS a relevance floor — core's
    // `min_relevance` defaults to 0.3 — and this comment used to say there was
    // none, which is the claim src/render.ts and the CHANGELOG both withdrew
    // (review, 2026-08-08). The true statement is that the floor is too low to
    // ever mean "I don't know": a query about something never stored still comes
    // back with near-neighbours at scores indistinguishable from real hits
    // (mnemoverse/mnemoverse-core#449). And the number exceeds 1.0 after
    // positive feedback, so reads showed "112%". Rank order carries the ranking;
    // the percentage claimed a confidence it does not have. Guard against it
    // coming back before there is a signal worth trusting.
    expect(line).not.toMatch(/\[\d+%\]/);
  });

  it("omits the id line when the server sent no atom_id (legacy shape)", () => {
    const line = formatReadItem({ content: "x", relevance: 0.5 }, 0);
    expect(line).not.toContain("id:");
    expect(line).toBe("1. x");
  });

  it("never renders a percentage, even for an out-of-range relevance", () => {
    // 1.12 is real: core returns >1 after positive feedback.
    expect(formatReadItem({ content: "x", relevance: 1.12 }, 0)).toBe("1. x");
  });

  it("omits the date tag for items without created_at", () => {
    // The fixture carries an EXTERNAL author on purpose. `·` is also the
    // separator inside `[by X · external]`, so a bare `not.toContain("·")` on an
    // author-less fixture passed without ever isolating the date tag — the
    // assertion did not test what the case is named for. Assert the date SHAPE.
    const line = formatReadItem(
      {
        atom_id: ID,
        content: "x",
        relevance: 0.5,
        provenance: { agent_name: "codex", is_external: true },
      },
      0,
    );
    expect(line).toContain("[by codex · external]");
    expect(line).not.toMatch(/·\s*\d{4}-\d{2}-\d{2}/);
    expect(line).not.toMatch(/\d{2}:\d{2}Z/);
  });
});

describe("formatRecentItem / formatRecentPage", () => {
  it("leads with the date and carries no relevance score", () => {
    const line = formatRecentItem(
      { atom_id: ID, content: "hello", created_at: "2026-08-02T10:00:00Z" },
      0,
    );
    expect(line).toContain("1. [2026-08-02 10:00Z] hello");
    expect(line).not.toContain("%");
    expect(line).toContain(`id: ${ID}`);
  });

  it("page with next_cursor tells the reader how to continue", () => {
    const page = formatRecentPage(
      [{ atom_id: ID, content: "a", created_at: "2026-08-02T10:00:00Z" }],
      "abc123",
    );
    expect(page).toContain("More older entries exist — pass cursor: abc123");
  });

  it("page without next_cursor says the feed is complete", () => {
    const page = formatRecentPage(
      [{ atom_id: ID, content: "a", created_at: "2026-08-02T10:00:00Z" }],
      null,
    );
    expect(page).toContain("(end of feed — nothing older)");
  });

  it("page with an oversized cursor (fails the opaque-shape check) does NOT claim the feed is empty (#67)", () => {
    // 513 chars — one past the regex's {1,512} cap.
    const oversized = "a".repeat(513);
    const page = formatRecentPage(
      [{ atom_id: ID, content: "a", created_at: "2026-08-02T10:00:00Z" }],
      oversized,
    );
    expect(page).toContain(
      "More entries exist but the continuation token could not be displayed — narrow the window with since/until instead",
    );
    expect(page).not.toContain("(end of feed — nothing older)");
  });

  it("page with a cursor carrying disallowed characters does NOT claim the feed is empty (#67)", () => {
    const page = formatRecentPage(
      [{ atom_id: ID, content: "a", created_at: "2026-08-02T10:00:00Z" }],
      "abc 123/../<script>",
    );
    expect(page).toContain(
      "More entries exist but the continuation token could not be displayed — narrow the window with since/until instead",
    );
    expect(page).not.toContain("(end of feed — nothing older)");
  });
});

describe("author/date/sanitizer edges", () => {
  it("never surfaces the human principal, only agent identity", () => {
    const tag = formatAuthorTag({ principal: "someone@example.com", agent_name: "sigma" });
    expect(tag).toBe(" [by sigma]");
    expect(tag).not.toContain("example.com");
  });

  it("sanitizes hostile agent names (CN-032)", () => {
    const tag = formatAuthorTag({ agent_name: "evil\n]inject[system:" });
    expect(tag).not.toContain("\n");
    expect(tag).not.toContain("]inject[");
  });

  it("formatDateTag survives garbage timestamps", () => {
    expect(formatDateTag("not-a-date")).toBe("");
    expect(formatDateTag(undefined)).toBe("");
  });

  it("safeInline keeps the CN-032 charset/cap contract", () => {
    expect(safeInline("  a   b  ", 200)).toBe("a b");
    expect(safeInline("x".repeat(300), 200)).toHaveLength(200);
  });
});

/**
 * WHAT THE WIRE ACTUALLY SENDS, versus what the response types say it sends.
 *
 * `ReadItem`, `RecentItem` and every `apiFetch<{…}>` shape in src/index.ts are
 * aspirational: they describe the payload core is supposed to produce, and
 * nothing narrows the payload that arrives. `asRoom` (src/scope.ts) already
 * closed this class for the room list, where the same defect was recorded as
 * "a latent crash fixed" — these are the renderer-side call sites that fix did
 * not reach.
 *
 * The blast radius is the whole tool call, not the field: the MCP SDK turns a
 * thrown Error into the ENTIRE result, so one numeric `agent_name` on one item
 * of fifty replaced the page with `(s ?? "").replace is not a function` — a
 * message with no `Mnemoverse: ` prefix (the property every error owes the
 * reader, test/errors.test.ts) and nothing an agent can act on.
 */
describe("a non-string where the type promised a string", () => {
  /** A value as the WIRE sends it, cast into the slot the types describe. */
  const wire = <T,>(v: unknown): T => v as T;

  it("safeInline renders nothing rather than throwing", () => {
    for (const v of [123, 0, true, false, {}, [], { toString: () => "x" }]) {
      expect(safeInline(v)).toBe("");
    }
    // The two it always handled stay handled.
    expect(safeInline(null)).toBe("");
    expect(safeInline(undefined)).toBe("");
  });

  it("formatAuthorTag drops the tag instead of killing the line", () => {
    expect(formatAuthorTag(wire({ agent_name: 12345 }))).toBe("");
    expect(formatAuthorTag(wire({ agent: { id: 7 } }))).toBe("");
    // The preference order is NOT re-ordered around an unrenderable value: if
    // the server said the agent's name is `12345`, this line has no name to
    // print and says nothing, rather than quietly promoting a different field
    // to "the author".
    expect(formatAuthorTag(wire({ agent_name: 12345, agent: "codex" }))).toBe("");
    // A field that is absent rather than broken still falls through, as before.
    expect(formatAuthorTag({ agent_name: null, agent: "codex" })).toBe(" [by codex]");
  });

  it("a broken item renders as a line, not as an exception", () => {
    expect(formatReadItem(wire({ content: "x", provenance: { agent_name: 5 } }), 0)).toBe(
      "1. x",
    );
  });

  it("formatDateTag refuses a non-string timestamp instead of guessing", () => {
    // `new Date(1754082281605)` is a perfectly good date, so the old code
    // printed one — for a field whose contract is an ISO-8601 string. A value
    // that cannot be read as the contract says degrades to no tag, exactly like
    // a legacy atom with no timestamp at all.
    expect(formatDateTag(wire(1754082281605))).toBe("");
    expect(formatDateTag(wire({}))).toBe("");
  });
});

/**
 * THE ZONE BUG: `new Date("2026-08-01T21:04:41").toISOString()` reads an
 * offset-less timestamp as LOCAL time and then prints it with a `Z`, so the
 * same atom rendered a different clock time in every timezone — and, west of
 * UTC, a different DAY.
 *
 * The convention is written down twice and was implemented once: the `since`
 * parameter descriptions say naive means UTC, and `parseAsUtc` (src/time.ts,
 * extracted from src/scope.ts where the same fix landed for the future-
 * watermark note in 0.8.1) implements it. This renderer read the same wire
 * value the other way.
 *
 * These cases are invisible under TZ=UTC — with the bug in place they pass —
 * which is why the CI matrix pins a zone east of UTC and one west of it.
 */
describe("formatDateTag reads a naive timestamp as UTC, as the engine does", () => {
  it("does not restamp a local reading as Z", () => {
    expect(formatDateTag("2026-08-01T21:04:41")).toBe(" · 2026-08-01 21:04Z");
    // Core's `created_at` is also seen with a space separator.
    expect(formatDateTag("2026-08-01 21:04:41")).toBe(" · 2026-08-01 21:04Z");
  });

  it("does not move a late-evening memory into another day", () => {
    // The case a reader would actually notice: in America/Los_Angeles this
    // printed `2026-08-02 06:30Z`, dating a memory to a day it was not written.
    expect(formatDateTag("2026-08-01T23:30:00")).toBe(" · 2026-08-01 23:30Z");
    expect(formatDateTag("2026-08-01T00:30:00")).toBe(" · 2026-08-01 00:30Z");
  });

  it("still honours an explicit offset, and a date-only value", () => {
    expect(formatDateTag("2026-08-01T21:04:41Z")).toBe(" · 2026-08-01 21:04Z");
    expect(formatDateTag("2026-08-01T23:04:41+02:00")).toBe(" · 2026-08-01 21:04Z");
    expect(formatDateTag("2026-08-01T17:04:41-04:00")).toBe(" · 2026-08-01 21:04Z");
    // Date-only is already UTC by spec — unchanged.
    expect(formatDateTag("2026-08-01")).toBe(" · 2026-08-01 00:00Z");
  });

  it("carries into both item lines", () => {
    expect(formatReadItem({ content: "x", created_at: "2026-08-01T23:30:00" }, 0)).toBe(
      "1. x · 2026-08-01 23:30Z",
    );
    expect(formatRecentItem({ content: "x", created_at: "2026-08-01T23:30:00" }, 0)).toBe(
      "1. [2026-08-01 23:30Z] x",
    );
  });
});

/**
 * The `@domain` tag exists to answer ONE question — "is this memory mine, or
 * did it come from another store?" — after an unscoped search returned five
 * different people's "Maria Chen" from five projects (dogfood, 2026-08-07).
 *
 * It shipped rendered through `safeInline`, which erases exactly the
 * differences it was built to show. Everything below is a case where the tag
 * pointed at the wrong store, or at no store, or at two stores at once.
 */
describe("formatDomainTag", () => {
  it("prints the domain exactly, so a padded store is not shown as the clean one", () => {
    expect(formatDomainTag(" engineering")).toBe(' @" engineering"');
    expect(formatDomainTag("engineering")).toBe(' @"engineering"');
    expect(formatDomainTag(" engineering")).not.toBe(formatDomainTag("engineering"));
  });

  it("stops hiding a store called ' general' inside the default bucket", () => {
    // The suppression test ran on the SANITISED value, so " general" became
    // "general" and the tag disappeared — a memory from a padded store rendered
    // as if it came from the caller's own default bucket, on the very line
    // built to tell stores apart.
    expect(formatDomainTag(" general")).toBe(' @" general"');
    expect(formatDomainTag("General")).toBe(' @"General"');
    // Only the literal default bucket is still suppressed, and that is
    // deliberate: tagging every line "@general" is noise on the common case.
    expect(formatDomainTag("general")).toBe("");
    expect(formatDomainTag(undefined)).toBe("");
    expect(formatDomainTag("")).toBe("");
  });

  it("keeps two non-Latin stores apart — they used to print as one tag", () => {
    // safeInline's charset is ASCII \w, so both of these came out as "@:acme":
    // the disambiguator merged the two stores it exists to separate.
    const a = formatDomainTag("проект:acme");
    const b = formatDomainTag("план:acme");
    expect(a).toBe(' @"проект:acme"');
    expect(a).not.toBe(b);
  });

  it("makes an invisible character visible instead of dropping it", () => {
    expect(formatDomainTag("engineering\u200b")).toBe(' @"engineering\\u200b"');
    expect(formatDomainTag("team\u00a0eng")).toBe(' @"team\\u00a0eng"');
  });

  it("renders a tag a reader can turn back into a domain argument", () => {
    for (const domain of [
      " engineering",
      "проект:acme",
      "a\nb",
      'say "hi"',
      "xroom:room_01ABC",
    ]) {
      const tag = formatDomainTag(domain);
      expect(JSON.parse(tag.replace(" @", ""))).toBe(domain);
    }
  });

  it("says the name is missing rather than vanishing, when it will not fit", () => {
    // An ABSENT tag is not neutral: it means "the caller's default bucket". A
    // name cannot be printed exactly must not be rendered as that claim.
    const tag = formatDomainTag("x".repeat(400));
    expect(tag).not.toBe("");
    expect(tag).toMatch(/cannot be printed exactly/);
    expect(tag).not.toContain("xxxx");
  });

  it("carries into the item line", () => {
    const line = formatReadItem({ content: "x", domain: " engineering" }, 0);
    expect(line).toContain('@" engineering"');
  });
});

describe("the escape legend and the page body", () => {
  it("returns the body without a legend — the caller legends the CAPPED text", () => {
    // The legend used to be appended here, BEFORE src/index.ts applied
    // capResult — so on every page long enough to be capped, the truncation
    // ate the legend first, leaving escaped @tags with nothing decoding them
    // (truth F6, 2026-08-08). The renderer now returns the body only; the
    // caller appends the legend after the cap, and the behavioural pins live
    // in test/handlers.test.ts ("the escape legend survives the size cap").
    const page = formatRecentPage(
      [
        { content: "a", domain: "eng\u200b" },
        { content: "b", domain: "eng\u200b" },
      ],
      null,
    );
    expect(page).toContain('@"eng\\u200b"');
    expect(page).not.toContain("printed as JSON string literals");
  });
});
