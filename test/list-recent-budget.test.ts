/**
 * A feed page is bounded by SIZE, not only by item count (#104).
 *
 * THE INCIDENT. Catching up on a shared room of long archival entries with
 * `memory_list_recent(domain: "xroom:…", limit: 40, cursor: …)` produced ONE
 * tool result of 72,648 characters. The MCP client (Claude Code) refused to
 * inline it and spilled it to a file; a client without that fallback loses the
 * page outright. The global cap did not fire — MAX_RESULT_CHARS is 96,000 and
 * 72,648 is under it — so the only thing standing between a caller and an
 * unusable page was a `limit` they had to guess right, for entries whose length
 * they cannot know before asking.
 *
 * WHAT THESE TESTS PIN. `limit` is a CEILING on the item count; the page also
 * has a character budget, and whichever binds first ends the page. The handler
 * therefore assembles a page from small sub-requests and stops before the
 * budget is exceeded, returning the server cursor of the last FULLY accepted
 * sub-batch — so the continuation neither skips nor repeats an entry.
 *
 * The one case where the budget yields: a single entry that exceeds it alone is
 * returned whole, as a page of one. Dropping it would be silent data loss, and
 * per-entry truncation needs a fetch-one-by-id verb this server does not have
 * yet (#104, suggestion 2).
 *
 * THE 40,000 BELOW IS THE SAME NUMBER AS `LIST_PAGE_CHAR_BUDGET` in
 * src/index.ts, deliberately transcribed rather than imported: a test that reads
 * the constant it is testing asserts only that arithmetic works. Changing the
 * budget is a two-place edit, and the second place is a test that says why the
 * number is what it is.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { httpError, startMemoryServer, type Harness, type StubbedRequest } from "./harness.js";

const RECENT = "POST /memory/recent";

/** The rendered page must stay under this — see the file header. */
const BUDGET = 40_000;

/** What the client actually choked on. Nothing here may come close to it. */
const INCIDENT_CHARS = 72_648;

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

interface Entry {
  atom_id: string;
  content: string;
}

/**
 * `n` entries whose content is `body` and whose marker is unique and
 * delimited — `ITEM-1|` is not a prefix of `ITEM-10|`, so a `toContain` on one
 * cannot pass because of the other.
 */
function entries(n: number, chars: number, offset = 0): Entry[] {
  return Array.from({ length: n }, (_, i) => ({
    atom_id: `atom_${offset + i}`,
    content: `ITEM-${offset + i}|${"x".repeat(chars)}`,
  }));
}

/**
 * A feed that pages the way core does: honour `limit`, hand back an opaque
 * cursor whenever entries remain. The cursor shape matches the urlsafe-base64
 * regex src/render.ts requires before it will echo a cursor at all.
 */
function pagingFeed(all: Entry[]) {
  return (req: StubbedRequest) => {
    const body = (req.body ?? {}) as { limit?: number; cursor?: string };
    const from = body.cursor ? Number(body.cursor.slice("cur_".length)) : 0;
    const take = body.limit ?? 20;
    const slice = all.slice(from, from + take);
    const end = from + slice.length;
    return { items: slice, next_cursor: end < all.length ? `cur_${end}` : null };
  };
}

/** Every `limit` the handler put on the wire, in order. */
function askedLimits(): number[] {
  return mcp.calls
    .filter((c) => c.key === RECENT)
    .map((c) => (c.body as { limit?: number }).limit ?? 0);
}

// ---------------------------------------------------------------------------

describe("a page of long entries is cut by the byte budget, not by the count", () => {
  it("returns fewer entries than `limit`, under budget, with the cursor of the last accepted batch", async () => {
    // 40 entries × 3,000 chars is the incident's shape: the old handler asked
    // for all 40 in one request and rendered 120,000+ characters.
    mcp.on(RECENT, pagingFeed(entries(40, 3_000)));

    const text = await mcp.callText("memory_list_recent", {
      domain: "xroom:room_01ABC",
      limit: 40,
    });

    expect(text.length).toBeLessThanOrEqual(BUDGET);
    expect(text.length).toBeLessThan(INCIDENT_CHARS);

    // Ten entries fit; the eleventh would not, so it is not on the page — and
    // the cursor points exactly at it.
    expect(text).toContain("ITEM-0|");
    expect(text).toContain("ITEM-9|");
    expect(text).not.toContain("ITEM-10|");
    expect(text).toContain("More older entries exist — pass cursor: cur_10");
    expect(text).not.toContain("end of feed");
  });

  it("does not drop the entries it did not return — the next call continues from the cursor", async () => {
    const feed = entries(40, 3_000);
    mcp.on(RECENT, pagingFeed(feed));

    const first = await mcp.callText("memory_list_recent", { limit: 40 });
    expect(first).toContain("ITEM-9|");
    expect(first).not.toContain("ITEM-10|");

    mcp.reset().on(RECENT, pagingFeed(feed));
    const second = await mcp.callText("memory_list_recent", {
      limit: 40,
      cursor: "cur_10",
    });

    // No skip and no repeat across the boundary: page 2 starts at the entry
    // page 1 stopped before.
    expect(second).toContain("ITEM-10|");
    expect(second).not.toContain("ITEM-9|");
    expect(second.length).toBeLessThanOrEqual(BUDGET);
  });
});

describe("a page of short entries behaves exactly as before", () => {
  it("returns the full `limit` and the same cursor a single request would have", async () => {
    // 100 short entries, `limit: 40` — the budget never binds, so the answer
    // must be indistinguishable from the pre-#104 one-request handler.
    mcp.on(RECENT, pagingFeed(entries(100, 50)));

    const text = await mcp.callText("memory_list_recent", { limit: 40 });

    expect(text).toContain("ITEM-0|");
    expect(text).toContain("ITEM-39|");
    expect(text).not.toContain("ITEM-40|");
    expect(text).toContain("More older entries exist — pass cursor: cur_40");
    expect(text).toContain("40. ");
    expect(text).not.toContain("41. ");
  });

  it("spends the caller's `limit` and no more, in sub-requests no larger than the chunk", async () => {
    // The wire contract that CHANGED here: `limit` is no longer forwarded
    // verbatim (test/tool-wiring.test.ts records the same fact). What must hold
    // is that the sub-requests are small and that they never ask for more
    // entries in total than the caller allowed.
    mcp.on(RECENT, pagingFeed(entries(100, 50)));

    await mcp.callText("memory_list_recent", { limit: 25 });

    const asked = askedLimits();
    expect(asked.every((n) => n >= 1 && n <= 10)).toBe(true);
    expect(asked.reduce((a, b) => a + b, 0)).toBe(25);
  });

  it("forwards every filter on every sub-request, and the caller's cursor only on the first", async () => {
    mcp.on(RECENT, pagingFeed(entries(100, 50)));

    await mcp.callText("memory_list_recent", {
      limit: 25,
      domain: "xroom:room_01ABC",
      since: "2026-08-01T00:00:00Z",
      until: "2026-08-02T00:00:00Z",
      exclude_author: "user_someone_else",
      cursor: "cur_5",
    });

    const sent = mcp.calls
      .filter((c) => c.key === RECENT)
      .map((c) => c.body as Record<string, unknown>);
    expect(sent.length).toBeGreaterThan(1);
    for (const body of sent) {
      // A filter dropped on sub-request 2 would widen the page silently — the
      // exact class of defect test/tool-wiring.test.ts exists for.
      expect(body).toMatchObject({
        domain: "xroom:room_01ABC",
        since: "2026-08-01T00:00:00Z",
        until: "2026-08-02T00:00:00Z",
        exclude_author: "user_someone_else",
      });
    }
    expect(sent[0]).toMatchObject({ cursor: "cur_5" });
    // Sub-request 2 continues from the SERVER's cursor, not the caller's —
    // resending the caller's would replay page one forever.
    expect(sent[1]).toMatchObject({ cursor: "cur_15" });
  });
});

describe("one entry larger than the whole budget", () => {
  it("is returned whole, as a page of one, without looping", async () => {
    // Per-entry truncation would need a fetch-one-by-id verb that does not
    // exist yet (#104), so the budget yields rather than losing the entry.
    const huge: Entry = { atom_id: "atom_huge", content: `HUGE|${"x".repeat(60_000)}` };
    mcp.on(RECENT, pagingFeed([huge, ...entries(20, 50, 1)]));

    const text = await mcp.callText("memory_list_recent", { limit: 20 });

    expect(text).toContain("HUGE|");
    expect(text).not.toContain("ITEM-1|");
    expect(text).toContain("More older entries exist — pass cursor: cur_1");
    // Delivered whole: over the page budget on purpose, and still under the
    // global cap, so nothing was truncated.
    expect(text.length).toBeGreaterThan(BUDGET);
    expect(text).not.toContain("[…truncated");
    // Narrowing an over-budget batch must converge, not thrash.
    expect(askedLimits().length).toBeLessThanOrEqual(6);
  });

  it("does not narrow against a server that ignores `limit`", async () => {
    // A server that answers a 10-ask with 100 entries is not going to answer a
    // 1-ask with fewer, and the global cap is the backstop for it. Re-asking
    // would be three wasted round trips against a broken deployment.
    mcp.on(RECENT, {
      items: entries(100, 1_200),
      next_cursor: null,
    });

    const text = await mcp.callText("memory_list_recent", {});

    expect(askedLimits()).toHaveLength(1);
    expect(text).toContain("[…truncated to fit the 25K token limit.");
  });
});

describe("the end of the feed, reached inside the loop", () => {
  it("is stated honestly when a sub-batch comes back with no cursor", async () => {
    // 15 entries against `limit: 40`: sub-request 1 fills, sub-request 2 runs
    // out. The page must end with the end-of-feed sentence, not with a cursor
    // that continues nothing.
    mcp.on(RECENT, pagingFeed(entries(15, 50)));

    const text = await mcp.callText("memory_list_recent", { limit: 40 });

    expect(text).toContain("ITEM-0|");
    expect(text).toContain("ITEM-14|");
    expect(text).toContain("(end of feed — nothing older)");
    expect(text).not.toContain("pass cursor");
    expect(askedLimits().length).toBe(2);
  });

  it("still answers an empty first page with the feed's own empty heads", async () => {
    // The empty branch is chosen by the CALLER's cursor, unchanged: chunking
    // must not turn "nothing here" into a different sentence, and must not
    // re-ask an empty feed for more of the same nothing.
    mcp
      .on(RECENT, { items: [], next_cursor: null })
      .on("GET /memory/rooms", [
        { room_id: "room_01ABC", name: "me-and-olya", address: "xroom:room_01ABC" },
      ]);

    const text = await mcp.callText("memory_list_recent", {});

    expect(text).toContain("No memories in your own domains yet.");
    expect(askedLimits()).toHaveLength(1);
  });
});

describe("a sub-request that fails after entries were already accepted", () => {
  it("returns the entries it has, says the page stopped early, and keeps the cursor honest", async () => {
    // Chunking multiplies the number of requests per call, so it multiplies the
    // chance that one of them fails mid-page. Throwing the whole page away
    // would make this change a regression for exactly the long-entry rooms it
    // is for; hiding the failure would be the "could-not-fetch spelled like
    // does-not-exist" collision this codebase keeps closing.
    const feed = pagingFeed(entries(100, 50));
    let n = 0;
    mcp.on(RECENT, (req: StubbedRequest) =>
      ++n === 1 ? feed(req) : httpError(503, "down"),
    );

    const text = await mcp.callText("memory_list_recent", { limit: 40 });

    expect(text).toContain("ITEM-0|");
    expect(text).toContain("ITEM-9|");
    expect(text).toContain("More older entries exist — pass cursor: cur_10");
    expect(text).toContain("stopped early");
    expect(text).toContain("did not come back usable");
  });

  it("a page that stopped early still fits the budget, note included", async () => {
    // The note is appended AFTER the batches were sized, so its space is
    // reserved during sizing (CodeRabbit, PR #108) — the invariant pinned here
    // is end-to-end: accepted page PLUS the failure note never exceeds the
    // budget.
    //
    // THE FIXTURE IS A BOUNDARY, and it has to be: with entries far from it
    // this test passed with the reserve deleted, which is the whole thing it
    // exists to catch (CodeRabbit, post-merge on #108). Ten entries of 3,960
    // characters render to 39,907 — 109 over the reserved ceiling of 39,798
    // (BUDGET minus the note), 93 under BUDGET itself. That window is the only
    // place the reserve is observable at all:
    //
    //   WITH the reserve, the ten-entry batch does not fit, so the handler
    //   narrows and accepts five (19,975); the failing continuation appends the
    //   note, and the page ships at 20,177 — under budget.
    //
    //   WITHOUT it, the same batch fits, all ten ship, and the note pushes the
    //   page to 40,109 — 109 over, and the length assertion below fails.
    //
    // The failure is keyed to the CONTINUATION request rather than to a call
    // counter. The narrowing retry re-asks the same position and therefore
    // carries no cursor, so a counter would fail the two arms at different
    // points in the loop for a reason unrelated to the reserve — and, with
    // nothing yet accepted, would surface a raw error instead of a page.
    const feed = pagingFeed(entries(100, 3_960));
    mcp.on(RECENT, (req: StubbedRequest) =>
      (req.body as { cursor?: string } | undefined)?.cursor
        ? httpError(503, "down")
        : feed(req),
    );

    const text = await mcp.callText("memory_list_recent", { limit: 100 });

    expect(text).toContain("ITEM-0|");
    expect(text).toContain("stopped early");
    expect(text.length).toBeLessThanOrEqual(BUDGET);
  });

  it("still surfaces the failure when it happens on the FIRST sub-request", async () => {
    // Nothing was accepted, so there is no page to return and no reason to
    // soften the error — the pre-#104 behaviour, unchanged.
    mcp.on(RECENT, httpError(503, "down"));

    const res = await mcp.call("memory_list_recent", { limit: 40 });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("Mnemoverse");
    expect(res.text).not.toContain("stopped early");
  });
});
