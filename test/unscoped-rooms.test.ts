/**
 * An UNSCOPED read or feed names the shared rooms it did not search, in the
 * text AND in `structuredContent.rooms_not_searched`, on a hit as well as on a
 * miss.
 *
 * Why both halves. Until this field existed the disclosure lived in the text
 * only, and only on a miss. On 2026-10-23 a Claude Code session searched for a
 * file another agent had handed off in a shared room: the client gave the model
 * `structuredContent`, which was `{"items":[]}`, and nothing else. Twenty live
 * rooms held the answer, and nothing on the result said any existed.
 *
 * Why a hit too. A match in your own domains says nothing about what a room
 * holds; stopping the disclosure at the first own-domain hit is how the room
 * stays invisible exactly when the query was close enough to match something.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DOMAIN_ESCAPE_LEGEND } from "../src/names.js";
import { MAX_RESULT_CHARS } from "../src/tools.js";
import { httpError, startMemoryServer, type Harness } from "./harness.js";

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

const READ = "POST /memory/read";
const RECENT = "POST /memory/recent";
const ROOMS = "GET /memory/rooms";
const STATS = "GET /memory/stats";

/** A live room with every field core's RoomListItemSchema sends. */
const ROOM = {
  room_id: "room_01KX77",
  name: "eduard-olya-room",
  address: "xroom:room_01KX77",
  role: "owner",
  scope: "read_write",
  archived: false,
};
const ARCHIVED = { ...ROOM, room_id: "room_01OLD", address: "xroom:room_01OLD", archived: true };

const HIT = { atom_id: "atom_1", content: "Deploy runs on Fridays.", domain: "engineering" };

describe("memory_read, unscoped: the rooms it did not search", () => {
  it("a HIT names the live rooms, in the text and in rooms_not_searched", async () => {
    mcp.on(READ, { items: [HIT], search_time_ms: 9 }).on(ROOMS, [ROOM, ARCHIVED]);

    const result = await mcp.call("memory_read", { query: "deploy day" });

    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("1. Deploy runs on Fridays.");
    expect(result.text).toContain('domain="xroom:room_01KX77"');
    // The archived room is not offered as something to read: it refuses reads.
    expect(result.text).not.toContain("xroom:room_01OLD");
    expect(result.structuredContent).toEqual({
      items: [{ memory_id: "atom_1", content: "Deploy runs on Fridays.", domain: "engineering" }],
      rooms_not_searched: {
        state: "live",
        rooms: [ROOM],
        note: expect.stringContaining("1 room went unsearched"),
      },
    });
  });

  it("an EMPTY read carries the rooms too: the 2026-10-23 case, which returned only {items: []}", async () => {
    mcp.on(READ, { items: [] }).on(ROOMS, [ROOM]).on(STATS, { total_atoms: 5 });

    const result = await mcp.call("memory_read", { query: "promo video" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      items: [],
      rooms_not_searched: {
        state: "live",
        rooms: [ROOM],
        note: expect.stringContaining('domain="xroom:room_01KX77"'),
      },
    });
  });

  it("with no rooms at all, a hit is unchanged: no note, no field", async () => {
    mcp.on(READ, { items: [HIT], search_time_ms: 9 }).on(ROOMS, []);

    const result = await mcp.call("memory_read", { query: "deploy day" });

    expect(result.text).not.toContain("Scope:");
    expect(result.structuredContent).toEqual({
      items: [{ memory_id: "atom_1", content: "Deploy runs on Fridays.", domain: "engineering" }],
    });
  });

  it("a room list that cannot be fetched is 'unknown', never 'no rooms', and the hit still comes back", async () => {
    mcp.on(READ, { items: [HIT], search_time_ms: 9 }).on(ROOMS, httpError(503, "down"));

    const result = await mcp.call("memory_read", { query: "deploy day" });

    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("1. Deploy runs on Fridays.");
    expect(result.text).toContain("the room list could not be fetched just now");
    expect(result.structuredContent).toMatchObject({
      rooms_not_searched: { state: "unknown" },
    });
    expect(
      (result.structuredContent as { rooms_not_searched: object }).rooms_not_searched,
    ).not.toHaveProperty("rooms");
  });

  it("every room archived is 'archived-only', with no rooms to offer", async () => {
    mcp.on(READ, { items: [HIT], search_time_ms: 9 }).on(ROOMS, [ARCHIVED]);

    const result = await mcp.call("memory_read", { query: "deploy day" });

    expect(result.structuredContent).toMatchObject({
      rooms_not_searched: {
        state: "archived-only",
        note: expect.stringContaining("archived"),
      },
    });
    expect(
      (result.structuredContent as { rooms_not_searched: object }).rooms_not_searched,
    ).not.toHaveProperty("rooms");
  });

  it("a row core would never send (no role) is dropped from the data, and still named in the text", async () => {
    const { role: _dropped, ...noRole } = ROOM;
    mcp.on(READ, { items: [HIT], search_time_ms: 9 }).on(ROOMS, [noRole]);

    const result = await mcp.call("memory_read", { query: "deploy day" });

    expect(result.text).toContain('domain="xroom:room_01KX77"');
    expect(result.structuredContent).toMatchObject({
      rooms_not_searched: { state: "live", rooms: [] },
    });
  });

  it("the note comes after the page, timing line included", async () => {
    mcp.on(READ, { items: [HIT], search_time_ms: 9 }).on(ROOMS, [ROOM]);

    const text = await mcp.callText("memory_read", { query: "deploy day" });

    expect(text.indexOf("(9ms)")).toBeGreaterThan(-1);
    expect(text.indexOf("Scope:")).toBeGreaterThan(text.indexOf("(9ms)"));
    expect(text.trimEnd().endsWith("Re-run with domain set to one of these to read it.")).toBe(true);
  });

  it("an escaped domain tag AND an escaped room name share ONE legend, at the end", async () => {
    mcp
      .on(READ, { items: [{ ...HIT, domain: "a b" }], search_time_ms: 9 })
      .on(ROOMS, [{ ...ROOM, name: "Zo e" }]);

    const text = await mcp.callText("memory_read", { query: "deploy day" });

    expect(text.split(DOMAIN_ESCAPE_LEGEND).length - 1).toBe(1);
    expect(text.endsWith(DOMAIN_ESCAPE_LEGEND)).toBe(true);
  });

  it("a capped hit page still fits the cap WITH the note, and the note survives whole", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      atom_id: `atom_${i}`,
      content: "x".repeat(4000),
      domain: "general",
    }));
    mcp.on(READ, { items, search_time_ms: 9 }).on(ROOMS, [ROOM]);

    const text = await mcp.callText("memory_read", { query: "everything" });

    expect(text).toContain("[…truncated to fit the 25K token limit.");
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(text).toContain('domain="xroom:room_01KX77"');
    expect(text.trimEnd().endsWith("Re-run with domain set to one of these to read it.")).toBe(true);
  });

  it("a capped page with an ESCAPED tag and a plain room name fits the cap with note AND legend", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      atom_id: `atom_${i}`,
      content: "x".repeat(4000),
      domain: "a b",
    }));
    mcp.on(READ, { items, search_time_ms: 9 }).on(ROOMS, [ROOM]);

    const text = await mcp.callText("memory_read", { query: "everything" });

    expect(text).toContain("[…truncated to fit the 25K token limit.");
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(text).toContain('domain="xroom:room_01KX77"');
    expect(text.split(DOMAIN_ESCAPE_LEGEND).length - 1).toBe(1);
    expect(text.endsWith(DOMAIN_ESCAPE_LEGEND)).toBe(true);
  });

  it("a capped SCOPED page with an escaped tag fits the cap with its legend too (it used to overshoot by the legend)", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      atom_id: `atom_${i}`,
      content: "x".repeat(4000),
      domain: "a b",
    }));
    mcp.on(READ, { items, search_time_ms: 9 });

    const text = await mcp.callText("memory_read", { query: "everything", domain: "a b" });

    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(text.endsWith(DOMAIN_ESCAPE_LEGEND)).toBe(true);
  });

  it("a read that FAILS spends no room probe: the list is fetched only after a successful read", async () => {
    mcp.on(READ, httpError(503, "down"));

    const result = await mcp.call("memory_read", { query: "deploy day" });

    expect(result.isError).toBe(true);
    expect(mcp.calls.map((c) => c.key)).toEqual([READ]);
  });
});

describe("memory_read, scoped: it searched exactly what it named", () => {
  it("a scoped hit makes no room request and carries no rooms_not_searched", async () => {
    mcp.on(READ, { items: [HIT], search_time_ms: 9 });

    const result = await mcp.call("memory_read", { query: "deploy day", domain: "engineering" });

    expect(mcp.calls.map((c) => c.key)).toEqual([READ]);
    expect(result.text).not.toContain("Scope:");
    expect(result.structuredContent).not.toHaveProperty("rooms_not_searched");
  });
});

describe("memory_list_recent, unscoped: the rooms the page did not cover", () => {
  it("a page names the live rooms, in the text and in rooms_not_searched", async () => {
    mcp.on(RECENT, { items: [HIT], next_cursor: null }).on(ROOMS, [ROOM]);

    const result = await mcp.call("memory_list_recent", {});

    expect(result.isError).toBeFalsy();
    expect(result.text).toContain('domain="xroom:room_01KX77"');
    expect(result.structuredContent).toEqual({
      items: [{ memory_id: "atom_1", content: "Deploy runs on Fridays.", domain: "engineering" }],
      next_cursor: null,
      rooms_not_searched: {
        state: "live",
        rooms: [ROOM],
        note: expect.stringContaining("1 room went unsearched"),
      },
    });
  });

  it("a continuation page carries it too, so its absence keeps meaning 'no rooms'", async () => {
    mcp.on(RECENT, { items: [HIT], next_cursor: null }).on(ROOMS, [ROOM]);

    const result = await mcp.call("memory_list_recent", { cursor: "cur_5" });

    expect(result.structuredContent).toMatchObject({
      rooms_not_searched: { state: "live", rooms: [ROOM] },
    });
  });

  it("an escaped domain tag AND an escaped room name share ONE legend, at the end", async () => {
    mcp
      .on(RECENT, { items: [{ ...HIT, domain: "a b" }], next_cursor: null })
      .on(ROOMS, [{ ...ROOM, name: "Zo e" }]);

    const text = await mcp.callText("memory_list_recent", {});

    expect(text.split(DOMAIN_ESCAPE_LEGEND).length - 1).toBe(1);
    expect(text.endsWith(DOMAIN_ESCAPE_LEGEND)).toBe(true);
  });

  it("one oversized entry with an ESCAPED tag and a plain room name fits the cap with its note", async () => {
    mcp
      .on(RECENT, {
        items: [{ ...HIT, content: "x".repeat(120_000), domain: "a b" }],
        next_cursor: null,
      })
      .on(ROOMS, [ROOM]);

    const text = await mcp.callText("memory_list_recent", {});

    expect(text).toContain("[…truncated to fit the 25K token limit.");
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(text).toContain('domain="xroom:room_01KX77"');
    // The feed prints the tag after the content, so the cap removed it; the
    // legend leaves with the last escaped name (handlers.test.ts pins that).
    // The reserve was still taken, so the length bound above holds either way.
    expect(text.split(DOMAIN_ESCAPE_LEGEND).length - 1).toBeLessThanOrEqual(1);
  });

  it("a feed whose first batch FAILS spends no room probe", async () => {
    mcp.on(RECENT, httpError(503, "down"));

    const result = await mcp.call("memory_list_recent", {});

    expect(result.isError).toBe(true);
    expect(mcp.calls.every((c) => c.key === RECENT)).toBe(true);
  });

  it("a scoped page makes no room request and carries no rooms_not_searched", async () => {
    mcp.on(RECENT, { items: [HIT], next_cursor: null });

    const result = await mcp.call("memory_list_recent", { domain: "engineering" });

    expect(mcp.calls.map((c) => c.key)).toEqual([RECENT]);
    expect(result.structuredContent).not.toHaveProperty("rooms_not_searched");
  });

  it("a page read FROM a room makes no room-list request either: it searched that room", async () => {
    mcp.on(RECENT, { items: [{ ...HIT, domain: ROOM.address }], next_cursor: null });

    const result = await mcp.call("memory_list_recent", { domain: ROOM.address });

    expect(mcp.calls.map((c) => c.key)).toEqual([RECENT]);
    expect(result.structuredContent).not.toHaveProperty("rooms_not_searched");
  });
});
