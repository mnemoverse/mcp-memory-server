/**
 * memory_feedback reaches room memories, and says what the rating moved.
 *
 * Until 0.11 the tool had no `domain`, so a memory read from a shared room
 * could not be rated: core routes a rating to a room's store only through the
 * room's address (routes.py `feedback` → `_resolve_target_org`, which also
 * refuses a non-member, an archived room and a read-only member with a 403).
 * The owner added it on 2026-09-22. The hosted connector had no `domain`
 * either, so this is new on both surfaces once the connector moves onto the
 * package.
 *
 * The second half is parity with the connector: core returns `avg_valence`
 * with every rating and the package dropped it. The connector's own tests pin
 * the rule these follow ("forwards the live value, never defaults a missing
 * one to 0, never invents coactivation edges", mcp-protocol.test.ts in
 * mnemoverse-mcp-remote); here it is the text, since the package has no
 * structured output yet.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { httpError, startMemoryServer, type Harness } from "./harness.js";

const FEEDBACK = "POST /memory/feedback";
const ROOM = "xroom:room_7f3a9c21";

const envelope = (code: string, message: string): string =>
  JSON.stringify({ code, message, requestId: "req_01", retryable: false, details: null });

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

describe("memory_feedback takes a room's address as domain", () => {
  it("sends the domain exactly as given", async () => {
    mcp.on(FEEDBACK, { updated_count: 1, avg_valence: 0.5 });
    await mcp.callText("memory_feedback", { memory_ids: ["a"], outcome: 1, domain: ROOM });
    expect(mcp.requestTo(FEEDBACK).body).toEqual({ atom_ids: ["a"], outcome: 1, domain: ROOM });
  });

  it("sends no domain key at all when none is given, as before 0.11", async () => {
    mcp.on(FEEDBACK, { updated_count: 1, avg_valence: 0.5 });
    await mcp.callText("memory_feedback", { memory_ids: ["a"], outcome: 1 });
    expect(mcp.requestTo(FEEDBACK).body).toEqual({ atom_ids: ["a"], outcome: 1 });
    expect(mcp.requestTo(FEEDBACK).body).not.toHaveProperty("domain");
  });

  it("does not normalise a domain it passes on", async () => {
    // The package passes every domain through untouched (the source-level
    // denylist in teaching-surface.test.ts guards the other tools); core
    // rejects a non-canonical room address itself, with a 400 that names it.
    mcp.on(FEEDBACK, { updated_count: 1, avg_valence: 0.5 });
    await mcp.callText("memory_feedback", {
      memory_ids: ["a"],
      outcome: 1,
      domain: " XRoom:room_7f3a9c21",
    });
    expect(mcp.requestTo(FEEDBACK).body).toMatchObject({ domain: " XRoom:room_7f3a9c21" });
  });

  it("a read-only member is told the membership is read-only, not that the key is wrong", async () => {
    mcp.on(
      FEEDBACK,
      httpError(403, envelope("FORBIDDEN", "Read-only membership cannot write to this room")),
    );
    const res = await mcp.call("memory_feedback", { memory_ids: ["a"], outcome: 1, domain: ROOM });
    // The stub answers by route alone, so prove the room address was sent.
    expect(mcp.requestTo(FEEDBACK).body).toMatchObject({ domain: ROOM });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("membership in that room is read-only");
    expect(res.text).toContain("The API key is NOT the problem");
  });

  it("an empty domain counts as none, as on memory_read: nothing is sent", async () => {
    mcp.on(FEEDBACK, { updated_count: 0, avg_valence: 0 });
    const text = await mcp.callText("memory_feedback", { memory_ids: ["a"], outcome: 1, domain: "" });
    expect(mcp.requestTo(FEEDBACK).body).toEqual({ atom_ids: ["a"], outcome: 1 });
    expect(text).toContain("none of those ids matched a memory in your own domains");
  });

  it("a domain that is not a room address is sent, and the reply still means your own store", async () => {
    // Core routes any non-xroom domain to the caller's own store, so the
    // wording follows the address shape, not the mere presence of a domain.
    mcp.on(FEEDBACK, { updated_count: 0, avg_valence: 0 });
    const text = await mcp.callText("memory_feedback", {
      memory_ids: ["a"],
      outcome: 1,
      domain: "engineering",
    });
    expect(mcp.requestTo(FEEDBACK).body).toEqual({ atom_ids: ["a"], outcome: 1, domain: "engineering" });
    expect(text).toContain("none of those ids matched a memory in your own domains");
    expect(text).not.toContain("in that room");
  });

  it("a zero count with a room address says the ids did not match in that room", async () => {
    mcp.on(FEEDBACK, { updated_count: 0, avg_valence: 0 });
    const text = await mcp.callText("memory_feedback", {
      memory_ids: ["from_my_own_store"],
      outcome: 1,
      domain: ROOM,
    });
    expect(text).toContain("none of those ids matched a memory in that room");
    expect(text).toContain("the ids did not come from that room");
    expect(text).not.toContain("in your own domains");
  });

  it("a shortfall with a room address names the room, not your own domains", async () => {
    mcp.on(FEEDBACK, { updated_count: 1, avg_valence: 0.3 });
    const text = await mcp.callText("memory_feedback", {
      memory_ids: ["a", "b"],
      outcome: 1,
      domain: ROOM,
    });
    expect(text).toContain("1 of them matched nothing in that room");
    // The valence of the memories that were reached comes before the
    // shortfall, in the same reply.
    expect(text).toContain("average valence is now 0.30");
    expect(text.indexOf("average valence")).toBeLessThan(text.indexOf("fewer than"));
  });

  it("advertises domain as optional, for rooms only", async () => {
    const { tools } = await mcp.client.listTools();
    const schema = tools.find((t) => t.name === "memory_feedback")?.inputSchema as {
      properties: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
    expect(schema.properties.domain?.type).toBe("string");
    expect(schema.properties.domain?.description).toMatch(/^Only for memories read from a shared room/);
    expect(schema.required ?? []).not.toContain("domain");
  });
});

describe("memory_feedback reports the average valence core returns", () => {
  it("prints the live value, rounded to two places", async () => {
    mcp.on(FEEDBACK, { updated_count: 2, avg_valence: 0.4213, coactivation_edges: 0 });
    const text = await mcp.callText("memory_feedback", { memory_ids: ["a", "b"], outcome: 1 });
    expect(text).toContain("The service reports 2 memories updated");
    expect(text).toContain("The service reports their average valence is now 0.42 (on a scale from -1 to 1).");
  });

  it("prints a negative value with its sign", async () => {
    mcp.on(FEEDBACK, { updated_count: 1, avg_valence: -0.25 });
    const text = await mcp.callText("memory_feedback", { memory_ids: ["a"], outcome: -1 });
    expect(text).toContain("average valence is now -0.25");
  });

  it.each([-0.001, -0.004, -0])(
    "prints %s as 0.00, not a negative zero (CodeRabbit on #146)",
    async (value) => {
      mcp.on(FEEDBACK, { updated_count: 1, avg_valence: value });
      const text = await mcp.callText("memory_feedback", { memory_ids: ["a"], outcome: 0 });
      expect(text).toContain("average valence is now 0.00");
      expect(text).not.toContain("-0.00");
    },
  );

  it.each([
    ["absent", {}],
    ["null", { avg_valence: null }],
    ["a string", { avg_valence: "0.4" }],
    ["an object", { avg_valence: { value: 0.4 } }],
  ])("says nothing about valence when it is %s, and never prints 0", async (_, extra) => {
    mcp.on(FEEDBACK, { updated_count: 1, ...extra });
    const text = await mcp.callText("memory_feedback", { memory_ids: ["a"], outcome: 1 });
    expect(text).toContain("The service reports 1 memory updated");
    expect(text).not.toContain("valence");
  });

  it("does not report valence when nothing was updated", async () => {
    mcp.on(FEEDBACK, { updated_count: 0, avg_valence: 0 });
    const text = await mcp.callText("memory_feedback", { memory_ids: ["a"], outcome: 1 });
    expect(text).toContain("No feedback was recorded");
    expect(text).not.toContain("valence");
  });

  it("does not invent co-activation: the tool sends no query concepts, so it says nothing about links", async () => {
    mcp.on(FEEDBACK, { updated_count: 1, avg_valence: 0.5, coactivation_edges: 3 });
    const text = await mcp.callText("memory_feedback", { memory_ids: ["a"], outcome: 1 });
    expect(mcp.requestTo(FEEDBACK).body).not.toHaveProperty("query_concepts");
    expect(text).not.toMatch(/co-?activation|edge|link/i);
  });
});
