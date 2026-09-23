/**
 * memory_list_recent's structuredContent: a declared outputSchema alongside
 * the unchanged text (S5 of the structured-output plan).
 *
 * Mirrors test/read-structured.test.ts (S4): the item-shape and happy-page
 * cases are ports of the connector's own suite (mnemoverse-mcp-remote/test/
 * mcp-protocol.test.ts) so the two servers pin the SAME structuredContent
 * shape for the SAME core response, adjusted where this package's paging
 * model differs (LIST_PAGE_CHAR_BUDGET, src/tools.ts): a single item with
 * `limit: 1` is used to keep the ported case to the ONE sub-request the
 * connector's single call makes, rather than reproducing this package's
 * multi-request loop for a case that isn't testing it.
 *
 * Uses the SDK-validated path, the real McpServer through test/harness.ts,
 * not a bare call to the handler: a missing or schema-violating
 * structuredContent shows up here as the SDK's own "Output validation
 * error", the guard test/structured-output.test.ts pins against the
 * installed SDK.
 *
 * No test in this file changes an existing expectation. The bare-404 rewire
 * (OD-9: the reply is now isError) touches test/handlers.test.ts,
 * test/errors.test.ts (two cases) and test/assembled.test.ts (situation
 * "w", plus its runner and its cross-situation replay helper), each
 * documented at its own site, and the `domain` fixtures the new item guard
 * requires touch test/list-recent-budget.test.ts and test/tool-wiring.test.ts,
 * also documented at their own sites.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { httpError, startMemoryServer, type Harness, type StubbedRequest } from "./harness.js";

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

/** Route keys, so a typo is a compile-adjacent mistake rather than a silent miss. */
const RECENT = "POST /memory/recent";
const ROOMS = "GET /memory/rooms";

/** One live room, in the shape core returns (mirrors test/handlers.test.ts). */
const ROOM = {
  room_id: "room_01ABC",
  name: "me-and-olya",
  address: "xroom:room_01ABC",
};

describe("memory_list_recent: tools/list carries the output schema", () => {
  it("declares the SAME item shape as memory_read's (memory_id/content/domain/created_at/author), plus next_cursor (string | null), required exactly items+next_cursor", async () => {
    const { tools } = await mcp.client.listTools();
    const recent = tools.find((t) => t.name === "memory_list_recent");
    const read = tools.find((t) => t.name === "memory_read");
    expect(recent?.outputSchema).toBeDefined();
    expect(read?.outputSchema).toBeDefined();

    const schema = recent!.outputSchema as {
      properties?: {
        items?: { type?: string; items?: { properties?: Record<string, unknown>; required?: string[] } };
        next_cursor?: unknown;
      };
      required?: string[];
    };
    // Exactly two top-level fields, both required (a memory_list_recent
    // answer always carries a list, possibly empty, and a cursor value,
    // possibly null).
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["items", "next_cursor"]);
    expect(schema.required?.slice().sort()).toEqual(["items", "next_cursor"]);
    expect(schema.properties?.items?.type).toBe("array");

    const itemSchema = schema.properties?.items?.items;
    expect(Object.keys(itemSchema?.properties ?? {}).sort()).toEqual([
      "author",
      "content",
      "created_at",
      "domain",
      "memory_id",
    ]);
    expect(itemSchema?.required).toEqual(["memory_id", "content", "domain"]);

    // The two tools share ONE item shape (MEMORY_ITEM_OUTPUT, src/tools.ts,
    // S5): assert they still agree rather than each individually matching a
    // copy of the same expectation, which would not catch the two drifting
    // apart.
    const readSchema = read!.outputSchema as {
      properties?: {
        items?: { items?: { properties?: Record<string, unknown>; required?: string[] } };
      };
    };
    const readItemSchema = readSchema.properties?.items?.items;
    expect(Object.keys(itemSchema?.properties ?? {}).sort()).toEqual(
      Object.keys(readItemSchema?.properties ?? {}).sort(),
    );
    expect(itemSchema?.required).toEqual(readItemSchema?.required);
  });
});

describe("memory_list_recent: structuredContent, ported from the connector's happy page", () => {
  it("core's next_cursor is carried, created_at/author are shaped, and the human principal never leaks", async () => {
    // `limit: 1` keeps this to the ONE sub-request the connector's single
    // call makes (ceiling reached after the first accepted batch); see the
    // file header for why.
    mcp.on(RECENT, {
      items: [
        {
          atom_id: "33333333-3333-4333-8333-333333333333",
          content: "newest note",
          domain: "general",
          created_at: "2026-08-02T10:00:00Z",
          concepts: ["note"],
          provenance: {
            principal: "someone@example.com",
            agent: null,
            agent_name: "sigma",
            client_env: null,
            is_external: true,
          },
        },
      ],
      next_cursor: "abc123",
    });

    const result = await mcp.call("memory_list_recent", { limit: 1 });

    expect(result.isError).toBeFalsy();
    expect(mcp.calls.filter((c) => c.key === RECENT)).toHaveLength(1);
    const sc = result.structuredContent as {
      items: Array<Record<string, unknown>>;
      next_cursor: string | null;
    };
    expect(sc.next_cursor).toBe("abc123");
    expect(sc.items[0]?.created_at).toBe("2026-08-02T10:00:00Z");
    expect(sc.items[0]?.author).toBe("sigma · external");
    // The human principal (PII) must never appear anywhere in the result.
    expect(JSON.stringify(result)).not.toContain("someone@example.com");
    expect(result.text).toContain("More older entries exist — pass cursor: abc123");
  });
});

describe("memory_list_recent: structuredContent on a budget-limited page", () => {
  it("carries exactly the accepted items, and next_cursor is the accepted cursor, not the newest seen", async () => {
    // Mirrors list-recent-budget.test.ts's "returns fewer entries than
    // `limit`, under budget, with the cursor of the last accepted batch":
    // 40 entries of 3,000 chars; ten fit the page budget, the eleventh does
    // not, so it must be absent from structuredContent too, not just text.
    const all = Array.from({ length: 40 }, (_, i) => ({
      atom_id: `atom_${i}`,
      content: `ITEM-${i}|${"x".repeat(3_000)}`,
      domain: "general",
    }));
    mcp.on(RECENT, (req: StubbedRequest) => {
      const body = (req.body ?? {}) as { limit?: number; cursor?: string };
      const from = body.cursor ? Number(body.cursor.slice("cur_".length)) : 0;
      const take = body.limit ?? 20;
      const slice = all.slice(from, from + take);
      const end = from + slice.length;
      return { items: slice, next_cursor: end < all.length ? `cur_${end}` : null };
    });

    const result = await mcp.call("memory_list_recent", {
      domain: "xroom:room_01ABC",
      limit: 40,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      items: Array<Record<string, unknown>>;
      next_cursor: string | null;
    };
    expect(sc.items).toHaveLength(10);
    expect(sc.items.map((it) => it.memory_id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `atom_${i}`),
    );
    expect(sc.next_cursor).toBe("cur_10");
    expect(
      sc.items.some((it) => (it.content as string).startsWith("ITEM-10|")),
    ).toBe(false);
  });
});

describe("memory_list_recent: an empty next_cursor becomes null in structuredContent", () => {
  it("mirrors recent-empty-cursor.test.ts: end-of-feed text unchanged, next_cursor null", async () => {
    mcp.on(RECENT, {
      items: [
        { atom_id: "id-1", content: "fact one", domain: "general" },
        { atom_id: "id-2", content: "fact two", domain: "general" },
      ],
      next_cursor: "",
    });

    const result = await mcp.call("memory_list_recent", {});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      items: Array<Record<string, unknown>>;
      next_cursor: string | null;
    };
    expect(sc.next_cursor).toBeNull();
    expect(sc.items).toHaveLength(2);
    expect(result.text).toContain("(end of feed — nothing older)");
  });
});

describe("memory_list_recent: structuredContent on the zero-result branch", () => {
  it("a genuinely empty feed (no filters) carries {items: [], next_cursor: null}, unchanged text", async () => {
    mcp.on(RECENT, { items: [] }).on(ROOMS, []);

    const result = await mcp.call("memory_list_recent", {});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ items: [], next_cursor: null });
    expect(result.text).toContain("No memories in your own domains yet.");
  });

  it("a watermark with nothing new carries the same shape, with the unchanged 'Nothing new' text", async () => {
    mcp.on(RECENT, { items: [] }).on(ROOMS, [ROOM]);

    const result = await mcp.call("memory_list_recent", {
      since: "2020-01-01T00:00:00Z",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ items: [], next_cursor: null });
    expect(result.text).toContain("Nothing new in your own domains since your watermark.");
  });
});

describe("memory_list_recent: the bare-404 degrade is now isError (OD-9)", () => {
  it("isError true, the existing sentence unchanged", async () => {
    mcp.on(RECENT, httpError(404, "Not Found"));

    const result = await mcp.call("memory_list_recent", {});

    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "The memory service does not support the recent-entries feed yet. " +
        "Use memory_read with order_by: 'recency' as an approximation.",
    );
  });
});

describe("memory_list_recent: an accepted item missing a required field is the unreadable-answer error", () => {
  it("an item without domain makes the whole answer isError with the unreadable sentence", async () => {
    mcp.on(RECENT, {
      items: [{ atom_id: "a1", content: "x" }],
      next_cursor: null,
    });

    const result = await mcp.call("memory_list_recent", {});

    expect(result.isError).toBe(true);
    expect(result.text).toContain("shape this client does not recognise");
    expect(result.text).toContain("not evidence that there is nothing to list");
  });
});

describe("memory_list_recent: a capped page still carries every accepted item in structuredContent", () => {
  it("a server that ignores `limit` and returns 100 long items: text is capped, structuredContent carries all 100 uncapped", async () => {
    // Same fixture shape as list-recent-budget.test.ts's "does not narrow
    // against a server that ignores `limit`": a single over-limit batch that
    // the handler ships whole (askedLimits has length 1), long enough to
    // overflow MAX_RESULT_CHARS on its own.
    const items = Array.from({ length: 100 }, (_, i) => ({
      atom_id: `atom_${i}`,
      content: "x".repeat(1_200),
      domain: "general",
    }));
    mcp.on(RECENT, { items, next_cursor: null });

    const result = await mcp.call("memory_list_recent", {});

    expect(result.isError).toBeFalsy();
    expect(mcp.calls.filter((c) => c.key === RECENT)).toHaveLength(1);
    expect(result.text).toContain("[…truncated to fit the 25K token limit.");

    const sc = result.structuredContent as {
      items: Array<Record<string, unknown>>;
      next_cursor: string | null;
    };
    expect(sc.items).toHaveLength(100);
    expect(sc.items[99]).toEqual({
      memory_id: "atom_99",
      content: "x".repeat(1_200),
      domain: "general",
    });
    expect(sc.next_cursor).toBeNull();
  });
});
