#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  formatReadItem,
  formatRecentPage,
  safeInline,
  type Provenance,
  type ReadItem,
  type RecentItem,
} from "./render.js";
// `NO_MATCH_MESSAGE` is no longer imported here: this file used to pick between
// it and buildReadEmptyResponse by testing a note string for truthiness, which
// is how "we could not check" came to be spelled like "the store is there".
// Assembling the whole answer belongs in one place — src/teaching.ts.
import { SERVER_INSTRUCTIONS, buildReadEmptyResponse } from "./teaching.js";
import {
  classifyRooms,
  futureSinceNote,
  probeReadScope,
  readScopeNote,
  scopeLabel,
  type ReadScope,
} from "./scope.js";
import {
  readRequestBody,
  recentRequestBody,
  writeRequestBody,
  searchedScope,
} from "./requests.js";
import {
  domainPhrase,
  exactLiteral,
  formatDomainList,
  roomNamePhrase,
  withDomainEscapeLegend,
} from "./names.js";

/**
 * What we know about the scope this read actually covered — one probe on the
 * zero-result path, returning a VALUE rather than a sentence-or-empty-string.
 *
 * This replaces `domainMissNote`, whose `catch { return ""; }` made three
 * different states share one spelling: the store is there and the query missed,
 * the room is there and the query missed, and the probe failed. The caller then
 * read that string as a boolean, so "we could not check" was rendered exactly
 * like "the store exists" — the collision this release is about, at the point
 * where the whole scoped path converges. The states are now arms of a union
 * (src/scope.ts) and every consumer must answer for each of them.
 *
 * The probe routing lives in src/scope.ts: a room address is checked against the
 * ROOM list and a domain against `/memory/stats`, because stats never contains a
 * room address (CodeRabbit #65). `searched` is the RAW value that went over the
 * wire, so the diagnosis can never describe a different store than the request.
 */
function probeScope(searched: string | undefined): Promise<ReadScope> {
  return probeReadScope(
    searched,
    () => apiFetch<unknown>("/memory/stats"),
    () => apiFetch<unknown>("/memory/rooms"),
    safeInline,
  );
}

// Version is read at runtime from package.json so there is exactly one place
// to bump on each release. Works both from `dist/` during local dev and from
// `node_modules/@mnemoverse/mcp-memory-server/dist/` after an npm install.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const API_URL =
  process.env.MNEMOVERSE_API_URL || "https://core.mnemoverse.com/api/v1";
const API_KEY = process.env.MNEMOVERSE_API_KEY || "";

// Hard cap on tool result size — required by Claude Connectors Directory
// (https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide).
// Approximate token count = chars / 4. Cap at 24,000 tokens to leave headroom under the 25K limit.
const MAX_RESULT_CHARS = 24_000 * 4;

// The API key is validated lazily — inside apiFetch, on the first tool call —
// rather than at startup. This lets the server START WITHOUT a key so that
// `tools/list` and other introspection work key-free. MCP directories and
// registries (e.g. Glama) boot the server to enumerate and score its tools,
// and clients may browse capabilities before sign-in; a startup exit on a
// missing key blocks all of that. A tool *invocation* without a key returns a
// clear, actionable error instead (see apiFetch).

/**
 * Fetch from the Mnemoverse core API with authentication.
 *
 * Generic so call sites can declare the expected response shape:
 *
 *     const r = await apiFetch<{ stored: boolean; atom_id: string }>("/memory/write", { ... });
 *
 * Handles 204 No Content and empty bodies defensively — FastAPI DELETE
 * handlers may switch to 204 in the future even though today they return
 * a JSON body.
 *
 * @throws Error with message `Mnemoverse API error {status}: {body}` on non-2xx.
 */
async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!API_KEY) {
    throw new Error(
      "MNEMOVERSE_API_KEY is required for this operation. Get a free key at " +
        "https://console.mnemoverse.com and set it in your MCP client config.",
    );
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mnemoverse API error ${res.status}: ${text}`);
  }

  // 204 No Content or empty body — return an empty object cast as T so
  // call sites using optional chaining still work without crashing.
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return {} as T;
  }

  return (await res.json()) as T;
}

/**
 * Truncate a result string to MAX_RESULT_CHARS, appending a notice if truncated.
 * Required by Claude Connectors Directory submission policy.
 *
 * Defensive against splitting UTF-16 surrogate pairs: if the character right
 * before the cut point is a high surrogate (U+D800–U+DBFF), drop it so the
 * result stays well-formed. Otherwise an emoji or non-BMP character at the
 * boundary can produce a lone surrogate and corrupt downstream JSON encoding.
 */
function capResult(
  text: string,
  moreHint = "Use a more specific query or smaller top_k to see all results.",
): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  let truncated = text.slice(0, MAX_RESULT_CHARS - 200);
  const lastCode = truncated.charCodeAt(truncated.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  // `moreHint` lets no-input tools (the discovery lists) give accurate truncation
  // guidance instead of the read-tool default (which points at query/top_k controls a
  // repeated no-arg call cannot use). Existing callers keep the default message.
  return `${truncated}\n\n[…truncated to fit the 25K token limit. ${moreHint}]`;
}

/**
 * Two renderers, and which one a value gets is a decision, not a style choice.
 *
 * `safeInline` (src/render.ts) SANITISES an untrusted display string for inline
 * rendering in tool output that a DIFFERENT principal's LLM will read (CN-032
 * anti-injection): strip to a conservative charset, collapse whitespace, cap
 * the length. The treatment `formatAuthorTag` applies to a server-stamped
 * author, and the defensive second pass the machine-shaped room fields
 * (address, room_id, role, scope — all charset-validated or enum-shaped in
 * core) get here. It is lossy on purpose, and everything it still renders is a
 * value the reader looks at and never has to retype or compare.
 *
 * `exactLiteral` / `domainPhrase` / `roomNamePhrase` (src/names.ts) print a
 * value as a JSON string literal, or refuse to print it. Domain names because
 * the engine matches them byte-for-byte, so the reader must be able to send
 * the exact bytes back. Room NAMES (0.8.1) because the sanitiser did not make
 * them harmless so much as it made them WRONG: "проект" echoed back as `""` on
 * create, "Zoë" as "Zo" inside quotes that claim to be the name. The literal
 * is one line with quotes, backslashes and invisibles escaped, so it is as
 * injection-safe as the sanitised spelling was — without the renaming.
 */

// --- Server setup ---

// The second argument lands verbatim in the connected model's system prompt on
// clients that surface MCP instructions — it is the single highest-leverage
// teaching surface this server has. Kept in src/teaching.ts so tests can
// assert its polarity/length without booting the server.
//
// EXPORTED so a test can connect a real MCP client to this exact server over
// the SDK's in-memory transport and invoke the tools (test/harness.ts). Nothing
// on the published CLI path reads this binding — see the note at the bottom of
// the file for why the export alone is not enough, and what the CLI still does.
export const server = new McpServer(
  {
    name: "mnemoverse-memory",
    version: pkg.version,
  },
  { instructions: SERVER_INSTRUCTIONS },
);

// --- Tool: memory_write ---

server.registerTool(
  "memory_write",
  {
    description:
      "Store a long-term memory that persists across sessions AND across every AI tool the user has connected to Mnemoverse (Claude, ChatGPT, Cursor, VS Code) — write once, recall everywhere. Call this PROACTIVELY the moment the user states a preference, makes a decision, or you learn a durable fact (people, roles, project setup, a lesson). Don't wait to be asked. Never store passwords, API keys, payment data, MFA codes, government IDs, or health records; skip transient chatter that only matters this turn. Behavior: an importance gate may filter low-value writes, so the result tells you whether the memory was stored or filtered. Write `content` as a self-contained statement that still makes sense when recalled out of context.",
    inputSchema: {
      content: z
        .string()
        .min(1)
        .max(10000)
        .describe(
          "The memory to store as a self-contained statement, e.g. 'User prefers TypeScript strict mode' or 'Decided to deploy the API on Cloudflare Workers (2026-06)'.",
        ),
      concepts: z
        .array(z.string())
        .optional()
        .describe(
          "Key concepts for linking related memories (e.g. ['deploy', 'friday', 'staging'])",
        ),
      domain: z
        .string()
        .optional()
        .describe(
          "Namespace to organize memories (e.g. 'engineering', 'user:alice', 'project:acme')",
        ),
    },
    annotations: {
      title: "Store Memory",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ content, concepts, domain }) => {
    // NO NORMALISATION HERE — deliberately, after a review found two ways it
    // breaks (2026-08-08). Trimming looked like an obvious win: domain names
    // are matched byte-for-byte in core, so " engineering" opens a permanent
    // second store beside "engineering". But:
    //
    //   1. Core REJECTS a non-canonical room address on purpose — 400
    //      "Non-canonical room address", so a write "can't be mis-routed and
    //      tagged with a spoofed xroom domain" in its own words. Trimming
    //      " xroom:room_01ABC" normalises past that guard, and the atom lands
    //      in the ROOM's store, visible to every member. Content that never
    //      left the caller in 0.8.0 would leave the account in 0.8.1. The
    //      address in that shape is one our own output hands the model.
    //   2. For a caller who has been padding a domain for months, trimming
    //      silently relocates new writes and orphans the old corpus — and
    //      memory_delete_domain does NOT trim, so the same client can no
    //      longer even name the shard it created.
    //
    // Both are behaviour changes, so they do not belong in a patch whose
    // whole claim is that it only changes wording. Normalisation returns in
    // 0.9.0 with delete_domain included, room addresses deliberately EXEMPT,
    // and zero-width characters handled (JS trim() does not strip them —
    // verified, contrary to what an earlier comment here asserted).
    const r = await apiFetch<{
      stored?: boolean;
      atom_id?: string | null;
      importance?: number;
      reason?: string;
    }>("/memory/write", {
      method: "POST",
      body: JSON.stringify(writeRequestBody({ content, concepts, domain })),
    });

    // "unknown", not 0.00, when the server didn't send a score — the same rule
    // memory_stats got in this release. A live surface exists that answers
    // {"stored":false} with no reason and no score; printing "0.00" there
    // fabricates the gate's verdict (review, 2026-08-08).
    const importance =
      typeof r?.importance === "number" ? r.importance.toFixed(2) : "unknown";

    // `Server reason:` is a VERBATIM label, and safeInline made it a lie on
    // every occurrence: core's only rejection reason is
    // "Below importance threshold (0.412 < 0.500)", whose parentheses and `<`
    // are outside the sanitiser's charset — so the relay read "Below importance
    // threshold 0.412 0.500", with the comparison operator and both delimiters
    // deleted and the two numbers left unlabelled and order-only. Quoted
    // exactly instead (src/names.ts). If it will not fit, say THAT rather than
    // drop the clause: omitting it would report a server that gave no reason.
    const reasonQuote = r?.reason
      ? (exactLiteral(r.reason, 400)?.literal ?? "(too long to quote exactly)")
      : "";

    if (r?.stored) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Stored (importance: ${importance}). ID: ${r.atom_id ?? "unknown"}`,
          },
        ],
      };
    }
    // NOT STORED. The old wording ("Filtered — …") named the mechanism but
    // never the outcome, so a caller could read it as a soft success and move
    // on. In dogfooding this ate a CORRECTION to a wrong fact: the stale
    // version stayed as the only record, and looked more authoritative for
    // having no competitor (2026-08-07).
    //
    // The ADVICE was wrong until 2026-08-08, and wrong in a way that made
    // things worse. It told the caller to rewrite the content as a cleaner
    // factual statement — but the gate scores GEOMETRIC NOVELTY against the
    // nearest existing atom in the same domain, not phrasing or factuality.
    // "Below importance threshold" means TOO SIMILAR TO SOMETHING ALREADY
    // STORED. A rewrite of the same fact therefore produces a near-identical
    // embedding, scores the same or lower, and is rejected again — and the old
    // text ended with "write it again", so a compliant agent looped. It was
    // anti-correlated with the mechanism in exactly the case it was written
    // for: a correction, which is by nature similar to what it corrects.
    return {
      content: [
        {
          type: "text" as const,
          // WHAT IS CONDITIONAL HERE, stated exactly, because a previous
          // version of this comment claimed more than the code does.
          //
          // Conditional: the SERVER'S VERDICT and the SCORE. `Server reason:`
          // is printed only when `reason` came back, and `Novelty score` only
          // when a numeric `importance` did — a live surface answers
          // `{"stored":false}` with neither, and quoting a verdict nobody sent
          // would be a claim on zero evidence.
          //
          // Unconditional: the MECHANISM sentence below, and it is not derived
          // from this response. It is a statement about core: `/memory/write`
          // refuses for exactly one reason — the importance gate, scoring
          // geometric novelty against the nearest existing atom in the same
          // domain, with "Below importance threshold (x < y)" as its only text
          // (two branches in memory_engine, one reason). The BATCH endpoint has
          // other failure paths; this client does not call it. So for any
          // rejection this client can receive, that sentence is true whether or
          // not the server bothered to say why. The earlier comment here read
          // "the cause is named only when the server named it", which describes
          // a draft that did not carry this sentence at all.
          //
          // NOT PRESENT AT ALL: a prediction about the retry. "Rewording will
          // score the same or lower" was asserted as fact and is probably
          // BACKWARDS — novelty decreases with similarity to the blocking
          // memory, so a reworded sentence is usually LESS similar and scores
          // HIGHER. And the delete-then-write advice an earlier draft carried is
          // impossible for a room write: the blocker is a room atom, which
          // memory_delete cannot touch, as this file's own delete message says
          // (reviews, 2026-08-08).
          text:
            `NOT STORED — nothing was saved.` +
            (reasonQuote ? ` Server reason: ${reasonQuote}.` : ``) +
            (importance === "unknown" ? `` : ` Novelty score ${importance}.`) +
            ` Writes are gated on how much a memory adds over what is already in the` +
            ` same domain, so a near-duplicate is refused. If the point is genuinely` +
            ` new, write what is DIFFERENT rather than restating the whole fact.`,
        },
      ],
    };
  },
);

// --- Tool: memory_read ---

server.registerTool(
  "memory_read",
  {
    description:
      "Search your long-term memory before answering anything that may have come up before — user preferences, past decisions, project setup, people, or earlier context. This memory is shared: it persists across sessions and across every AI tool the user has connected (Claude, ChatGPT, Cursor, VS Code). ALWAYS check here first when you're unsure whether you already know something; no need to call it for general world knowledge you already hold. Returns matches ranked by relevance (or newest-first with order_by: 'recency'); each result carries an id you can pass to memory_feedback or memory_delete.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .max(5000)
        .describe(
          "Natural-language description of what you're looking for, e.g. 'database choice for the API' or 'user's preferred testing framework'.",
        ),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe(
          "Requested number of results (default: 5). ⚠️ Not a hard cap: association expansion can return MORE than this, and the relevance floor can return fewer — raising it does not reliably widen the result set. For a complete, exactly-bounded listing use memory_list_recent instead.",
        ),
      domain: z
        .string()
        .optional()
        .describe(
          "Restrict the search to one domain namespace (e.g. 'project:acme'). Omitting it searches your OWN domains — it does NOT include shared rooms, which are separate stores: to search a room, pass its address here (e.g. 'xroom:room_01ABC'). Find room addresses with memory_list_rooms.",
        ),
      order_by: z
        .enum(["relevance", "recency"])
        .optional()
        .describe(
          "'relevance' (default) = ranking order. 'recency' = the matched " +
            "set re-sorted newest-first. For a complete newest-first feed " +
            "with no search at all, use memory_list_recent instead.",
        ),
      since: z
        .string()
        .max(40)
        .optional()
        .describe(
          "Only memories created at/after this ISO-8601 instant (naive = " +
            "UTC) — e.g. your last-seen watermark in a shared room.",
        ),
      until: z
        .string()
        .max(40)
        .optional()
        .describe("Only memories created at/before this ISO-8601 instant."),
      exclude_author: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Drop memories written by this author PRINCIPAL — the server-side " +
            "identity. ⚠️ NOT USABLE FROM HERE YET: the principal is not shown " +
            "in these results, so there is no value you can obtain through " +
            "this tool, and a guess like 'me' silently matches nothing and " +
            "filters nothing. Only pass it if your system knows the exact " +
            "principal from elsewhere (e.g. the REST API). A self-exclusion " +
            "shortcut is planned.",
        ),
    },
    annotations: {
      title: "Search Memories",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ query, top_k, domain, order_by, since, until, exclude_author }) => {
    // ONE value, used for the request AND for every decision about it.
    //
    // A previous draft sent the raw string but decided the wording from a
    // TRIMMED copy, and the two disagreed in the release's own founding case:
    // a read on " engineering" searched the padded store (correct) while the
    // diagnosis checked "engineering", found it, and stayed silent — so the
    // one note that would have said "a stray space makes a different store"
    // was suppressed exactly when a stray space had made a different store.
    // For a whitespace-only domain it went the other way and claimed the
    // search had covered the caller's own domains when it had covered none
    // (reviews, 2026-08-08).
    //
    // `|| undefined` is what 0.8.0 sent and must stay: core filters on
    // `domain is not None`, not on truthiness, so passing "" through would
    // become `WHERE domain = ''` — a store that cannot exist — turning a
    // search of every domain into a guaranteed miss. That is data movement,
    // not wording, and it does not belong in a patch.
    const searched = searchedScope(domain);
    const r = await apiFetch<{
      items?: ReadItem[];
      search_time_ms?: number;
    }>("/memory/read", {
      method: "POST",
      body: JSON.stringify(
        readRequestBody({ query, top_k, domain, order_by, since, until, exclude_author }),
      ),
    });

    const items = Array.isArray(r?.items) ? r.items : [];

    if (items.length === 0 && (since || until || exclude_author)) {
      // A bounded/filtered read that finds nothing is NOT a bad query —
      // the truthful answer is "nothing new for these filters" (the feed's
      // filtered head uses the same sentence; no stats probe, no broaden
      // hint). Unscoped, it also has to name the rooms it never looked in.
      const scopeNote = readScopeNote(await probeScope(searched));
      return {
        content: [
          {
            type: "text" as const,
            // The scope is IN the sentence, not appended after it. This
            // branch was already the honest one in 0.8.0 — it names its
            // filters — and it is the model the feed's copy now follows.
            //
            // The legend wraps the WHOLE message and is added at most once:
            // `scopeNote` may itself have named a store (a case-twin), and one
            // explanation of the escaping per answer is the point of it.
            text: withDomainEscapeLegend(
              `Nothing in ${scopeLabel(searched)} matches within the given time/author filters.` +
                futureSinceNote(since, Date.now()) +
                scopeNote,
              searched,
            ),
          },
        ],
      };
    }

    if (items.length === 0) {
      // Zero results. The scope is probed FIRST and the whole answer is then
      // assembled from that ONE value in src/teaching.ts — head sentence and
      // disclosure together, per state.
      //
      // ORDER MATTERS and is now structural: whether the caller has rooms we
      // could not search decides whether the first-contact greeting is even
      // true, so the room knowledge is an INPUT to the answer rather than a flag
      // consulted beside it. `total_atoms` counts the personal org only, so a
      // joiner with three full rooms and no personal writes would otherwise be
      // told "nothing has been saved yet" and contradicted by the note right
      // underneath (review, 2026-08-08).
      //
      // Nothing is appended here any more. While the head came from teaching.ts
      // and the tail was concatenated at this line, the two could disagree — a
      // head promising "that is not the whole picture:" with an empty tail after
      // it was a live bug for an account whose only room was archived.
      const scope = await probeScope(searched);
      const text = await buildReadEmptyResponse(
        () => apiFetch<{ total_atoms?: number }>("/memory/stats"),
        scope,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: withDomainEscapeLegend(text, searched),
          },
        ],
      };
    }

    // Rendering lives in src/render.ts (testable): each line carries the
    // CN-001 author tag, the created_at date (#404 R1 — a reader cannot
    // reason about recency it cannot see) and the full atom id (the tool
    // description always promised ids for memory_feedback/memory_delete;
    // the old render never delivered them, making both uncallable from
    // read results).
    const lines = items.map((item, i) => formatReadItem(item, i));

    // `?? 0` prints a FABRICATED `(0ms)` when the server sent no timing — the
    // same class as "Associations: 0" for an unknown count, which memory_stats
    // fixed in this release. Untouched here and recorded in CHANGELOG's "Known
    // and NOT fixed here" with the other three.
    const searchMs = (r?.search_time_ms ?? 0).toFixed(0);
    const text = lines.join("\n\n") + `\n\n(${searchMs}ms)`;

    return {
      content: [
        {
          type: "text" as const,
          // Each line's `@"domain"` tag is an exact literal; the legend that
          // explains an escape belongs to the answer, not to twenty tags.
          text: capResult(
            withDomainEscapeLegend(text, ...items.map((it) => it?.domain)),
          ),
        },
      ],
    };
  },
);

// --- Tool: memory_list_recent ---

server.registerTool(
  "memory_list_recent",
  {
    description:
      "List the NEWEST memories first — no search query needed. Semantic search answers 'what do I know about X'; this answers 'what happened lately': resuming work after a break, catching up on a shared room ('any new messages?'), or reviewing what was saved recently. Pass `since` (your last-seen time) to get only what's new, and page through older entries with the returned cursor. Complete by construction WITHIN ONE SCOPE — nothing is skipped there, unlike a semantic search. To catch up on a shared room you MUST pass its address as `domain`: rooms are separate stores and an unscoped call never covers them.",
    inputSchema: {
      domain: z
        .string()
        .optional()
        .describe(
          "Restrict to one domain. REQUIRED to read a shared room — pass its address ('xroom:room_01ABC'), because rooms are separate stores that an unscoped feed does NOT cover. Omit only when you mean your own domains. Room addresses come from memory_list_rooms.",
        ),
      since: z
        .string()
        .optional()
        .describe(
          "Only entries created at/after this ISO-8601 instant (naive = UTC) — your novelty watermark.",
        ),
      until: z
        .string()
        .optional()
        .describe(
          "Only entries created at/before this ISO-8601 instant (inclusive). Pair with `since` to read a closed window — 'what happened on Monday' — instead of paging back from now.",
        ),
      exclude_author: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Drop entries written by this author PRINCIPAL. ⚠️ NOT USABLE FROM HERE YET — the principal is never shown in these results, so there is no value you can get through this tool; a guess like 'me' filters nothing, silently. Same caveat as on memory_read.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Page size (default: 20). Newest first."),
      cursor: z
        .string()
        .max(512)
        .optional()
        .describe(
          "Opaque cursor from a previous page's 'More older entries exist' line — continues the listing without skips or duplicates.",
        ),
    },
    annotations: {
      title: "List Recent Memories",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ domain, since, until, exclude_author, limit, cursor }) => {
    // ONE value for the request and for every decision about it — see the note
    // at the top of memory_read.
    const searched = searchedScope(domain);
    let r: { items?: RecentItem[]; next_cursor?: string | null };
    try {
      r = await apiFetch<{ items?: RecentItem[]; next_cursor?: string | null }>(
        "/memory/recent",
        {
          method: "POST",
          body: JSON.stringify(
            recentRequestBody({ domain, since, until, exclude_author, limit, cursor }),
          ),
        },
      );
    } catch (e) {
      // Graceful degradation while the server side rolls out: a 404 with no
      // error `code` in the body is what an undeployed /memory/recent looks
      // like, so degrade to a usable alternative instead of surfacing a raw
      // HTTP error.
      //
      // NAMED FOR WHAT IT TESTS. This was `endpointAbsent`, which asserted a
      // deployment fact the check cannot establish: every engine 404 carries a
      // `code`, so a real room-404 is excluded, but a gateway, a proxy or a
      // wrong MNEMOVERSE_API_URL produces the same bare 404 and is
      // indistinguishable from here. The MESSAGE below still states the
      // deployment cause outright, which is more than this boolean knows —
      // listed in CHANGELOG's "Known and NOT fixed here" rather than papered
      // over with a hedge.
      const bare404 =
        e instanceof Error &&
        e.message.startsWith("Mnemoverse API error 404:") &&
        !e.message.includes('"code"');
      if (bare404) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "The memory service does not support the recent-entries feed yet. " +
                "Use memory_read with order_by: 'recency' as an approximation.",
            },
          ],
        };
      }
      throw e;
    }

    const items = Array.isArray(r?.items) ? r.items : [];
    if (items.length === 0) {
      // THE SENTENCE ITSELF carries the scope — and it is selected by EVERY
      // filter that narrowed the window, not by `since` alone.
      //
      // Two prior shapes of this branch were wrong the same way. In 0.8.0 it
      // printed "Nothing new since your watermark." with no scope in it — the
      // sentence src/scope.ts was written to eliminate. The first fix put the
      // scope into the clause but kept choosing BETWEEN the two heads by
      // looking at `since` only, so {until} alone and {exclude_author} alone
      // fell to "No memories in ${where} yet." — an emptiness claim about a
      // store holding a thousand atoms outside the window — and {since, until}
      // kept the watermark phrasing, which pretends the read reached the
      // present when `until` stopped it years short (review, 2026-08-08).
      //
      // Four heads, one rule: the emptiness claim ("yet") is allowed only
      // when NOTHING narrowed the window; the watermark phrasing only when
      // `since` was the whole narrowing; any other filter combination gets the
      // sentence memory_read's filtered branch uses — the filters are named as
      // what bounded the result, and nothing is claimed beyond them.
      //
      // A `cursor` outranks all three. It is not a filter over the store — it
      // is a POSITION in a listing whose earlier pages the caller has already
      // read, so every other head is false here: "No memories in ${where}
      // yet." is an absence claim about a store the caller has just SEEN
      // entries from, and the watermark phrasing pretends a continuation that
      // stopped mid-listing was a clean catch-up. The engine hands out a
      // cursor only when more entries existed at that moment, so an empty
      // continued page means the listing moved under the caller — entries
      // removed between page fetches — and the head speaks about the
      // continuation only, never about what the store holds (follow-up to the
      // head-selection fix, 2026-08-08). Decided by the same truthiness the
      // request used: an empty-string cursor never reaches the wire
      // (src/requests.ts), so it may not pick the sentence either.
      const scopeNote = readScopeNote(await probeScope(searched));
      const where = scopeLabel(searched);
      const head = cursor
        ? `Nothing further in ${where} past this cursor — entries may have been ` +
          `removed since the previous page was fetched.` +
          (since || until || exclude_author
            ? ` The given time/author filters still bounded this page.`
            : ``)
        : since && !until && !exclude_author
          ? `Nothing new in ${where} since your watermark.`
          : since || until || exclude_author
            ? `Nothing in ${where} matches within the given time/author filters.`
            : `No memories in ${where} yet.`;
      return {
        content: [
          {
            type: "text" as const,
            text: withDomainEscapeLegend(
              head + futureSinceNote(since, Date.now()) + scopeNote,
              searched,
            ),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: capResult(
            formatRecentPage(items, r?.next_cursor),
            "Lower `limit` or add a `domain` for smaller pages.",
          ),
        },
      ],
    };
  },
);

// --- Tool: memory_feedback ---

server.registerTool(
  "memory_feedback",
  {
    description:
      "Report whether memories returned by memory_read were actually helpful. This is a learning signal, not a log: positive feedback raises a memory's ranking so it surfaces faster next time (across all of the user's tools), negative feedback lets it fade. Call it right after you act on (or reject) recalled memories, passing the ids from the memory_read results. NOTE: this reaches your own domains only — it takes no domain argument, so rating a memory that lives in a shared room silently does nothing.",
    inputSchema: {
      atom_ids: z
        .array(z.string())
        .min(1)
        .describe(
          "IDs of memories to give feedback on (from memory_read results)",
        ),
      outcome: z
        .number()
        .min(-1)
        .max(1)
        .describe(
          "How helpful was this? 1.0 = very helpful, 0 = neutral, -1.0 = harmful/wrong",
        ),
    },
    annotations: {
      title: "Rate Memory Helpfulness",
      readOnlyHint: false,
      // Feedback permanently mutates the memory's valence and importance
      // scores on the backend — per MCP spec, that is a destructive update
      // to the stored state (cf. ToolAnnotations.destructiveHint), even
      // though the caller intends it as quality signal rather than delete.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ atom_ids, outcome }) => {
    const r = await apiFetch<{ updated_count?: number }>("/memory/feedback", {
      method: "POST",
      body: JSON.stringify({ atom_ids, outcome }),
    });

    const count = r?.updated_count ?? 0;

    // "Feedback recorded for 0 memories." is one character away from the
    // success line and reads like one. But the DIAGNOSIS matters as much as
    // the fact: an earlier version of this branch blamed deletion, which is
    // usually the wrong cause (review, 2026-08-08).
    //
    // Core resolves the feedback org from a `domain` argument that defaults to
    // "general" — and THIS TOOL EXPOSES NO domain PARAMETER. So the ordinary
    // way to get zero is to rate atoms that live somewhere else: read a room,
    // take the ids off the `id:` lines, rate them, and every one silently
    // misses. The atoms exist, the ids are valid, and telling the caller they
    // were deleted sends them to look for a problem that isn't there.
    if (count === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              // No frequency claim. "Most often that means…" was a statistic
              // we do not have (review, 2026-08-08); the causes are listed as
              // possibilities, with the one the caller cannot otherwise guess
              // first because it is invisible from the tool surface.
              "No feedback was recorded — none of those ids matched a memory in your own " +
              "domains. Possible causes: the ids came from a shared room (this tool takes " +
              "no domain argument and cannot reach room atoms, so rating them is a no-op); " +
              "the memory was deleted; or the id came from somewhere other than a " +
              "memory_read result.",
          },
        ],
      };
    }

    // Echo the DIRECTION, not just the count: the same four words for +1 and
    // -1 gave a caller no evidence the loop did anything, which is why nobody
    // calls it twice.
    //
    // The effect clause is per-direction. Promising "this shifts how they
    // rank" for outcome 0 would be a claim we cannot make — dogfooding saw a
    // neutral rating move a score UP by about five points, so neither "no
    // change" nor "ranks higher" is safe to assert (CodeRabbit, #65).
    const noun = `${count} memor${count === 1 ? "y" : "ies"}`;
    const text =
      outcome > 0
        ? `Recorded +${outcome} (helpful) for ${noun} — they should surface sooner next time.`
        : outcome < 0
          ? `Recorded ${outcome} (unhelpful) for ${noun} — they should fade.`
          // Neutral says nothing about the effect, in either direction. The
          // previous wording ("use +1 or -1 when you want the ranking to move")
          // implied 0 leaves ranking alone — which the comment above forbids,
          // since dogfooding saw a neutral rating move a score UP by about five
          // points (review, 2026-08-08).
          : `Recorded 0 (neutral) for ${noun} — logged as a recall that was neither useful nor wrong. Use +1 or -1 to express a direction.`;
    return {
      content: [{ type: "text" as const, text }],
    };
  },
);

// --- Tool: memory_stats ---

server.registerTool(
  "memory_stats",
  {
    description:
      "Get an overview of the stored memory: total count, episodes vs consolidated prototypes, number of learned associations, the list of domains, and average quality scores. This memory is shared across all AI tools the user has connected to Mnemoverse. Use it to orient yourself, to confirm the exact domain name before a delete, or when the user asks what you remember. Read-only — changes nothing.",
    inputSchema: {},
    annotations: {
      title: "Memory Statistics",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const r = await apiFetch<{
      total_atoms?: number;
      episodes?: number;
      prototypes?: number;
      hebbian_edges?: number;
      domains?: string[];
      avg_valence?: number;
      avg_importance?: number;
    }>("/memory/stats");

    // A field the server did not send is UNKNOWN, not zero. Rendering it as
    // "0" is the same class of lie as an empty search claiming emptiness:
    // "Associations: 0" reads as "this memory has learned nothing", which is
    // a strong and possibly false statement about the product itself.
    const num = (v: unknown) => (typeof v === "number" ? String(v) : "unknown");
    const dec = (v: unknown) => (typeof v === "number" ? v.toFixed(2) : "unknown");

    // THE surface two other tool descriptions send the reader to "to confirm
    // the exact domain name before a delete" — so it has to be able to answer
    // that, and until now it could not.
    //
    // Quoting was tried, then withdrawn as a fix that wasn't one: safeInline
    // collapses and trims whitespace BEFORE the quotes go on, so " engineering"
    // and "engineering" printed identically and the list read like a tool bug.
    // The conclusion drawn then — "revealing whitespace needs escaping rather
    // than quoting" — was right; this is that escaping. Each name is a JSON
    // string literal, so a leading space, a no-break space, a newline and a
    // zero-width character are all visible, Cyrillic stays Cyrillic, and two
    // different names can no longer print as one. Assembly lives in
    // src/names.ts, where it is unit-tested against those exact inputs.
    const domains = formatDomainList(r?.domains);

    const text = [
      `Memories: ${num(r?.total_atoms)} (${num(r?.episodes)} episodes, ${num(r?.prototypes)} prototypes)`,
      `Associations: ${num(r?.hebbian_edges)} Hebbian edges — links the store learned between memories that get used together`,
      `Domains: ${domains}`,
      `Avg quality: valence ${dec(r?.avg_valence)} (how well recalls turned out, -1..1), importance ${dec(r?.avg_importance)} (0..1)`,
      "",
      "Counts cover your own domains. Shared rooms are separate stores and are not included — see memory_list_rooms.",
    ].join("\n");

    return {
      content: [
        {
          type: "text" as const,
          // Array.isArray, not `?? []`: `domains` is typed as a string[] but
          // arrives over the wire, and spreading a non-iterable object would
          // throw here — turning a malformed payload into a dead tool instead
          // of the "none reported" it degrades to two lines up.
          text: withDomainEscapeLegend(
            text,
            ...(Array.isArray(r?.domains) ? r.domains : []),
          ),
        },
      ],
    };
  },
);

// --- Tool: memory_delete ---

server.registerTool(
  "memory_delete",
  {
    description:
      "Permanently delete ONE memory by its atom_id — irreversible, the memory is gone for good. Use it to keep the memory trustworthy: prune a memory that is obsolete, superseded by a newer decision, or that you stored wrongly — and whenever the user asks to forget something. Get the atom_id from a memory_read result. Reaches your own domains only: memories in shared rooms CANNOT be deleted through this tool. To clear an entire topic at once, use memory_delete_domain instead.",
    inputSchema: {
      atom_id: z
        .string()
        .min(1)
        .describe(
          "The atom_id of the memory to delete (from memory_read results — each item has an id)",
        ),
    },
    annotations: {
      title: "Delete a Memory",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ atom_id }) => {
    // Core API returns { deleted: <count>, atom_id }, so today a falsy
    // `deleted` means the count came back 0 — nothing in the caller's own store
    // carried that id.
    //
    // The check below is `!r?.deleted`, which is falsy-not-zero: a MISSING
    // field lands in the same branch as a real 0. `apiFetch` turns a 204 or an
    // empty body into `{}` (see its own note that FastAPI DELETE handlers may
    // switch to 204), so under that response a successful delete would report
    // "nothing was deleted". Unknown rendered as zero, then zero rendered as an
    // absence claim — the same family as `updated_count ?? 0` in
    // memory_feedback and `deleted ?? 0` in memory_delete_domain. Left as it
    // stands and listed in CHANGELOG's "Known and NOT fixed here"; it is a
    // behaviour fix, not a wording one.
    const r = await apiFetch<{ deleted?: number; atom_id?: string }>(
      `/memory/atoms/${encodeURIComponent(atom_id)}`,
      { method: "DELETE" },
    );

    if (!r?.deleted) {
      // NOT "no such memory". Deletion is scoped to the caller's OWN store —
      // core has no room-scoped delete at all — so a room atom's id lands here
      // even though the memory plainly exists. This release made room ids MORE
      // visible in read results, so an agent is now MORE likely to bring one
      // here, ask to forget it, and be told it never existed while it stays
      // (review, 2026-08-08). Every other empty branch in this file learned to
      // state its boundary; the destructive one has to as well.
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Nothing was deleted: no memory with id ${atom_id} in your own domains. ` +
              `Note that memories in shared rooms CANNOT be deleted through this tool — ` +
              `if that id came from a room, it still exists and is untouched.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Deleted memory ${atom_id}.`,
        },
      ],
    };
  },
);

// --- Tool: memory_delete_domain ---

server.registerTool(
  "memory_delete_domain",
  {
    description:
      "Permanently delete EVERY memory in one domain — irreversible, and far more sweeping than memory_delete. This is a bulk wipe: run it only when the user asks for it (e.g. 'forget everything about project X') or has explicitly confirmed a wipe you proposed — never on your own judgment alone. First run memory_stats to confirm the exact domain name, then pass it together with confirm=true (a deliberate safety interlock). Names match byte-for-byte, including case, and shared rooms cannot be wiped through this tool. For a single wrong or stale memory, memory_delete is the right tool.",
    inputSchema: {
      domain: z
        .string()
        .min(1)
        .max(200)
        .describe(
          "The domain namespace to wipe (e.g., 'project:old', 'experiments-2025'). Must match exactly.",
        ),
      confirm: z
        .literal(true)
        .describe(
          "Must be exactly true to proceed. Acts as a safety interlock against accidental invocation.",
        ),
    },
    annotations: {
      title: "Delete an Entire Memory Domain",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  // The `confirm: z.literal(true)` in the input schema is the safety
  // interlock — Zod rejects any call without confirm === true before it
  // reaches this handler, so no runtime re-check is needed here.
  async ({ domain }) => {
    const r = await apiFetch<{ deleted?: number; domain?: string }>(
      `/memory/domain/${encodeURIComponent(domain)}`,
      { method: "DELETE" },
    );

    // `?? 0` again: a missing `deleted` field becomes 0 and then becomes the
    // "NOTHING was deleted" claim below. Core sends the count, so this is not
    // reachable through core today — recorded with the other two in CHANGELOG's
    // "Known and NOT fixed here".
    const count = r?.deleted ?? 0;
    // The name of a store on a DESTRUCTIVE confirmation, so it is printed
    // exactly or not at all. safeInline named a different store than the one
    // acted on: wiping `" project x"` confirmed `"project x"`, and the very next
    // clause tells the reader that names match byte-for-byte. When the name
    // cannot be reproduced the sentences fall back to naming nothing, which
    // still leaves them true.
    //
    // NOT called `wiped`, which is what it was: on the zero branch nothing was
    // wiped, and the value is whatever the server echoed — core echoes the path
    // parameter back, so it equals what we sent, but a server that echoed
    // something else would have this handler name a store the caller never
    // passed, one clause before telling them names match byte-for-byte. The
    // fallback to `domain` is the value that actually went over the wire.
    const reportedDomain = r?.domain ?? domain;
    const reportedName = domainPhrase(reportedDomain, "the domain you passed");

    // Zero is NOT a successful wipe, and this line used to read like one.
    // Core echoes back the caller's own string, so "Deleted 0 memories from
    // domain 'Project X'" implies a domain that existed and is now empty. The
    // casing trap runs in this direction too: the user says "forget everything
    // about project X", the agent passes "Project X", gets a success-shaped
    // line, reports done — and the atoms live on under "project x" (review,
    // 2026-08-08). This release built the diagnosis for exactly that and had
    // applied it only to reads.
    if (count === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: withDomainEscapeLegend(
              `NOTHING was deleted — no memories matched domain ${reportedName} in your own ` +
                `store. Names match byte-for-byte, so check the spelling and case against ` +
                `memory_stats before reporting this as done. Shared rooms cannot be wiped ` +
                `through this tool at all.`,
              reportedDomain,
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: withDomainEscapeLegend(
            `Deleted ${count} ${count === 1 ? "memory" : "memories"} from domain ${reportedName}.`,
            reportedDomain,
          ),
        },
      ],
    };
  },
);

// --- Tool: memory_create_room ---

server.registerTool(
  "memory_create_room",
  {
    description:
      "Create a SHARED memory room — a space you and OTHER people's assistants can both read and write, across Claude/ChatGPT/Cursor. Use when the user wants to share context or collaborate with someone else (e.g. 'make a room for me and Olya'). Returns the room's address; pass that address as the `domain` on memory_write/memory_read to use it. To bring someone in, call memory_invite_to_room next.",
    inputSchema: {
      name: z
        .string()
        .min(1)
        .max(200)
        .describe(
          "Room name, unique within your account (e.g. 'me-and-olya').",
        ),
      description: z
        .string()
        .max(2000)
        .optional()
        .describe("Optional description of the room."),
    },
    annotations: {
      title: "Create shared room",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ name, description }) => {
    const r = await apiFetch<{
      room_id?: string;
      address?: string;
      name?: string;
    }>("/memory/rooms", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
    // The name is echoed back to the caller who CHOSE it, so it is printed
    // exactly (src/names.ts): safeInline turned `memory_create_room({name:
    // "проект"})` into `Created shared room ""` — an echo claiming the caller
    // named their room the empty string.
    const rawName = r?.name ?? name;
    const roomName = roomNamePhrase(rawName);
    const address = safeInline(r?.address);
    const roomId = safeInline(r?.room_id);
    // If core returned no usable id (empty body / sanitized away), don't print
    // broken `domain=""` guidance — say so instead (Copilot).
    const text = address
      ? `Created shared room ${roomName}. Address: ${address}\n` +
        `Use it now: pass domain="${address}" on memory_write / memory_read.\n` +
        (roomId
          ? `To add someone: call memory_invite_to_room with room_id="${roomId}".`
          : "")
      : `Room ${roomName} was created but the server did not return a usable address — ` +
        `retry, or check that your API key is set.`;
    return {
      content: [
        {
          type: "text" as const,
          text: capResult(withDomainEscapeLegend(text, rawName)),
        },
      ],
    };
  },
);

// --- Tool: memory_invite_to_room ---

server.registerTool(
  "memory_invite_to_room",
  {
    description:
      "Mint a one-time invite for a room you own and get a ready-to-forward message. The user sends that message to the person they want to add (any messenger); the recipient opens the link or tells THEIR assistant the code to join. Use after memory_create_room, or whenever the user says 'invite <someone>' to an existing room.",
    inputSchema: {
      room_id: z
        .string()
        .min(1)
        .max(100)
        .describe("The room's id (room_...), from memory_create_room."),
      scope: z
        .enum(["read", "read_write"])
        .optional()
        .describe(
          "Role the invitee gets — 'read' or 'read_write' (default read_write).",
        ),
      expires_in_days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe("Days until the invite expires (default 7)."),
    },
    annotations: {
      title: "Invite to room",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ room_id, scope, expires_in_days }) => {
    const r = await apiFetch<{
      share_message?: string;
      join_url?: string;
      code?: string;
    }>(`/memory/rooms/${encodeURIComponent(room_id)}/invites`, {
      method: "POST",
      body: JSON.stringify({ scope, expires_in_days }),
    });
    return {
      content: [
        {
          type: "text" as const,
          // Shown to the room OWNER (who minted it), not a foreign principal, so
          // the core-generated share_message is fine as-is; capResult only bounds
          // its length for the Connectors-Directory 25K cap.
          text: capResult(
            `Invite ready. Forward this message to the person you're inviting:\n\n` +
              `${r?.share_message ?? r?.join_url ?? "(no message returned)"}`,
          ),
        },
      ],
    };
  },
);

// --- Tool: memory_join_room ---

server.registerTool(
  "memory_join_room",
  {
    description:
      "Join a shared memory room using an invite code (starts with 'mnvr_'). Use when the user pastes an invite code or says something like 'join room with code ...'. After joining, use the returned address as the `domain` on memory_write/memory_read to read and write the shared room.",
    inputSchema: {
      code: z.string().min(1).max(200).describe("The invite code (mnvr_...)."),
    },
    annotations: {
      title: "Join room",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ code }) => {
    const r = await apiFetch<{
      address?: string;
      name?: string;
      scope?: string;
      already_member?: boolean;
    }>("/memory/rooms/join", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    // The room name is OWNER-chosen and rendered into the JOINER's LLM context
    // (CN-032) — and it is printed EXACTLY (src/names.ts): the literal is one
    // line with quotes and invisibles escaped, so it cannot forge an
    // instruction block, and "Zoë" stops being quoted as "Zo" in a sentence
    // that presents it as the name. `scope` stays sanitised: server-shaped
    // enum, display-only.
    const roomName = roomNamePhrase(r?.name);
    const scope = safeInline(r?.scope) || "member";
    const address = safeInline(r?.address);
    const prefix = r?.already_member
      ? `You're already a member of ${roomName}.`
      : `Joined ${roomName} (${scope}).`;
    // Don't print broken `domain=""` guidance if no address came back (Copilot).
    const usage = address
      ? `Use it: pass domain="${address}" on memory_write / memory_read to read and write the shared room.`
      : `The server did not return a room address — retry, or check that your API key is set.`;
    return {
      content: [
        {
          type: "text" as const,
          text: capResult(withDomainEscapeLegend(`${prefix}\n${usage}`, r?.name)),
        },
      ],
    };
  },
);

// --- Tool: memory_list_rooms ---

server.registerTool(
  "memory_list_rooms",
  {
    description:
      "List the shared memory rooms you can use — the ones you OWN plus the ones you've JOINED — each with the address to pass as `domain` on memory_write / memory_read. Use this to RE-FIND a room in a new session (e.g. 'what rooms do I have?', 'resume the room with Olya') instead of having to create or re-join it.",
    inputSchema: {},
    annotations: {
      title: "List rooms",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    // The same classifier the scope notes use, for the same reason: this handler
    // did `Array.isArray(rooms) ? rooms : []` and then asserted "You have no
    // shared rooms yet" — a claim about the account derived from a body it could
    // not read. It is the third consumer of this payload and the third place the
    // substitution was made; all three now go through one function that maps an
    // unreadable body to `unknown`, never to `none`.
    const rooms = classifyRooms(await apiFetch<unknown>("/memory/rooms"), safeInline);
    if (rooms.state === "unknown") {
      return {
        content: [
          {
            type: "text" as const,
            text:
              "The room list came back in a shape this client does not recognise — so this " +
              "is not a list of your rooms, and it is not evidence that you have none. Retry; " +
              "if it persists, the memory service is answering this call in a shape this " +
              "client cannot read.",
          },
        ],
      };
    }
    if (rooms.state === "none") {
      return {
        content: [
          {
            type: "text" as const,
            text:
              "You have no shared rooms yet. Create one with memory_create_room, " +
              "or join one with memory_join_room using an invite code.",
          },
        ],
      };
    }
    // ARCHIVED ROOMS ARE LISTED HERE, unlike in the scope note — this tool's job
    // is the inventory, and the `[archived]` tag says which ones cannot be read.
    const list = rooms.rooms;
    // Room name is OWNER-chosen — printed EXACTLY (src/names.ts), like every
    // other room-name surface as of 0.8.1: the sanitiser listed "проект" and
    // "план" as two "(unnamed room)" entries and quoted "Zoë" as "Zo".
    // address/role/scope are server-shaped and keep the defensive sanitiser.
    const lines = list.map((r) => {
      const name = roomNamePhrase(r?.name);
      const roomId = safeInline(r?.room_id);
      // Always surface the canonical address: fall back to xroom:<room_id> when the server
      // omits `address`, so the domain guidance this tool promises is never silently dropped.
      const address = safeInline(r?.address) || (roomId ? `xroom:${roomId}` : "");
      const role = safeInline(r?.role);
      const scope = safeInline(r?.scope);
      // No "use domain=..." on an archived room: core refuses EVERY read of one
      // with a 403, for owner and member alike (see the archived-only note in
      // src/scope.ts), so that clause was an instruction to make a call that
      // cannot succeed. The address stays visible — it is the room's identity —
      // but the line says what a read against it will do.
      const tail = r?.archived
        ? address
          ? ` [archived] — address ${address}, but every read is refused while it is archived`
          : ` [archived] — every read is refused while it is archived`
        : address
          ? ` — use domain="${address}"`
          : "";
      return `- ${name} (${role}${scope ? `, ${scope}` : ""})${tail}`;
    });
    const text = `Your shared rooms (${list.length}):\n${lines.join("\n")}`;
    return {
      content: [
        {
          type: "text" as const,
          text: capResult(
            withDomainEscapeLegend(text, ...list.map((r) => r?.name)),
            "The room list was truncated — some rooms are not shown.",
          ),
        },
      ],
    };
  },
);

// --- Tool: vault_list ---

server.registerTool(
  "vault_list",
  {
    description:
      "List the secrets stored in your Mnemoverse Vault — by ALIAS and purpose only; the secret VALUE is never returned or shown to you. Use this to DISCOVER which secret to use (e.g. the user says 'use my GitHub token' — find its alias here) before a tool that consumes it. Only YOUR account's secrets are listed.",
    inputSchema: {},
    annotations: {
      title: "List vault secrets",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const r = await apiFetch<{
      secrets?: Array<{
        alias?: string;
        context?: string;
        created_at?: string;
        concepts?: string[];
      }>;
    }>("/vault/secrets");
    const list = Array.isArray(r?.secrets) ? r.secrets : [];
    if (list.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No secrets are stored in your Vault yet.",
          },
        ],
      };
    }
    const lines = list.map((s) => {
      const alias = safeInline(s?.alias) || "(no alias)";
      const context = safeInline(s?.context);
      return context ? `- ${alias} — ${context}` : `- ${alias}`;
    });
    const text =
      `Your Vault secrets (${list.length}) — alias and purpose only, never the value:\n` +
      lines.join("\n");
    return {
      content: [
        {
          type: "text" as const,
          text: capResult(text, "The secret list was truncated — some secrets are not shown."),
        },
      ],
    };
  },
);

// --- Start ---

/**
 * Opening the stdio transport at import time is what made every user-visible
 * sentence in this file untestable: a test that imports this module to reach a
 * handler instead starts a server on the test runner's stdin/stdout. So the copy
 * was guarded by regexes over this source text — and three review rounds each
 * found false sentences a behavioural test would have caught immediately, twice
 * in a guard that turned out to be theatre.
 *
 * The seam is one boolean, and its DEFAULT is today's behaviour.
 *
 * WHY AN ENV OPT-OUT AND NOT `import.meta.url === process.argv[1]`. That
 * comparison is the usual "am I the entry point?" idiom and it is the wrong tool
 * here, because this package ships as an npm `bin`. Under `npx` — the canonical
 * install, pinned in src/configs/source.json and in every README snippet — the
 * thing on argv[1] is the generated shim, not this file; on Windows it is a
 * `.cmd`/`.ps1` wrapper, and even the POSIX shim is a symlink whose realpath
 * resolution differs between package managers. Every one of those makes the
 * comparison FALSE for a real user, and a false comparison there does not throw:
 * the process would exit 0 having started no server, and the client would report
 * a silent connection failure with nothing in the logs. That is a worse defect
 * than the one being fixed. The env var inverts the risk — it can only misfire
 * for something that deliberately sets it, and no released version reads it, so
 * no existing config can carry it.
 *
 * The check is `=== "1"`, deliberately narrow rather than truthy: the failure
 * mode of a wide check is a startup that silently does nothing, so an
 * unrecognised value must fall through to starting the server.
 *
 * BYTE-IDENTICAL CLI BEHAVIOUR: with the variable unset (or set to anything
 * other than "1"), `main()` is called exactly as before, with the same catch,
 * the same message and the same exit code. The only other change to this module
 * is the `export` on `server`, which is inert when the file is run as a program.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.env.MNEMOVERSE_MCP_NO_AUTOSTART !== "1") {
  main().catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
}
