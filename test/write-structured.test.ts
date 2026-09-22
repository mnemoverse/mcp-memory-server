/**
 * memory_write's structuredContent: a declared outputSchema alongside the
 * unchanged text (S3 of the structured-output plan).
 *
 * Three tests here are ports of the connector's own suite
 * (mnemoverse-mcp-remote/test/mcp-protocol.test.ts, the write-refusal
 * structuredContent tests and the admin-scope success case) so the two
 * servers pin the SAME structuredContent shape for the SAME core response.
 * The rest cover where this package's shape deliberately differs
 * (`memory_id` as `z.string()`, not `z.guid()`, decision OD-7, owner,
 * 2026-09-22) and the `structuredText` normalisation of `reason`
 * (src/names.ts).
 *
 * Uses the SDK-validated path, the real McpServer through test/harness.ts,
 * not a bare call to the handler: a missing or schema-violating
 * structuredContent shows up here as the SDK's own "Output validation
 * error", the guard test/structured-output.test.ts pins against the
 * installed SDK. No test in this file changes an existing expectation;
 * test/handlers.test.ts and test/tool-wiring.test.ts are untouched by this
 * slice.
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

/** Route key, so a typo is a compile-adjacent mistake rather than a silent miss. */
const WRITE = "POST /memory/write";

describe("memory_write: tools/list carries the output schema", () => {
  it("declares stored, memory_id, reason, importance, with stored+memory_id required", async () => {
    const { tools } = await mcp.client.listTools();
    const write = tools.find((t) => t.name === "memory_write");
    expect(write?.outputSchema).toBeDefined();
    const schema = write!.outputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "importance",
      "memory_id",
      "reason",
      "stored",
    ]);
    expect(schema.required).toEqual(["stored", "memory_id"]);
  });
});

describe("memory_write: structuredContent, ported from the connector's own suite", () => {
  it("does not report the refusal as a bare unexplained fact", async () => {
    // {stored:false, memory_id:null} alone is a bit with no cause attached:
    // the caller cannot tell a novelty refusal from a bug, and cannot act on
    // either. The connector's test of the same name pins the same defect.
    mcp.on(WRITE, {
      stored: false,
      atom_id: null,
      reason: "Below importance threshold (0.047 < 0.1)",
      importance: 0.047,
    });

    const result = await mcp.call("memory_write", {
      content: "a near-duplicate of something already saved",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      stored: false,
      memory_id: null,
      reason: "Below importance threshold (0.047 < 0.1)",
      importance: 0.047,
    });
    // The TEXT is unchanged by this slice: still the quoted literal, not
    // the plain structuredContent string.
    expect(result.text).toContain("NOT STORED");
    expect(result.text).toContain(
      'Server reason: "Below importance threshold (0.047 < 0.1)"',
    );
  });

  it("does not fabricate a reason or score when an older core omits them", async () => {
    mcp.on(WRITE, { stored: false, atom_id: null });

    const result = await mcp.call("memory_write", {
      content: "a write whose legacy response has no diagnostics",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ stored: false, memory_id: null });
    expect(result.text).toContain("NOT STORED");
    expect(result.text).not.toContain("Server reason");
    expect(result.text).not.toContain("Novelty score");
  });

  it("the success shape carries the id, the reason and the score", async () => {
    mcp.on(WRITE, { stored: true, atom_id: "atom_7", importance: 0.9, reason: "ok" });

    const result = await mcp.call("memory_write", { content: "x" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      stored: true,
      memory_id: "atom_7",
      reason: "ok",
      importance: 0.9,
    });
    expect(result.text).toBe("Stored (importance: 0.90). ID: atom_7");
  });
});

describe("memory_write: memory_id is an opaque string, not a UUID (OD-7)", () => {
  it("a non-UUID id such as \"a1\" passes output validation", async () => {
    mcp.on(WRITE, { stored: true, atom_id: "a1", importance: 0.5 });

    const result = await mcp.call("memory_write", { content: "x" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ memory_id: "a1" });
  });
});

describe("memory_write: a stored:true body without atom_id is unreadable, not a save", () => {
  it("returns isError with the unreadable-answer sentence", async () => {
    // core's WriteResponseSchema carries atom_id on every stored write, so a
    // stored:true body without one is not core's answer: the same class of
    // degraded 2xx the pre-existing guard catches one field earlier.
    mcp.on(WRITE, { stored: true });

    const result = await mcp.call("memory_write", { content: "x" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("shape this client does not recognise");
    expect(result.text).toContain("not confirmation that the memory was stored");
  });
});

describe("memory_write: reason normalisation for structuredContent", () => {
  it("strips a bidi override, a zero-width space and a C0 control, collapses a run of spaces, and leaves ordinary text verbatim", async () => {
    const hostile =
      "‪Below  importance​threshold\u0000gate (0.047 < 0.1)‬ ";
    mcp.on(WRITE, { stored: false, atom_id: null, reason: hostile, importance: 0.047 });

    const result = await mcp.call("memory_write", { content: "x" });

    const structured = result.structuredContent as { reason?: string };
    // The numbers and the comparison operator, verbatim: what safeInline
    // (src/render.ts) does NOT guarantee, and the reason this file exists.
    expect(structured.reason).toContain("(0.047 < 0.1)");
    expect(structured.reason).not.toMatch(/[‪‬​\u0000]/);
    // No doubled spaces left over from the stripped characters.
    expect(structured.reason).not.toMatch(/ {2,}/);
  });

  it("a reason of only whitespace produces no reason key", async () => {
    mcp.on(WRITE, { stored: false, atom_id: null, reason: "   ", importance: 0.1 });

    const result = await mcp.call("memory_write", { content: "x" });

    expect(result.structuredContent).toEqual({
      stored: false,
      memory_id: null,
      importance: 0.1,
    });
  });
});

describe("memory_write: importance sent as a string is not a number this client will assert", () => {
  it("carries no importance key in structuredContent, and the text still says \"unknown\" as today", async () => {
    mcp.on(WRITE, { stored: true, atom_id: "atom_1", importance: "0.5" });

    const result = await mcp.call("memory_write", { content: "x" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ stored: true, memory_id: "atom_1" });
    expect(result.text).toBe("Stored (importance: unknown). ID: atom_1");
  });
});
