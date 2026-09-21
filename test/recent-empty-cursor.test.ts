/**
 * An empty `next_cursor` is the end of the feed, and the page must say so.
 *
 * The paging loop in memory_list_recent treated "" as "no cursor" when
 * deciding to stop, but handed the raw "" to formatRecentPage, which treats
 * only null/undefined as the end. So a feed that had ended was rendered as
 * "More entries exist but the continuation token could not be displayed", an
 * existence claim on no evidence, the could-not-render/does-not-exist
 * collision render.ts documents. Found by CodeRabbit on #144 in code that PR
 * moved verbatim; it predates the move.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startMemoryServer, type Harness } from "./harness.js";

const RECENT = "POST /memory/recent";
const COULD_NOT_DISPLAY = "More entries exist but the continuation token could not be displayed";
const END = "(end of feed — nothing older)";

function item(n: number, content = `fact number ${n}`) {
  return {
    atom_id: `3f2b8c1e-9d4a-4c6b-8e2f-${String(n).padStart(12, "0")}`,
    content,
    domain: "general",
    created_at: "2026-09-01T00:00:00Z",
  };
}

let mcp: Harness;
beforeAll(async () => {
  mcp = await startMemoryServer();
});
beforeEach(() => {
  mcp.reset();
});
afterAll(async () => {
  await mcp.close();
});

describe("memory_list_recent with an empty next_cursor", () => {
  it("an ordinary page ends the feed instead of claiming more entries exist", async () => {
    mcp.on(RECENT, { items: [item(1), item(2)], next_cursor: "" });
    const text = await mcp.callText("memory_list_recent", {});
    expect(text).toContain(END);
    expect(text).not.toContain(COULD_NOT_DISPLAY);
  });

  it("a single over-budget batch ends the feed the same way", async () => {
    // Ten entries of 6,000 characters exceed the 40,000-character page budget
    // on their own, which takes the other assignment of the cursor.
    const big = Array.from({ length: 10 }, (_, i) => item(i + 1, `${i}:` + "x".repeat(6_000)));
    mcp.on(RECENT, { items: big, next_cursor: "" });
    const text = await mcp.callText("memory_list_recent", {});
    expect(text).toContain(END);
    expect(text).not.toContain(COULD_NOT_DISPLAY);
  });

  it("a malformed non-empty cursor still says more entries exist (unchanged)", async () => {
    mcp.on(RECENT, { items: [item(1)], next_cursor: "not a valid cursor!" });
    const text = await mcp.callText("memory_list_recent", {});
    expect(text).toContain(COULD_NOT_DISPLAY);
  });
});
