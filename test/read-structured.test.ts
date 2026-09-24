/**
 * memory_read's structuredContent: a declared outputSchema alongside the
 * unchanged text (S4 of the structured-output plan).
 *
 * Mirrors test/write-structured.test.ts (S3): the item-shape and author cases
 * are ports of the connector's own suite (mnemoverse-mcp-remote/test/mcp-
 * protocol.test.ts) so the two servers pin the SAME structuredContent shape
 * for the SAME core response, where this package's memory_read text allows
 * it: this package's non-empty answer has never carried the connector's
 * "Found N matching memories." head sentence (it leads straight with the
 * numbered lines), so the text assertions below pin THIS package's actual
 * wording rather than the connector's.
 *
 * Uses the SDK-validated path, the real McpServer through test/harness.ts,
 * not a bare call to the handler: a missing or schema-violating
 * structuredContent shows up here as the SDK's own "Output validation
 * error", the guard test/structured-output.test.ts pins against the
 * installed SDK. No test in this file changes an existing expectation;
 * test/handlers.test.ts, test/tool-wiring.test.ts and test/render.test.ts
 * carry the S4 deviations, each documented at its own site.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startMemoryServer, type Harness } from "./harness.js";

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
const READ = "POST /memory/read";
const STATS = "GET /memory/stats";
const ROOMS = "GET /memory/rooms";

/** One live room, in the shape core returns (mirrors test/handlers.test.ts). */
const ROOM = {
  room_id: "room_01ABC",
  name: "me-and-olya",
  address: "xroom:room_01ABC",
};

describe("memory_read: tools/list carries the output schema", () => {
  it("declares items as objects with memory_id/content/domain/created_at/author, item-required exactly memory_id+content+domain", async () => {
    const { tools } = await mcp.client.listTools();
    const read = tools.find((t) => t.name === "memory_read");
    expect(read?.outputSchema).toBeDefined();
    const schema = read!.outputSchema as {
      properties?: {
        items?: {
          type?: string;
          items?: { properties?: Record<string, unknown>; required?: string[] };
        };
      };
      required?: string[];
    };
    // The top-level shape has exactly one field, `items`, and it is required
    // (never optional: a memory_read answer always carries a list, possibly
    // empty).
    expect(Object.keys(schema.properties ?? {})).toEqual(["items"]);
    expect(schema.required).toEqual(["items"]);

    expect(schema.properties?.items?.type).toBe("array");
    const itemSchema = schema.properties?.items?.items;
    expect(Object.keys(itemSchema?.properties ?? {}).sort()).toEqual([
      "author",
      "content",
      "created_at",
      "domain",
      "memory_id",
    ]);
    // Exactly the three fields core's MemoryItemSchema always sends; the
    // other two (created_at, author) are conditional on the wire.
    expect(itemSchema?.required).toEqual(["memory_id", "content", "domain"]);
  });
});

describe("memory_read: structuredContent, ported from the connector's item shape", () => {
  it("one item with only atom_id/content/domain (atom_7 is not a UUID, OD-7) carries exactly those three keys", async () => {
    mcp.on(READ, {
      items: [{ atom_id: "atom_7", content: "Rotations preserve symmetry.", domain: "arc" }],
      search_time_ms: 12,
    });

    const result = await mcp.call("memory_read", { query: "rotation patterns" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      items: [{ memory_id: "atom_7", content: "Rotations preserve symmetry.", domain: "arc" }],
    });
    // THIS package's non-empty memory_read text has no "Found N matching…"
    // head sentence (that wording belongs to the connector's own copy); it
    // leads straight with the numbered line, so the stable substring to pin
    // is the rendered item itself.
    expect(result.text).toContain('1. Rotations preserve symmetry. @"arc"');
    expect(result.text).toContain("id: atom_7");
  });
});

describe("memory_read: structuredContent on the two empty branches", () => {
  it("a genuinely empty store (the teaching/greeting branch) carries {items: []}", async () => {
    mcp.on(READ, { items: [] }).on(ROOMS, []).on(STATS, { total_atoms: 0 });

    const result = await mcp.call("memory_read", { query: "anything" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ items: [] });
  });

  it("a filtered empty read (since/until/exclude_author) carries {items: []} with the unchanged filtered-copy text", async () => {
    mcp.on(READ, { items: [] }).on(ROOMS, [ROOM]);

    const result = await mcp.call("memory_read", {
      query: "any new messages",
      since: "2020-01-01T00:00:00Z",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ items: [] });
    expect(result.text).toContain(
      "Nothing in your own domains matches within the given time/author filters.",
    );
  });
});

describe("memory_read: author in structuredContent", () => {
  it("an external agent's provenance becomes \"sigma · external\", the text keeps the bracket tag, and the human principal never appears", async () => {
    mcp.on(READ, {
      items: [
        {
          atom_id: "atom_1",
          content: "status update",
          domain: "xroom:room_01ABC",
          provenance: {
            agent_name: "sigma",
            is_external: true,
            principal: "someone@example.com",
          },
        },
      ],
      search_time_ms: 5,
    });

    const result = await mcp.call("memory_read", { query: "status" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { items: Array<Record<string, unknown>> };
    expect(sc.items[0]?.author).toBe("sigma · external");
    // Quoted as an exact JSON literal since I66-1 (issue #66, 2026-09-24):
    // full symmetry with the `@domain` tag, applied to every author name.
    expect(result.text).toContain('[by "sigma" · external]');
    expect(JSON.stringify(result)).not.toContain("someone@example.com");
  });

  it("carries a non-Latin author name in BOTH the text tag and structuredContent.author, where safeInline used to erase it from both (I66-1/I66-2)", async () => {
    mcp.on(READ, {
      items: [
        {
          atom_id: "atom_2",
          content: "статус",
          domain: "general",
          provenance: { agent_name: "Ольга" },
        },
      ],
      search_time_ms: 5,
    });

    const result = await mcp.call("memory_read", { query: "status" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { items: Array<Record<string, unknown>> };
    expect(sc.items[0]?.author).toBe("Ольга");
    expect(result.text).toContain('[by "Ольга"]');
  });
});

describe("memory_read: created_at in structuredContent", () => {
  it("a string created_at is carried; an absent one leaves the key out; a non-string one (number) also leaves it out", async () => {
    mcp.on(READ, {
      items: [
        { atom_id: "a1", content: "x", domain: "general", created_at: "2026-08-02T10:00:00Z" },
        { atom_id: "a2", content: "y", domain: "general" },
        // A wire value with the wrong TYPE (core's contract is a string); this
        // is the same "degrade the field, not the call" class render.test.ts
        // pins at the unit level for formatDateTag.
        { atom_id: "a3", content: "z", domain: "general", created_at: 1754082281605 },
        // Offset-less: UTC by contract, re-emitted as the UTC instant the text
        // renders so a consumer cannot read it as local time.
        { atom_id: "a4", content: "w", domain: "general", created_at: "2026-08-02T10:00:00" },
      ],
      search_time_ms: 1,
    });

    const result = await mcp.call("memory_read", { query: "x" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { items: Array<Record<string, unknown>> };
    expect(sc.items[0]).toEqual({
      memory_id: "a1",
      content: "x",
      domain: "general",
      created_at: "2026-08-02T10:00:00Z",
    });
    expect(sc.items[1]).toEqual({ memory_id: "a2", content: "y", domain: "general" });
    expect(sc.items[1]).not.toHaveProperty("created_at");
    expect(sc.items[2]).toEqual({ memory_id: "a3", content: "z", domain: "general" });
    expect(sc.items[2]).not.toHaveProperty("created_at");
    expect(sc.items[3]).toEqual({
      memory_id: "a4",
      content: "w",
      domain: "general",
      created_at: "2026-08-02T10:00:00.000Z",
    });
    expect(result.text).toContain("2026-08-02 10:00Z");
  });
});

describe("memory_read: an item missing a required field is the unreadable-answer error", () => {
  it("an item without atom_id makes the whole answer isError with the unreadable sentence", async () => {
    mcp.on(READ, {
      items: [{ content: "x", domain: "general" }],
      search_time_ms: 1,
    });

    const result = await mcp.call("memory_read", { query: "x" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("shape this client does not recognise");
  });

  it("an item without content makes the whole answer isError with the unreadable sentence", async () => {
    mcp.on(READ, {
      items: [{ atom_id: "a1", domain: "general" }],
      search_time_ms: 1,
    });

    const result = await mcp.call("memory_read", { query: "x" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("shape this client does not recognise");
  });

  it("an item without domain makes the whole answer isError with the unreadable sentence", async () => {
    mcp.on(READ, {
      items: [{ atom_id: "a1", content: "x" }],
      search_time_ms: 1,
    });

    const result = await mcp.call("memory_read", { query: "x" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("shape this client does not recognise");
  });
});

describe("memory_read: a capped read still carries every item in structuredContent, not just the text", () => {
  it("30 items of ~4000 chars overflow the text cap, but structuredContent carries all 30, uncapped", async () => {
    // Same overflow shape as the truncation-wording case this replaces in
    // test/handlers.test.ts (see its REWIRED comment): these items DO carry a
    // domain, so the item guard passes and the cap path is actually reached.
    const items = Array.from({ length: 30 }, (_, i) => ({
      atom_id: `atom_${i}`,
      content: "x".repeat(4000),
      domain: "general",
    }));
    mcp.on(READ, { items, search_time_ms: 12 });

    const result = await mcp.call("memory_read", { query: "everything" });

    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("[…truncated to fit the 25K token limit.");
    expect(result.text).toContain("Use a more specific query to see all results.");
    expect(result.text).not.toContain("top_k");

    const sc = result.structuredContent as { items: Array<Record<string, unknown>> };
    expect(sc.items).toHaveLength(30);
    expect(sc.items[29]).toEqual({
      memory_id: "atom_29",
      content: "x".repeat(4000),
      domain: "general",
    });
  });
});
