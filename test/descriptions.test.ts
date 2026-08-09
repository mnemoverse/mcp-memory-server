/**
 * Description-truth contract — the tool and parameter descriptions, read off
 * the wire the way a connecting model receives them.
 *
 * Descriptions are not comments. MCP clients land them verbatim in the
 * connected model's system prompt, so every sentence in them is shipped
 * behaviour — and nine of this release's own fixes ARE description sentences:
 * the top_k not-a-hard-cap warning, the exclude_author not-usable-yet warning,
 * the room boundaries on feedback/delete/delete_domain, the importance-gate
 * sentence on memory_write, the unscoped-reads-never-cover-rooms rule. Until
 * this file, none of that was asserted anywhere: a fire-drill made 11
 * description sabotages — inversions, deletions, restorations of withdrawn
 * claims — and the suite stayed green through all of them (tests-lens F1,
 * 2026-08-08).
 *
 * WHAT IS PINNED, AND HOW TIGHT. Each assertion pins the CLAUSE that carries
 * the claim, not the paragraph around it — so inverting or deleting the claim
 * goes red, while a copyedit that leaves the claim standing does not. Withdrawn
 * false claims are additionally banned corpus-wide, because a restoration is
 * wrong on ANY surface, not just the one it was removed from.
 *
 * Everything the wire exposes is asserted on the wire (tools/list, the
 * initialize instructions). SERVER_INSTRUCTIONS is also checked on the export
 * itself — it is exported from src/teaching.ts precisely so a test can hold it
 * without booting a stdio server.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SERVER_INSTRUCTIONS } from "../src/teaching.js";
import { startMemoryServer, type Harness } from "./harness.js";

type ToolList = Awaited<ReturnType<Client["listTools"]>>["tools"];

let mcp: Harness;
let tools: ToolList;

beforeAll(async () => {
  mcp = await startMemoryServer();
  ({ tools } = await mcp.client.listTools());
});
afterAll(async () => {
  await mcp.close();
});

function tool(name: string): ToolList[number] {
  const found = tools.find((t) => t.name === name);
  expect(found, `${name} is not registered`).toBeDefined();
  return found!;
}

/** The tool description as advertised — fails rather than passing on "". */
function description(name: string): string {
  const d = tool(name).description;
  expect(d, `${name} advertises no description`).toBeTruthy();
  return d!;
}

/** A parameter's description as advertised on tools/list. */
function paramDescription(toolName: string, param: string): string {
  const props = (tool(toolName).inputSchema?.properties ?? {}) as Record<
    string,
    { description?: unknown } | undefined
  >;
  const d = props[param]?.description;
  expect(typeof d, `${toolName}.${param} advertises no description`).toBe("string");
  return d as string;
}

// ---------------------------------------------------------------------------

describe("the advertised descriptions carry this release's truth claims", () => {
  it("memory_write keeps the importance-gate sentence — a write can be refused, and the result says which", () => {
    const d = description("memory_write");
    expect(d).toContain("an importance gate may filter low-value writes");
    expect(d).toContain("whether the memory was stored or filtered");
  });

  it("memory_read.top_k warns it is NOT a hard cap — more possible, fewer possible", () => {
    const d = paramDescription("memory_read", "top_k");
    // The inversion sabotage rewrote this to "A hard cap" and stayed green.
    expect(d).toContain("Not a hard cap");
    expect(d).toContain("association expansion can return MORE than this");
    expect(d).toContain("the relevance floor can return fewer");
  });

  it("memory_read.domain: omitting searches your OWN domains and never rooms", () => {
    const d = paramDescription("memory_read", "domain");
    expect(d).toContain("Omitting it searches your OWN domains");
    expect(d).toContain("does NOT include shared rooms");
    expect(d).toContain("to search a room, pass its address here");
  });

  it("memory_read.exclude_author warns it is not usable from here, and that 'me' filters nothing", () => {
    const d = paramDescription("memory_read", "exclude_author");
    expect(d).toContain("NOT USABLE FROM HERE YET");
    expect(d).toContain(
      "a guess like 'me' silently matches nothing and filters nothing",
    );
  });

  it("memory_list_recent keeps the room boundary: an unscoped call never covers rooms", () => {
    const d = description("memory_list_recent");
    expect(d).toContain(
      "rooms are separate stores and an unscoped call never covers them",
    );
  });

  it("memory_list_recent.domain is REQUIRED for a room, because the unscoped feed does not reach one", () => {
    const d = paramDescription("memory_list_recent", "domain");
    expect(d).toContain("REQUIRED to read a shared room");
    expect(d).toContain("an unscoped feed does NOT cover");
    expect(d).toContain("Omit only when you mean your own domains");
  });

  it("memory_list_recent.exclude_author carries the same not-usable warning", () => {
    const d = paramDescription("memory_list_recent", "exclude_author");
    expect(d).toContain("NOT USABLE FROM HERE YET");
    expect(d).toContain("a guess like 'me' filters nothing, silently");
  });

  it("memory_feedback names its boundary: rating a room memory silently does nothing", () => {
    const d = description("memory_feedback");
    expect(d).toContain("this reaches your own domains only");
    expect(d).toContain(
      "rating a memory that lives in a shared room silently does nothing",
    );
  });

  it("memory_delete names its boundary: room memories cannot be deleted here", () => {
    const d = description("memory_delete");
    expect(d).toContain("Reaches your own domains only");
    expect(d).toContain(
      "memories in shared rooms CANNOT be deleted through this tool",
    );
  });

  it("memory_delete_domain names byte-for-byte matching and the room boundary", () => {
    const d = description("memory_delete_domain");
    expect(d).toContain("Names match byte-for-byte, including case");
    expect(d).toContain("shared rooms cannot be wiped through this tool");
  });

  it("vault_list promises aliases only — the value is never returned", () => {
    const d = description("vault_list");
    expect(d).toContain("the secret VALUE is never returned");
  });
});

// ---------------------------------------------------------------------------

describe("the server instructions", () => {
  it("keep the room rule, on the wire and in the export alike", () => {
    const wire = mcp.client.getInstructions();
    expect(typeof wire, "the client received no instructions").toBe("string");
    // Both surfaces: deleting the sentence from src/teaching.ts fails on the
    // export; wiring something else into the constructor fails on the wire.
    for (const surface of [wire as string, SERVER_INSTRUCTIONS]) {
      expect(surface).toContain(
        "Shared rooms are SEPARATE stores: to read one, pass its address as domain",
      );
      expect(surface).toContain("unscoped reads never cover rooms");
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * The claims 0.8.1 WITHDREW, banned everywhere a model can read. Presence
 * checks above catch a deletion of the true sentence; these catch the
 * restoration of the false one — including a restoration somewhere other than
 * the site it was removed from.
 */
describe("withdrawn claims stay withdrawn on every advertised surface", () => {
  const WITHDRAWN: Array<[RegExp, string]> = [
    // "Omit to search across all domains" — an unscoped read covers the
    // caller's OWN domains and never rooms, so the sentence promised a scope
    // the engine does not search.
    [/across all domains/i, "the omit-searches-everything claim"],
    // 'Pass "me" for the everyone-but-me read' — the author principal is not
    // visible from this tool, so 'me' matches nothing and filters nothing.
    [/everyone-but-me/i, "the exclude_author 'me' pitch"],
  ];

  it("no tool or parameter description carries one", () => {
    for (const t of tools) {
      const surfaces: Array<[string, string]> = [
        [`${t.name} description`, t.description ?? ""],
      ];
      const props = (t.inputSchema?.properties ?? {}) as Record<
        string,
        { description?: unknown } | undefined
      >;
      for (const [p, v] of Object.entries(props)) {
        if (typeof v?.description === "string") {
          surfaces.push([`${t.name}.${p}`, v.description]);
        }
      }
      for (const [label, text] of surfaces) {
        for (const [banned, why] of WITHDRAWN) {
          expect(text, `${label} restores ${why} (${banned})`).not.toMatch(banned);
        }
      }
    }
  });

  it("the server instructions carry none either", () => {
    for (const [banned, why] of WITHDRAWN) {
      expect(
        mcp.client.getInstructions() ?? "",
        `the wire instructions restore ${why}`,
      ).not.toMatch(banned);
      expect(
        SERVER_INSTRUCTIONS,
        `SERVER_INSTRUCTIONS restores ${why}`,
      ).not.toMatch(banned);
    }
  });
});
