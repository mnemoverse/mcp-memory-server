/**
 * Tool-wiring contract — every parameter a tool ADVERTISES must actually reach
 * the request body.
 *
 * This is the failure mode that hurts, because it is silent: a tool declares
 * `until` in its input schema, a model reads the schema and passes `until`, the
 * handler destructures something else, and the server — which ignores unknown
 * fields rather than rejecting them — returns an unfiltered answer. Nothing
 * errors anywhere. The caller just gets the wrong memories and has no way to
 * tell.
 *
 * HOW THIS TEST WORKS NOW, AND WHY IT CHANGED. It used to read src/index.ts as
 * text: slice out a `server.registerTool(…)` block, regex the field names out of
 * `inputSchema: { … }`, then call the body builders from src/requests.ts
 * directly. That measured two things and joined them with a hope. The builders
 * were proven to forward values the TEST handed them; whether the HANDLER hands
 * them the parameters it advertises was covered by a third check that asserted
 * the builder call "mentions" each name — a tripwire that, as its own comment
 * said, cannot see a value that is renamed or shadowed on the way in. That
 * comment ended: "The real fix is to connect a client over the SDK's in-memory
 * transport and invoke the tools for real, which needs src/index.ts to stop
 * opening a stdio transport on import."
 *
 * That is what this now does. The advertised parameters come from `tools/list`,
 * as a model sees them; the values come out of the actual HTTP request the
 * handler made. Nothing about this file knows how src/index.ts is written, so a
 * reformat cannot weaken it and a rename cannot slip past it — and both the
 * VALUE and the key are checked, which the source version could not do at all.
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

/**
 * A type-appropriate sentinel per parameter, because a body builder may
 * legitimately drop a falsy value (`limit: 0` becomes the default) and a test
 * that fed `undefined` everywhere would pass while forwarding nothing. Each
 * value is distinctive, so a handler that forwards the WRONG parameter under the
 * right key is caught too.
 */
const SENTINEL: Record<string, unknown> = {
  query: "sentinel-query",
  content: "sentinel-content",
  concepts: ["sentinel-concept"],
  domain: "sentinel-domain",
  order_by: "recency",
  since: "2026-08-01T00:00:00Z",
  until: "2026-08-02T00:00:00Z",
  exclude_author: "sentinel-author",
  top_k: 7,
  limit: 11,
  cursor: "sentinel-cursor",
};

/** The parameter names a model is shown — from the wire, not from the source. */
async function advertisedParams(tool: string): Promise<string[]> {
  const { tools } = await mcp.client.listTools();
  const found = tools.find((t) => t.name === tool);
  expect(found, `${tool} is not registered`).toBeDefined();
  const props = Object.keys(found!.inputSchema?.properties ?? {});
  expect(
    props.length,
    "no parameters advertised — a schema that shrank to nothing still reports green",
  ).toBeGreaterThan(0);
  return props;
}

function argsFor(declared: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const p of declared) {
    expect(SENTINEL, `no sentinel defined for the new parameter "${p}"`).toHaveProperty(p);
    args[p] = SENTINEL[p];
  }
  return args;
}

/**
 * Call the tool with a sentinel for every advertised parameter and return the
 * body that actually went over the wire.
 */
async function bodySentFor(
  tool: string,
  route: string,
  reply: unknown,
): Promise<{ declared: string[]; body: Record<string, unknown> }> {
  const declared = await advertisedParams(tool);
  mcp.on(route, reply);
  await mcp.callText(tool, argsFor(declared));
  return { declared, body: mcp.requestTo(route).body as Record<string, unknown> };
}

const CASES: Array<[tool: string, route: string, reply: unknown]> = [
  // Non-empty results on purpose: the empty branches make extra probe calls,
  // which is their own contract (test/handlers.test.ts) and noise here.
  [
    "memory_read",
    "POST /memory/read",
    { items: [{ atom_id: "a1", content: "hit" }], search_time_ms: 3 },
  ],
  [
    "memory_list_recent",
    "POST /memory/recent",
    { items: [{ atom_id: "a1", content: "hit" }], next_cursor: null },
  ],
  ["memory_write", "POST /memory/write", { stored: true, atom_id: "a1", importance: 0.7 }],
];

describe("every advertised parameter reaches the wire, carrying its own value", () => {
  for (const [tool, route, reply] of CASES) {
    it(`${tool} sends each parameter it advertises`, async () => {
      const { declared, body } = await bodySentFor(tool, route, reply);
      for (const p of declared) {
        // Subset, not equality: a handler may also send constants the caller
        // never supplies (`include_associations`, the default `top_k`). What
        // must never happen is the other direction.
        expect(body, `${p} is advertised but never sent`).toHaveProperty(p);
        expect(body[p], `${p} is sent, but not the value the caller passed`).toEqual(
          SENTINEL[p],
        );
      }
    });
  }
});

describe("memory_list_recent", () => {
  it("advertises exactly the filters the feed supports", async () => {
    expect((await advertisedParams("memory_list_recent")).sort()).toEqual([
      "cursor",
      "domain",
      "exclude_author",
      "limit",
      "since",
      "until",
    ]);
  });
});

describe("memory_read", () => {
  it("advertises the temporal filters, and they are not dropped", async () => {
    const { declared, body } = await bodySentFor("memory_read", "POST /memory/read", {
      items: [{ atom_id: "a1", content: "hit" }],
    });
    for (const p of ["since", "until", "exclude_author"]) {
      expect(declared, `${p} is no longer advertised`).toContain(p);
      expect(body[p]).toEqual(SENTINEL[p]);
    }
  });
});

/**
 * The wire contract for a domain, checked on the value that ships.
 *
 * 0.8.1 briefly trimmed `domain` at the edge of each handler, and the revert of
 * that trim dropped `|| undefined` on the read path so `domain: ""` became
 * `WHERE domain = ''` — a store that cannot exist, turning a search of every
 * domain into a guaranteed miss. Both shipped past a guard that grepped the
 * source for the ABSENCE of a `.trim()`, which cannot see a DELETED coercion.
 *
 * src/requests.ts pins the whole input matrix at the unit level
 * (test/requests.test.ts). What could not be checked before is that the handler
 * uses those builders on the way out — so these two cases are the end-to-end
 * anchors: the padded name that must survive, and the empty string that must
 * disappear.
 */
describe("a domain crosses the handler untouched", () => {
  const PADDED = " xroom:room_01ABC";

  it("memory_write sends the padded name exactly, so core's 400-guard still fires", async () => {
    // Trimming here normalised past a deliberate rejection in core and the atom
    // would have landed in the ROOM's store, visible to every member.
    mcp.on("POST /memory/write", { stored: true, atom_id: "a1", importance: 0.5 });
    await mcp.callText("memory_write", { content: "x", domain: PADDED });
    expect(mcp.requestTo("POST /memory/write").body).toMatchObject({ domain: PADDED });
  });

  it("memory_read omits an empty domain rather than sending one", async () => {
    mcp.on("POST /memory/read", { items: [{ atom_id: "a1", content: "hit" }] });
    await mcp.callText("memory_read", { query: "q", domain: "" });
    expect(mcp.requestTo("POST /memory/read").body).not.toHaveProperty("domain");
  });
});
