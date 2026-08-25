/**
 * Description-truth contract — the tool and parameter descriptions, read off
 * the wire the way a connecting model receives them.
 *
 * Descriptions are not comments. MCP clients land them verbatim in the
 * connected model's system prompt, so every sentence in them is shipped
 * behaviour — and nine of this release's own fixes ARE description sentences:
 * the top_k not-a-hard-cap warning, the exclude_author not-usable-yet warning,
 * the room boundary on feedback, the importance-gate sentence on memory_write,
 * the unscoped-reads-never-cover-rooms rule. (The room boundaries this file
 * once also pinned on memory_delete/memory_delete_domain went with those
 * tools on 2026-08-20 — deletion is administrative-only now.) Until
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

import { readFileSync } from "node:fs";
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

  it("memory_feedback states what a downvote does: out-ranks, never erases (#95)", () => {
    // The claim 0.9.1 put in its place, pinned so the true half cannot be
    // deleted along with the false one. The ban on the false half is in the
    // withdrawn-claims block below.
    const d = description("memory_feedback");
    expect(d).toContain("other memories out-rank it — nothing is erased");
  });

  it("vault_list promises aliases only — the value is never returned", () => {
    const d = description("vault_list");
    expect(d).toContain("the secret VALUE is never returned");
    // The stronger half of the promise, added when the phantom-consumer
    // sentence was withdrawn. Pinned separately because the clause above
    // survives in any rewrite, so on its own it asserts nothing about this one.
    expect(d).toContain("no tool on this server returns it");
  });

  it("memory_join_room does not unconditionally promise write on the room it describes", () => {
    // Bug hunt (pre-0.9.2): the OLD description said "use ... on
    // memory_write/memory_read to read and write the shared room" —
    // unconditionally, even though invite scope can be "read" (core refuses
    // that member's memory_write with a 403, src/errors.ts). The static
    // description cannot know the scope at advertise time, so it must not
    // promise write at all — it can only say the runtime answer will.
    const d = description("memory_join_room");
    expect(d).toContain("memory_read");
    expect(d).toMatch(/read.?only/);
    expect(d).not.toMatch(/to read and write the shared room/);
  });

  it("memory_list_rooms does not promise write for every listed room regardless of scope", () => {
    // Same defect, mirrored: the OLD description said every room comes "with
    // the address to pass as `domain` on memory_write / memory_read" — a
    // blanket claim false for any room where the caller's membership is
    // "read" only.
    const d = description("memory_list_rooms");
    expect(d).toMatch(/read.?only/);
    expect(d).not.toMatch(/each with the address to pass as `domain` on memory_write \/ memory_read\./);
  });

  it("memory_write.domain warns names are matched byte-for-byte and names the room-address escape hatch", () => {
    // Bug hunt (pre-0.9.2): this is the ONE place a fork gets CREATED — the
    // write handler explains at length, 30 lines below, why it deliberately
    // does not normalise " engineering" into "engineering" (a second,
    // permanent store), and memory_read.domain explains its half of the same
    // rule — but this field, where the fork is actually opened, said nothing.
    const d = paramDescription("memory_write", "domain");
    expect(d).toContain("byte-for-byte");
    expect(d).toContain("memory_stats");
    expect(d).toContain("xroom:");
    expect(d).toContain("memory_list_rooms");
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
    // "before a tool that consumes it" — vault_list is the only vault tool on
    // this server; the other eleven are memory tools, and none of them takes a
    // secret. The sentence sent a reviewer looking for a consumer that does not
    // exist, which is the kind of mismatch Anthropic's directory policy fails
    // a submission for.
    [/a tool that consumes it/i, "the phantom secret-consumer claim"],
    // "negative feedback lets it fade" — withdrawn from the README by 0.9.1
    // (#95) as false for a reason that has nothing to do with the re-ranking
    // fix: nothing time-decays and nothing is auto-deleted, so a downvoted
    // memory is out-ranked, not erased. It nevertheless survived the release
    // on three surfaces a model reads, this one included. The whole word is
    // banned because no true sentence about this engine needs it.
    [/\bfades?\b/i, "the 'lets it fade' time-decay claim"],
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

  // llms.txt is hand-written — it is NOT one of the 19 artifacts
  // scripts/generate-configs.mjs emits, so `npm run verify:configs` never
  // looks at it and no other test did either. That is exactly how it kept
  // describing feedback as "Negative lets memories fade" through a release
  // whose own CHANGELOG deletes the claim. It is a surface a model reads;
  // it gets the same ban as the wire.
  it("the hand-written llms.txt carries none either", () => {
    const llms = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");
    for (const [banned, why] of WITHDRAWN) {
      expect(llms, `llms.txt restores ${why}`).not.toMatch(banned);
    }
  });
});
