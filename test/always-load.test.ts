/**
 * memory_read is the one tool Claude Code keeps loaded up front.
 *
 * Claude Code puts MCP tools behind tool search by default, and a tool
 * opts out by setting "anthropic/alwaysLoad" in its _meta
 * (https://code.claude.com/docs/en/mcp.md). Only memory_read carries the
 * flag: a task that may depend on an earlier session needs the read first,
 * and every other tool stays behind search, where it costs no context.
 *
 * Asserted on the wire (tools/list through the real McpServer), because the
 * flag is only useful if the SDK actually passes _meta through.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMemoryServer, type Harness } from "./harness.js";

let mcp: Harness;

beforeAll(async () => {
  mcp = await startMemoryServer();
});
afterAll(async () => {
  await mcp.close();
});

const FLAG = "anthropic/alwaysLoad";

describe("anthropic/alwaysLoad on tools/list", () => {
  it("memory_read carries the flag", async () => {
    const { tools } = await mcp.client.listTools();
    const read = tools.find((t) => t.name === "memory_read");
    expect(read).toBeDefined();
    expect(read?._meta?.[FLAG]).toBe(true);
  });

  it("no other tool carries it", async () => {
    const { tools } = await mcp.client.listTools();
    const flagged = tools.filter((t) => t._meta?.[FLAG] !== undefined).map((t) => t.name);
    expect(flagged).toEqual(["memory_read"]);
  });

  it("memory_read's description names the moments a read applies to", async () => {
    const { tools } = await mcp.client.listTools();
    const description = tools.find((t) => t.name === "memory_read")?.description ?? "";
    expect(description).toMatch(/resuming work in a familiar codebase/);
    expect(description).toMatch(/like last time/);
  });
});
