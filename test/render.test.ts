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
