/**
 * `wording.serverNoun` (STEP4-2, owner 2026-09-24): what the three tool
 * descriptions that name this deployment's own scope call it — "this server"
 * (the default, and what every stdio-harness golden in
 * test/descriptions.test.ts already pins) or "this connector", for a second
 * server registering these tools (the hosted connector, ADR-025).
 *
 * This file proves two things test/descriptions.test.ts cannot, because that
 * file only ever boots the stdio server with default deps: that supplying
 * "this connector" changes EXACTLY the three known surfaces and no other
 * description on tools/list, and that each changed surface differs from the
 * default ONLY by the noun — not by any other word around it.
 */

import { describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectMemoryTools } from "./direct-register.js";
import type { ApiFetch, MemoryToolDeps } from "../src/shared.js";

const neverCalled: ApiFetch = async () => {
  throw new Error("listing tools must not call the API");
};

type ToolList = Awaited<ReturnType<Client["listTools"]>>["tools"];

/** Every description surface tools/list carries for every tool: the tool's
 *  own description, every input-parameter description, and every declared
 *  output-schema field description — keyed so two snapshots diff cleanly. */
function surfaces(tools: ToolList): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of tools) {
    if (typeof t.description === "string") out.set(t.name, t.description);
    const input = (t.inputSchema?.properties ?? {}) as Record<
      string,
      { description?: unknown } | undefined
    >;
    for (const [p, v] of Object.entries(input)) {
      if (typeof v?.description === "string") out.set(`${t.name}.input.${p}`, v.description);
    }
    const output =
      ((t as { outputSchema?: { properties?: Record<string, { description?: unknown } | undefined> } })
        .outputSchema?.properties ?? {}) as Record<string, { description?: unknown } | undefined>;
    for (const [p, v] of Object.entries(output)) {
      if (typeof v?.description === "string") out.set(`${t.name}.output.${p}`, v.description);
    }
  }
  return out;
}

async function list(deps: MemoryToolDeps): Promise<{ tools: ToolList; close: () => Promise<void> }> {
  const { client, server } = await connectMemoryTools(deps);
  const { tools } = await client.listTools();
  return { tools, close: async () => server.close() };
}

describe("wording.serverNoun", () => {
  it('defaults to "this server" — byte-identical to every deps-less registration', async () => {
    const { tools, close } = await list({ apiFetch: neverCalled });
    const s = surfaces(tools);
    expect(s.get("memory_read.input.top_k")).toContain("what this server asks for");
    expect(s.get("memory_feedback.output.coactivation_edges")).toContain(
      "This server does not send query_concepts",
    );
    expect(s.get("vault_list")).toContain("no tool on this server returns it");
    await close();
  });

  it('"this connector" changes exactly three surfaces on tools/list, each ONLY by the noun', async () => {
    const [def, connector] = await Promise.all([
      list({ apiFetch: neverCalled }),
      list({ apiFetch: neverCalled, wording: { serverNoun: "this connector" } }),
    ]);
    const sa = surfaces(def.tools);
    const sb = surfaces(connector.tools);

    // Same set of surfaces both times — the noun never adds or removes a
    // description, only edits the three that already named the server.
    expect([...sb.keys()].sort()).toEqual([...sa.keys()].sort());

    const changed = [...sa.keys()].filter((k) => sa.get(k) !== sb.get(k)).sort();
    expect(changed).toEqual([
      "memory_feedback.output.coactivation_edges",
      "memory_read.input.top_k",
      "vault_list",
    ]);

    // Swapping the noun back in the connector's text must reproduce the
    // default text EXACTLY — proof the edit touched only the noun.
    expect(sb.get("memory_read.input.top_k")!.split("this connector").join("this server")).toBe(
      sa.get("memory_read.input.top_k"),
    );
    expect(
      sb
        .get("memory_feedback.output.coactivation_edges")!
        .split("This connector")
        .join("This server"),
    ).toBe(sa.get("memory_feedback.output.coactivation_edges"));
    expect(sb.get("vault_list")!.split("this connector").join("this server")).toBe(sa.get("vault_list"));

    await def.close();
    await connector.close();
  });

  it("an unrecognised serverNoun value falls back to the default, defensively (typeof/literal guard)", async () => {
    const deps: MemoryToolDeps = {
      apiFetch: neverCalled,
      // A value outside the two-literal union — what a JS caller (no
      // compile-time check) or a stale build could actually send.
      wording: { serverNoun: "somebody else's deployment" as never },
    };
    const { tools, close } = await list(deps);
    const s = surfaces(tools);
    expect(s.get("memory_read.input.top_k")).toContain("what this server asks for");
    await close();
  });
});
