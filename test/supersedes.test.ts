/**
 * `supersedes` on memory_write and `include_history` on memory_read.
 *
 * The core contract these pin (mnemoverse-core, origin/main):
 *  - POST /memory/write takes `supersedes: list[UUID] | None`, at most 32,
 *    all distinct (schemas.py WriteRequestSchema, `_supersedes_are_distinct`),
 *    and answers `superseded: list[UUID]` (WriteResponseSchema).
 *  - A refused supersede is a MnemoError (api/errors.py): 400 for an `xroom:`
 *    domain (routes._reject_supersede_in_room_domain, no details), 404 with
 *    `details {failed_target_id, reason: "not_found"}`, 409 with
 *    `details {failed_target_id, reason, superseded_by?}`
 *    (routes._supersede_http_error).
 *  - POST /memory/read takes `include_history: bool`; a returned replaced
 *    revision carries `superseded_by` (schemas.py MemoryItemSchema).
 *
 * Fixtures are in the shape core sends: the MnemoError body is the top-level
 * envelope {code, message, requestId, retryable, details}.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { httpError, startMemoryServer, type Harness } from "./harness.js";
import { explainApiFailure } from "../src/errors.js";
import { readRequestBody, writeRequestBody } from "../src/requests.js";

let mcp: Harness;

beforeAll(async () => {
  mcp = await startMemoryServer();
});
afterAll(async () => {
  await mcp.close();
});
beforeEach(() => {
  mcp.reset().on(ROOMS, []);
});

const WRITE = "POST /memory/write";
const READ = "POST /memory/read";
// An unscoped read also lists the rooms it did not search.
const ROOMS = "GET /memory/rooms";

const ID_A = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ID_B = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const NEW_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

/** n distinct, well-formed UUIDs. */
const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

const stored = { stored: true, atom_id: NEW_ID, importance: 0.8, superseded: [] };

function mnemoError(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
) {
  return httpError(
    status,
    JSON.stringify({
      code,
      message,
      requestId: "req_test",
      retryable: false,
      ...(details ? { details } : {}),
    }),
  );
}

describe("memory_write: the supersedes parameter in tools/list", () => {
  it("is an optional array of 1 to 32 UUID strings, described for the model", async () => {
    const { tools } = await mcp.client.listTools();
    const write = tools.find((t) => t.name === "memory_write")!;
    const prop = (write.inputSchema.properties as Record<string, any>).supersedes;
    expect(prop.type).toBe("array");
    expect(prop.minItems).toBe(1);
    expect(prop.maxItems).toBe(32);
    expect(write.inputSchema.required).toEqual(["content"]);
    expect(prop.description).toContain(
      "Pass the memory_id values of memories this write corrects or replaces.",
    );
    expect(prop.description).toContain("Not supported in shared rooms (xroom: domains).");
    expect(prop.description).toContain("include_history");
    expect(prop.items).toMatchObject({ type: "string", minLength: 1 });
    expect(prop.items).not.toHaveProperty("format");
  });

  it("states in the tool description that the parameter exists", async () => {
    const { tools } = await mcp.client.listTools();
    const write = tools.find((t) => t.name === "memory_write")!;
    expect(write.description).toContain(
      "To correct a memory you have checked is outdated, pass its memory_id in supersedes.",
    );
  });

  it("declares superseded in the output schema, optional", async () => {
    const { tools } = await mcp.client.listTools();
    const out = tools.find((t) => t.name === "memory_write")!.outputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(out.properties).toHaveProperty("superseded");
    expect(out.required).toEqual(["stored", "memory_id"]);
  });
});

describe("memory_write: supersedes is validated before anything is sent", () => {
  const rejected: Array<[string, unknown]> = [
    ["an empty list (0 ids)", []],
    ["33 ids", ids(33)],
    ["a repeated id", [ID_A, ID_A]],
    ["an empty string", [""]],
    ["a non-string element", [42]],
  ];
  for (const [label, supersedes] of rejected) {
    it(`refuses ${label}, with no request to core`, async () => {
      mcp.on(WRITE, stored);
      const r = await mcp.call("memory_write", { content: "x", supersedes });
      expect(r.isError).toBe(true);
      expect(mcp.calls.filter((c) => c.key === WRITE)).toHaveLength(0);
    });
  }

  for (const n of [1, 32]) {
    it(`accepts ${n} id${n === 1 ? "" : "s"}`, async () => {
      mcp.on(WRITE, stored);
      const r = await mcp.call("memory_write", { content: "x", supersedes: ids(n) });
      expect(r.isError).toBeFalsy();
      expect((mcp.requestTo(WRITE).body as { supersedes: string[] }).supersedes).toEqual(ids(n));
    });
  }
});

describe("memory_write: ids are opaque strings (OD-7), not UUIDs", () => {
  it("accepts a non-UUID id on input and shows it on output", async () => {
    mcp.on(WRITE, { ...stored, superseded: ["atom_7"] });
    const r = await mcp.call("memory_write", { content: "x", supersedes: ["atom_7"] });
    expect(r.isError).toBeFalsy();
    expect(mcp.requestTo(WRITE).body).toMatchObject({ supersedes: ["atom_7"] });
    expect(r.text).toContain("Replaced: atom_7");
    expect((r.structuredContent as { superseded: string[] }).superseded).toEqual(["atom_7"]);
  });

  it("treats ids that differ only in letter case as different (no UUID semantics here)", async () => {
    mcp.on(WRITE, stored);
    const r = await mcp.call("memory_write", { content: "x", supersedes: ["Ab", "aB"] });
    expect(r.isError).toBeFalsy();
  });
});

describe("memory_write: supersedes reaches the wire exactly when passed", () => {
  it("is sent verbatim when passed", async () => {
    mcp.on(WRITE, stored);
    await mcp.callText("memory_write", { content: "x", supersedes: [ID_A, ID_B] });
    expect(mcp.requestTo(WRITE).body).toMatchObject({ supersedes: [ID_A, ID_B] });
  });

  it("is absent from the body when not passed", async () => {
    mcp.on(WRITE, stored);
    await mcp.callText("memory_write", { content: "x" });
    expect(Object.keys(mcp.requestTo(WRITE).body as object)).toEqual([
      "content",
      "concepts",
      "domain",
    ]);
  });

  it("writeRequestBody: same bytes as before without it, one extra key with it", () => {
    expect(JSON.stringify(writeRequestBody({ content: "c" }))).toBe(
      '{"content":"c","concepts":[],"domain":"general"}',
    );
    expect(writeRequestBody({ content: "c", supersedes: [ID_A] }).supersedes).toEqual([ID_A]);
  });
});

describe("memory_write: the superseded answer", () => {
  it("names the replaced ids in the text and in structuredContent", async () => {
    mcp.on(WRITE, { ...stored, superseded: [ID_A, ID_B] });
    const r = await mcp.call("memory_write", { content: "x", supersedes: [ID_A, ID_B] });
    expect(r.isError).toBeFalsy();
    expect(r.text).toBe(`Stored (importance: 0.80). ID: ${NEW_ID}\nReplaced: ${ID_A}, ${ID_B}`);
    expect(r.structuredContent).toEqual({
      stored: true,
      memory_id: NEW_ID,
      importance: 0.8,
      superseded: [ID_A, ID_B],
    });
  });

  it("shows nothing for an empty or missing superseded array", async () => {
    for (const reply of [stored, { stored: true, atom_id: NEW_ID, importance: 0.8 }]) {
      mcp.reset().on(WRITE, reply);
      const r = await mcp.call("memory_write", { content: "x" });
      expect(r.text).toBe(`Stored (importance: 0.80). ID: ${NEW_ID}`);
      expect(r.structuredContent).not.toHaveProperty("superseded");
    }
  });

  it("normalises control characters in an id and drops entries that are empty or not strings", async () => {
    mcp.on(WRITE, { ...stored, superseded: [ID_A, "b\nc\u202e", "", 7, null] });
    const r = await mcp.call("memory_write", { content: "x", supersedes: [ID_A] });
    expect(r.text).toBe(`Stored (importance: 0.80). ID: ${NEW_ID}\nReplaced: ${ID_A}, b c`);
    expect((r.structuredContent as { superseded: string[] }).superseded).toEqual([ID_A, "b c"]);
  });

  it("a refused write says nothing was replaced", async () => {
    mcp.on(WRITE, {
      stored: false,
      atom_id: null,
      importance: 0.0,
      reason: "exact duplicate",
      superseded: [],
    });
    const r = await mcp.call("memory_write", { content: "x", supersedes: [ID_A] });
    expect(r.text).toContain("NOT STORED");
    expect(r.text).toContain("Nothing was replaced either");
    expect(r.structuredContent).not.toHaveProperty("superseded");
  });
});

describe("memory_write: core's refusals of a supersede write, in core's own shapes", () => {
  it("400 for a room domain: replacing is not supported in a room", async () => {
    mcp.on(
      WRITE,
      mnemoError(
        "VALIDATION_ERROR",
        "supersedes is not supported for room (xroom:) domains — a contribution to a shared room cannot be hidden from the other members.",
        400,
      ),
    );
    const r = await mcp.call("memory_write", {
      content: "x",
      domain: "xroom:room_01ABC",
      supersedes: [ID_A],
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(
      "In a shared room a correction is written next to the old memory; replacing is not supported.",
    );
    expect(r.text).toContain("nothing was replaced");
  });

  it("404: names the target and says it is not in this account's memory", async () => {
    mcp.on(
      WRITE,
      mnemoError("NOT_FOUND", `Supersede target ${ID_A} not found`, 404, {
        failed_target_id: ID_A,
        reason: "not_found",
      }),
    );
    const r = await mcp.call("memory_write", { content: "x", supersedes: [ID_B, ID_A] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(ID_A);
    expect(r.text).toContain("not found in this account's memory");
    expect(r.text).not.toContain(ID_B);
    // No raw body tail: details are not echoed beyond the named fields.
    expect(r.text).not.toContain("Raw detail");
    expect(r.text).not.toContain("req_test");
  });

  it("409 already replaced: names the target, the reason and what replaced it", async () => {
    mcp.on(
      WRITE,
      mnemoError("CONFLICT", "target already superseded", 409, {
        failed_target_id: ID_A,
        reason: "already_superseded",
        superseded_by: ID_B,
      }),
    );
    const r = await mcp.call("memory_write", { content: "x", supersedes: [ID_A] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(ID_A);
    expect(r.text).toContain("already_superseded");
    expect(r.text).toContain(`already replaced by ${ID_B}; replace that one instead`);
    expect(r.text).not.toContain("Raw detail");
  });

  it("409 without superseded_by: no 'replaced by' clause", async () => {
    mcp.on(
      WRITE,
      mnemoError("CONFLICT", "target cannot be superseded", 409, {
        failed_target_id: ID_A,
        reason: "cross_domain",
      }),
    );
    const r = await mcp.call("memory_write", { content: "x", supersedes: [ID_A] });
    expect(r.text).toContain(ID_A);
    expect(r.text).toContain("cross_domain");
    expect(r.text).not.toContain("replaced by");
  });

  it("prints no field of details beyond the three it names", () => {
    const text = explainApiFailure({
      status: 409,
      method: "POST",
      path: "/memory/write",
      body: JSON.stringify({
        code: "CONFLICT",
        message: "m",
        retryable: false,
        details: {
          failed_target_id: ID_A,
          reason: "already_superseded",
          superseded_by: ID_B,
          internal_note: "SECRET-DETAIL",
        },
      }),
    });
    expect(text).not.toContain("SECRET-DETAIL");
  });

  it("normalises control characters in the fields it prints, and prints non-UUID ids", () => {
    const text = explainApiFailure({
      status: 409,
      method: "POST",
      path: "/memory/write",
      body: JSON.stringify({
        code: "CONFLICT",
        message: "m",
        retryable: false,
        details: {
          failed_target_id: ID_A,
          reason: "already\nsuperseded",
          superseded_by: "atom_9\u202e",
        },
      }),
    });
    expect(text).toContain(ID_A);
    expect(text).toContain("Reason: already superseded.");
    expect(text).toContain("already replaced by atom_9;");
    expect(text).not.toMatch(/[\n\u202e]/);
  });

  it("leaves other 404/409/400 answers on /memory/write as they were", () => {
    const cases: Array<[number, string]> = [
      [404, JSON.stringify({ code: "NOT_FOUND", message: "room gone", retryable: false })],
      [
        409,
        JSON.stringify({
          code: "CONFLICT",
          message: "external_ref taken",
          retryable: false,
          details: { field: "external_ref" },
        }),
      ],
      [400, JSON.stringify({ code: "VALIDATION_ERROR", message: "content too long", retryable: false })],
    ];
    for (const [status, body] of cases) {
      const text = explainApiFailure({ status, method: "POST", path: "/memory/write", body });
      expect(text).toContain("Raw detail");
      expect(text).not.toContain("nothing was replaced");
    }
  });
});

describe("memory_read: include_history", () => {
  const items = [{ atom_id: ID_A, content: "old fact", domain: "general" }];

  it("is an optional boolean described without promising completeness", async () => {
    const { tools } = await mcp.client.listTools();
    const read = tools.find((t) => t.name === "memory_read")!;
    const prop = (read.inputSchema.properties as Record<string, any>).include_history;
    expect(prop.type).toBe("boolean");
    expect(read.inputSchema.required).toEqual(["query"]);
    expect(prop.description).toContain("not a promise of the complete history");
    // Both cases are true: without supersedes the earlier memory stays as it
    // was; with it, it is marked replaced. Never says always hidden.
    expect(read.description).toContain(
      "Without supersedes it is stored alongside the earlier memory, which stays as it was",
    );
    expect(read.description).toContain(
      "with supersedes, the earlier memory is marked replaced, is hidden from reads when the account hides replaced memories, and include_history returns it",
    );
    expect(read.description).not.toContain("not deleted or hidden");
    expect(read.description).not.toMatch(/always hidden|are hidden by default/i);
  });

  it("is sent exactly when passed (true and false), absent otherwise", async () => {
    const cases: Array<[Record<string, unknown>, boolean | undefined]> = [
      [{ query: "q", include_history: true }, true],
      [{ query: "q", include_history: false }, false],
      [{ query: "q" }, undefined],
    ];
    for (const [args, expected] of cases) {
      mcp.reset().on(READ, { items, search_time_ms: 1 }).on(ROOMS, []);
      await mcp.callText("memory_read", args);
      const body = mcp.requestTo(READ).body as Record<string, unknown>;
      if (expected === undefined) expect(body).not.toHaveProperty("include_history");
      else expect(body.include_history).toBe(expected);
    }
    expect(readRequestBody({ query: "q" })).not.toHaveProperty("include_history");
  });

  it("shows 'replaced by <id>' and carries superseded_by on a replaced revision", async () => {
    mcp.on(READ, {
      items: [
        { atom_id: ID_A, content: "old fact", domain: "general", superseded_by: ID_B },
        { atom_id: ID_B, content: "new fact", domain: "general", supersedes: [ID_A] },
      ],
      search_time_ms: 1,
    });
    const r = await mcp.call("memory_read", { query: "fact", include_history: true });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain(`id: ${ID_A}\n   replaced by ${ID_B}`);
    expect(r.text.match(/replaced by/g)).toHaveLength(1);
    const structured = r.structuredContent as { items: Array<Record<string, unknown>> };
    expect(structured.items[0].superseded_by).toBe(ID_B);
    expect(structured.items[1]).not.toHaveProperty("superseded_by");
    expect(structured.items[1]).not.toHaveProperty("supersedes");
  });

  it("treats a null, empty or non-string superseded_by as absent, and shows a non-UUID id", async () => {
    mcp.on(READ, {
      items: [
        { atom_id: ID_A, content: "a", domain: "general", superseded_by: null },
        { atom_id: ID_B, content: "b", domain: "general", superseded_by: "" },
        { atom_id: "c", content: "c", domain: "general", superseded_by: 5 },
        { atom_id: "d", content: "d", domain: "general", superseded_by: "atom_8" },
      ],
      search_time_ms: 1,
    });
    const r = await mcp.call("memory_read", { query: "q" });
    expect(r.text.match(/replaced by/g)).toHaveLength(1);
    expect(r.text).toContain("replaced by atom_8");
    const items = (r.structuredContent as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((i) => i.superseded_by)).toEqual([undefined, undefined, undefined, "atom_8"]);
  });
});
