/**
 * Rooms, step 3c: `max_uses` on memory_invite_to_room, and why core's
 * `next_steps` is not echoed.
 *
 * max_uses. The hosted connector let an owner mint a multi-use invite and the
 * package did not; its description called every invite "one-time". Core takes
 * 1 to 1000, default 1 (CreateInviteRequestSchema). The package checks only
 * the floor and leaves the ceiling to core (ADR-025), whose 422 is passed on.
 * The first two tests mirror the connector's rooms-tools.test.ts: the exact
 * request shape, and a description that mentions max_uses and no longer says
 * "one-time".
 *
 * next_steps. Core returns it on create and join, written for REST callers,
 * and on join it tells a read-only member to write. The package keeps its own
 * MCP wording (see the comment above memory_create_room in src/tools.ts); the
 * last two tests pin that, so the closed mnemoverse-mcp-remote#29 is not
 * revived by accident.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { httpError, startMemoryServer, type Harness } from "./harness.js";

const INVITE = "POST /memory/rooms/room_01ABC/invites";
const CREATE = "POST /memory/rooms";
const JOIN = "POST /memory/rooms/join";

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

describe("memory_invite_to_room takes max_uses", () => {
  it("sends max_uses with the other options", async () => {
    mcp.on(INVITE, { share_message: "Join my room: mnvr_x" });
    await mcp.callText("memory_invite_to_room", {
      room_id: "room_01ABC",
      scope: "read",
      expires_in_days: 14,
      max_uses: 5,
    });
    expect(mcp.requestTo(INVITE).body).toEqual({ scope: "read", expires_in_days: 14, max_uses: 5 });
  });

  it("sends no max_uses key when none is given, as before 0.11", async () => {
    mcp.on(INVITE, { share_message: "Join my room: mnvr_x" });
    await mcp.callText("memory_invite_to_room", { room_id: "room_01ABC" });
    expect(mcp.requestTo(INVITE).body).toEqual({});
  });

  it.each([0, -1, 2.5])("refuses max_uses %s before sending anything", async (value) => {
    const res = await mcp.call("memory_invite_to_room", { room_id: "room_01ABC", max_uses: value });
    expect(res.isError).toBe(true);
    expect(mcp.calls).toHaveLength(0);
  });

  it("leaves the ceiling to the engine, and passes its refusal on", async () => {
    mcp.on(
      INVITE,
      httpError(422, envelope("VALIDATION_ERROR", "max_uses: Input should be less than or equal to 1000")),
    );
    const res = await mcp.call("memory_invite_to_room", { room_id: "room_01ABC", max_uses: 5000 });
    expect(mcp.requestTo(INVITE).body).toEqual({ max_uses: 5000 });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("rejected the CONTENTS of this request");
    expect(res.text).toContain("less than or equal to 1000");
  });

  it("describes the invite as single-use by default, with max_uses for more", async () => {
    const { tools } = await mcp.client.listTools();
    const tool = tools.find((t) => t.name === "memory_invite_to_room");
    expect(tool?.description).toContain("single-use by default");
    expect(tool?.description).toContain("max_uses");
    expect(tool?.description).not.toMatch(/\bone-time\b/i);
    const props = tool?.inputSchema.properties as Record<string, { type?: string; minimum?: number; maximum?: number }>;
    expect(props.max_uses?.type).toBe("integer");
    expect(props.max_uses?.minimum).toBe(1);
    // No copy of the engine's 1000 (ADR-025). zod 4 writes the safe-integer
    // bound for any .int(), so that is the only maximum allowed here.
    expect([undefined, Number.MAX_SAFE_INTEGER]).toContain(props.max_uses?.maximum);
    expect(tool?.inputSchema.required ?? []).not.toContain("max_uses");
  });
});

describe("core's REST-oriented next_steps is not echoed", () => {
  it("memory_create_room keeps its MCP wording", async () => {
    mcp.on(CREATE, {
      room_id: "room_01ABC",
      address: "xroom:room_01ABC",
      name: "team",
      next_steps:
        "Use it now: POST /api/v1/memory/write and POST /api/v1/memory/read with domain='xroom:room_01ABC'.",
    });
    const text = await mcp.callText("memory_create_room", { name: "team" });
    expect(text).toContain('pass domain="xroom:room_01ABC" on memory_write / memory_read');
    expect(text).toContain("call memory_invite_to_room");
    expect(text).not.toContain("/api/v1/");
  });

  it("memory_join_room tells a read-only member that writes will be refused, whatever next_steps says", async () => {
    mcp.on(JOIN, {
      room_id: "room_01ABC",
      address: "xroom:room_01ABC",
      name: "team",
      scope: "read",
      already_member: false,
      next_steps:
        "You are a read member of 'team'. Use it now: pass domain='xroom:room_01ABC' on /memory/write and /memory/read.",
    });
    const text = await mcp.callText("memory_join_room", { code: "mnvr_abc" });
    expect(text).toContain("memory_write to that address will be refused");
    expect(text).not.toContain("/memory/write");
  });
});
