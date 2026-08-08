/**
 * Pins the rendered item contract introduced with the #404 temporal work.
 *
 * The two load-bearing promises:
 * 1. Every item with an atom_id renders the FULL id — memory_feedback and
 *    memory_delete are uncallable without exact ids, and the tool
 *    description has promised them all along (the pre-#404 render never
 *    delivered any: the standing dead-id bug).
 * 2. created_at renders as a compact UTC date tag — a reader cannot
 *    reason about recency it cannot see.
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
  it("renders relevance, content, concepts, author, date and the FULL id", () => {
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
    expect(line).toContain(`id: ${ID}`); // full, untruncated — feedback/delete need it
    // NO score, as of 0.8.1: `relevance` has no floor (so it can never say
    // "I don't know") and exceeds 1.0 after positive feedback (so reads
    // showed "112%"). Rank order carries the ranking; the number claimed a
    // confidence it does not have. Guard against it coming back before there
    // is a signal worth trusting.
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
    const line = formatReadItem({ atom_id: ID, content: "x", relevance: 0.5 }, 0);
    expect(line).not.toContain("·");
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

describe("the escape legend on a page", () => {
  it("explains an escaped domain once for the whole feed, not per line", () => {
    const page = formatRecentPage(
      [
        { content: "a", domain: "eng\u200b" },
        { content: "b", domain: "eng\u200b" },
      ],
      null,
    );
    expect(page).toContain('@"eng\\u200b"');
    expect(page.match(/printed as JSON string literals/g)).toHaveLength(1);
  });

  it("stays silent when every domain printed as itself", () => {
    const page = formatRecentPage([{ content: "a", domain: "eng" }], null);
    expect(page).not.toContain("JSON string literals");
  });
});
