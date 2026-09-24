/**
 * Result-rendering helpers for memory_read and memory_list_recent.
 *
 * Kept out of index.ts (same move as teaching.ts) so tests can pin the
 * rendered contract: since the #404 temporal work, every item line
 * carries its id and created_at date WHENEVER the server provides them
 * (memory_feedback is uncallable without ids — the tool description always
 * promised them, the old render never delivered any; a reader cannot reason
 * about recency it cannot see). Legacy response
 * shapes without atom_id/created_at degrade gracefully: those parts of
 * the line are simply omitted.
 */

import { MAX_DOMAIN_TAG_LITERAL, exactLiteral, structuredText } from "./names.js";
import { parseAsUtc, utcInstant } from "./time.js";

/** CN-001 server-stamped authorship, as returned nested on read/feed items. */
export type Provenance = {
  principal?: string | null;
  agent?: string | null;
  agent_name?: string | null;
  client_env?: string | null;
  is_external?: boolean | null;
};

export type ReadItem = {
  atom_id?: string;
  content?: string;
  relevance?: number;
  concepts?: string[];
  domain?: string;
  created_at?: string;
  provenance?: Provenance | null;
};

export type RecentItem = {
  atom_id?: string;
  content?: string;
  domain?: string;
  created_at?: string;
  concepts?: string[];
  provenance?: Provenance | null;
};

/**
 * Sanitize a string for inline interpolation into tool output (CN-032: hostile
 * connectors choose their own agent_name). The single implementation, imported
 * by index.ts and injected into src/scope.ts for the machine-shaped room
 * fields (address, room_id — core charset-validates both; this is a defensive
 * second pass).
 *
 * NOT for anything the reader must reproduce. This is lossy and non-injective
 * by design — non-ASCII becomes spaces, whitespace is collapsed and trimmed,
 * the tail is cut — so two distinct values can come out as one string and a
 * padded value comes out as its clean twin. For a domain name, an id, or
 * anything else that gets compared or sent back, use src/names.ts
 * (`exactLiteral`), which prints exactly or refuses to print.
 *
 * NOT for room NAMES either, as of 0.8.1 (`roomNamePhrase`, src/names.ts).
 * They are display-only, but this sanitiser did not make them harmless so much
 * as it made them wrong: "проект" rendered "(unnamed room)", and "Zoë" was
 * quoted as "Zo" — a different name presented as the name. The exact literal
 * is single-line with quotes and invisibles escaped, so it carries the same
 * anti-injection property without the renaming.
 *
 * `s` is `unknown` — like `roomNamePhrase` and `exactLiteral`, and for the same
 * reason. Every call site reads a field off the wire where the response types
 * are aspirational, and this was `(s ?? "").replace(…)`, which throws on
 * anything that is not a string. The SDK turns a thrown Error into the WHOLE
 * tool result, so one numeric `agent_name` on one item of fifty replaced a page
 * of memories with `(s ?? "").replace is not a function` — no `Mnemoverse: `
 * prefix, no diagnosis, nothing to act on. `asRoom` (src/scope.ts) narrowed the
 * room list for exactly this reason and recorded it as "a latent crash fixed";
 * the five remaining call sites (the author tag here, and address / room_id /
 * scope / alias / context in src/index.ts) are closed by the guard below.
 *
 * A non-string sanitises to "" rather than to `String(s)`: this output is
 * interpolated into sentences that are already written to handle a missing
 * value — an absent author tag, "(no alias)", "the server did not return a room
 * address" — and every one of those is true of a field we cannot read, while
 * `"[object Object]"` as an author would not be.
 */
export function safeInline(s: unknown, cap = 200): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/[^\w .@:+/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

/**
 * `agent_name || agent || client_env`, exactly as the wire sent it: no
 * sanitising, no suffix. The single raw value `authorName` and
 * `formatAuthorTag` below BOTH derive from, so the bare structured field and
 * the quoted text tag cannot end up naming two different agents. The same
 * raw value is what src/tools.ts passes to `withDomainEscapeLegend` as an
 * author candidate, so its independent recomputation of `exactLiteral` finds
 * the same literal `formatAuthorTag` printed (I66-3, issue #66).
 *
 * Returns `""`, not `null`/`undefined`, when there is no renderable name at
 * all: an absent provenance, every field empty, or the field that won the
 * `||` chain arriving with the wrong wire type. A numeric `agent_name` is a
 * real shape a hostile or buggy connector sends, not a hypothetical one; see
 * "a non-string where the type promised a string" below, and CN-032's own
 * history with this exact field.
 */
export function rawAuthorName(p?: Provenance | null): string {
  if (!p) return "";
  const raw = p.agent_name || p.agent || p.client_env;
  return typeof raw === "string" ? raw : "";
}

/**
 * "X" / "X · external": agent identity only, never the human `principal`
 * (may be an email / PII), even though the response carries it. Empty string
 * when there is no renderable name.
 *
 * Feeds `structuredContent.author` (via `structuredItem`, below), not the
 * text tag; `formatAuthorTag` now quotes `rawAuthorName`'s value itself
 * (I66-1) rather than building its bracketed text from this one, so the two
 * no longer share a derivation the way the original S4 extraction intended,
 * and instead share `rawAuthorName` as their common raw input.
 *
 * Until owner decision I66-2 (issue #66, 2026-09-23), this ran the raw name
 * through `safeInline`, the same ASCII-only, bracket-stripping sanitiser the
 * text tag used, which erased Cyrillic/CJK/Arabic names from the DATA just
 * as completely as it erased them from the text: a second, previously
 * unreported instance of the bug the issue reports for the tag, found with
 * zero non-Latin fixtures anywhere in this file's history. It now runs
 * through `structuredText` (src/names.ts) instead, the same
 * control/bidi/zero-width-only normalisation `reason` already gets on this
 * surface, so a name survives here whenever it survives on the page.
 *
 * This deliberately drops bracket-stripping on this field: a bare JSON
 * value cannot be "closed early" by a literal `]` or `"` the way a
 * hand-built sentence can (the MCP SDK serialises the field; this code does
 * not concatenate it into one). The property CN-032 actually needs here, a
 * reader must not be shown something that is not there or have text
 * hidden/reordered inside it, is exactly what `structuredText` still strips
 * (control, bidi, zero-width). The `[by "…"]` TEXT tag carries the
 * anti-injection burden for the rendered surface instead, via
 * `exactLiteral`'s quoting.
 */
export function authorName(p?: Provenance | null): string {
  const who = structuredText(rawAuthorName(p), 64);
  if (!who) return "";
  return p?.is_external ? `${who} · external` : who;
}

/**
 * ` [by "X"]` / ` [by "X" · external]`: agent identity only, never the
 * human `principal` (may be an email / PII), even though the response
 * carries it.
 *
 * Quoted as an exact JSON literal (`exactLiteral`, src/names.ts), the same
 * treatment `formatDomainTag` below already gives `@domain`, for EVERY
 * name, including a plain ASCII one like "sigma", not only names that
 * happen to need escaping (owner decision I66-1, issue #66, 2026-09-24:
 * full symmetry with domains, no second unquoted branch). Before this, a
 * Cyrillic, CJK or Arabic `agent_name` sanitised through `safeInline`'s
 * ASCII-only charset to an empty string, and the tag disappeared with no
 * trace, the exact defect `formatDomainTag` was already fixed for in 0.8.1,
 * reached here in a later release (issue #66).
 *
 * Operates on `rawAuthorName`, not `authorName`'s sanitised value: quoting
 * the raw wire name is what lets `exactLiteral` print and escape characters
 * a sanitiser would have dropped, and what lets `withDomainEscapeLegend`'s
 * independent recomputation (src/tools.ts) find the same literal this
 * function printed.
 *
 * `" · external"` sits OUTSIDE the quotes (I66-3): it is a server-added
 * qualifier, not part of the name, so it is not part of what gets escaped
 * and not part of what the escape-legend candidate has to match.
 *
 * The cap is `MAX_DOMAIN_TAG_LITERAL` itself, not a second constant with the
 * same value (I66-4): a name too long to print exactly gets the same
 * disclosed, name-free fallback `formatDomainTag` uses, reworded for "name".
 */
export function formatAuthorTag(p?: Provenance | null): string {
  const raw = rawAuthorName(p);
  if (!raw) return "";
  const exact = exactLiteral(raw, MAX_DOMAIN_TAG_LITERAL);
  const printed = exact ? exact.literal : "(name cannot be printed exactly)";
  return ` [by ${printed}${p?.is_external ? " · external" : ""}]`;
}

/**
 * ` @"domain"` — which store the memory actually came from, printed so it can
 * be re-sent.
 *
 * Absent before 0.8.1, and its absence was a real trap: an unscoped search for
 * a common name returned five different people's "Maria Chen" from five
 * different projects, ranked together, with nothing on the line to tell them
 * apart (dogfood, 2026-08-07). A reader could not answer "is this mine?"
 * without re-querying scoped.
 *
 * The tag went out through `safeInline`, which defeated the one job it has. It
 * is a DISAMBIGUATOR between stores whose names differ by a space or a
 * character set, and the sanitiser erases exactly those differences:
 * `"проект:acme"` and `"план:acme"` both printed `@:acme`, merging the two
 * stores the tag exists to separate. Worse, `" general"` sanitised to `general`
 * and was then SUPPRESSED by the check below, so a memory from a padded store
 * rendered as if it came from the caller's default bucket. Now the value is
 * printed as an exact JSON literal (src/names.ts) and only the literal string
 * `"general"` is suppressed.
 *
 * Still omitted when the server doesn't send a domain, and for the caller's own
 * default bucket — labelling everything `@"general"` would be noise on the
 * common case. When the literal will not fit, the tag says so rather than
 * disappearing: an absent tag means "the default bucket", which would be a
 * false statement about the store.
 */
export function formatDomainTag(domain?: string): string {
  if (!domain || domain === "general") return "";
  const exact = exactLiteral(domain, MAX_DOMAIN_TAG_LITERAL);
  return exact ? ` @${exact.literal}` : ` @(domain cannot be printed exactly)`;
}

/**
 * ` · 2026-08-01 21:04Z` — minute-precision UTC, compact enough for a line
 * tail, precise enough to order a same-day room conversation by eye.
 * Empty for legacy atoms without a timestamp.
 *
 * The `Z` is an ASSERTION, and until now it was made about a number this
 * function had not established. `new Date(createdAt)` reads an offset-less
 * `created_at` as LOCAL time — the reading core's schema and this server's own
 * `since` descriptions both contradict — and `toISOString()` then stamped the
 * local reading with a `Z`. So one stored atom rendered a different clock time
 * in every timezone the client happened to sit in: `2026-08-01T23:30:00` was
 * `23:30Z` in UTC, `14:30Z` in Asia/Tokyo, and `2026-08-02 06:30Z` in
 * America/Los_Angeles — a memory dated to a day it was not written, on the tag
 * a reader uses to order a conversation and to decide what is recent.
 *
 * `parseAsUtc` (src/time.ts) is the same reader src/scope.ts uses for the
 * future-watermark note, which is the point: the convention is now implemented
 * once. It also rejects a non-string, so a `created_at` that arrives as epoch
 * millis degrades to no tag rather than to a date the contract does not
 * promise.
 */
export function formatDateTag(createdAt?: string): string {
  const t = parseAsUtc(createdAt);
  if (t === null) return "";
  const iso = new Date(t).toISOString();
  return ` · ${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

/**
 * One memory_read result line:
 * `N. content (concepts) @"domain" [by X] · 2026-08-01 21:04Z\n   id: <uuid>`
 *
 * The id sits on its own indented line: full-width (feedback needs the
 * EXACT id, truncation would break it) without crowding the content line a
 * model actually reads.
 *
 * NO SCORE, as of 0.8.1 (Eduard's call). The line used to lead with the
 * server's `relevance` rendered as a percentage, and that was wrong twice
 * over:
 *
 *   - It read as confidence and wasn't. The engine's relevance floor
 *     (`min_relevance`, default 0.3) is low enough that a query about
 *     something never stored still returns near-neighbours — dogfooding got a
 *     real person's profile at "73%" for a question about someone fictional,
 *     and month-old notes at "73%" for "what's new". A number that in practice
 *     never bottoms out cannot say "I don't know", but a reader takes it as
 *     though it can. (An earlier draft of this comment claimed there was NO
 *     floor. There is one; it is simply too low to mean anything — review,
 *     2026-08-08.)
 *   - It wasn't a percentage of anything. Positive feedback pushes the score
 *     above 1.0, so reads showed "112%".
 *
 * Rank order still carries the ranking, which is the part that is true. A
 * genuinely dependable signal is worth surfacing and is on the 0.9 list —
 * this is a deliberate removal until there is one, not a decision that
 * scores are useless. `relevance` stays on the type because the server sends
 * it; we simply do not put it in front of a reader yet.
 */
export function formatReadItem(item: ReadItem, index: number): string {
  const content = item?.content ?? "(empty)";
  const concepts =
    Array.isArray(item?.concepts) && item.concepts.length > 0
      ? ` (${item.concepts.join(", ")})`
      : "";
  const head = `${index + 1}. ${content}${concepts}${formatDomainTag(
    item?.domain,
  )}${formatAuthorTag(item?.provenance)}${formatDateTag(item?.created_at)}`;
  return item?.atom_id ? `${head}\n   id: ${item.atom_id}` : head;
}

/**
 * The `structuredContent` twin of {@link formatReadItem} (S4, structured-output
 * plan): the same item, shaped for memory_read's `outputSchema` instead of for
 * a line of text.
 *
 * PRECONDITION, enforced by the caller (src/tools.ts) before this is ever
 * invoked: `item.atom_id`, `item.content` and `item.domain` are all strings.
 * core's MemoryItemSchema sends all three on every item; a response that
 * doesn't is caught by the handler's item guard and answered with
 * `unreadableAnswerReply` before `structuredItem` is reached, so the casts
 * below are a documented precondition, not a runtime assumption made here.
 *
 * `content` is carried EXACTLY, uncapped and unnormalised (decision OD-11,
 * owner, 2026-09-23): unlike the text line, which goes through `capResult`
 * for the 25K-token result-size cap, `structuredContent` is not capped
 * anywhere else in this package either (memory_write's `reason` is the only
 * normalised structured field, and that's control/bidi/zero-width hygiene on
 * a diagnostic string, not a length cap on the memory itself); a client
 * reading structured data reads `content` as the stored memory, and a
 * silently shorter value there would be a different kind of lie than a
 * truncated text block with a notice at the end.
 */
export function structuredItem(item: ReadItem): {
  memory_id: string;
  content: string;
  domain: string;
  created_at?: string;
  author?: string;
} {
  const author = authorName(item.provenance);
  const created = utcInstant(item.created_at);
  return {
    memory_id: item.atom_id as string,
    content: item.content as string,
    domain: item.domain as string,
    // The rule the text already applies through formatDateTag: a value that
    // does not parse as a date is no creation instant, whatever its type, and
    // the field promises a UTC ISO-8601 instant. A value that states its
    // offset is carried as sent; an offset-less one (UTC by contract) is
    // re-emitted as the UTC instant the text renders, since a consumer
    // would otherwise read it as local time (src/time.ts, utcInstant).
    ...(created !== null ? { created_at: created } : {}),
    ...(author ? { author } : {}),
  };
}

/**
 * One memory_list_recent line — a feed entry, not a search hit: no
 * relevance, date leads because the feed is ORDERED by it.
 */
export function formatRecentItem(item: RecentItem, index: number): string {
  const content = item?.content ?? "(empty)";
  const concepts =
    Array.isArray(item?.concepts) && item.concepts.length > 0
      ? ` (${item.concepts.join(", ")})`
      : "";
  const date = formatDateTag(item?.created_at).replace(/^ · /, "");
  const head = `${index + 1}. ${date ? `[${date}] ` : ""}${content}${concepts}${formatDomainTag(
    item?.domain,
  )}${formatAuthorTag(item?.provenance)}`;
  return item?.atom_id ? `${head}\n   id: ${item.atom_id}` : head;
}

/**
 * The shape of a continuation token this client is willing to pass on
 * (CN-032): the server-supplied cursor is opaque, so this is an allowlist
 * of bytes, not a format. One constant for BOTH surfaces, the text (below)
 * and `structuredContent.next_cursor` (src/tools.ts), so they cannot
 * disagree about which token is passable.
 */
export const CURSOR_RE = /^[A-Za-z0-9_=-]{1,512}$/;

/**
 * Full feed page: items newest-first + how to continue / that it's over.
 *
 * Returns the BODY only — no escape legend. The legend belongs to the final
 * answer, and the caller (src/index.ts) appends it AFTER capResult: appended
 * here it sat before the cap, which truncates from the end, so the one
 * sentence explaining that an escape like \u200b is ONE character was the
 * first thing cut from every page long enough to be capped (truth F6,
 * 2026-08-08). Once-per-answer still holds — withDomainEscapeLegend is
 * at-most-once by construction (src/names.ts).
 */
// `nextCursor` is typed loosely on purpose: it is a server-supplied wire
// value, and a number where a string was promised must fail the gate below
// rather than be coerced into it by the regex test (review, 2026-09-23).
export function formatRecentPage(items: RecentItem[], nextCursor?: unknown): string {
  const lines = items.map((it, i) => formatRecentItem(it, i));
  // Defense-in-depth (CN-032 posture): the cursor is server-supplied and
  // interpolated into instructional text — only echo it when it matches the
  // opaque urlsafe-base64 shape ours always has. Core mirrors the same regex on
  // its side, so a cursor that fails here is a contract violation, not a value.
  // The regex itself is UNCHANGED (#67 fixed what gets said when it fails,
  // not what it accepts).
  //
  // Three outcomes, not two (#67, fixed here — was a single `cursorOk`
  // boolean that conflated the last two): no cursor at all means the server
  // says there is nothing older; a cursor that fails the shape check above
  // means the server says there IS more but this client refuses to print an
  // untrusted-shaped token; only a cursor that passes it is an actual
  // continuation. The first two used to share one sentence —
  // could-not-render read exactly like does-not-exist, the same collision
  // 0.8.1 fixed everywhere else and recorded here as "Known and NOT fixed
  // here". The middle case now says entries exist and points at since/until
  // (already on memory_list_recent) as the way to keep going without the
  // token.
  let tail: string;
  if (nextCursor == null) {
    tail = `\n\n(end of feed — nothing older)`;
  } else if (typeof nextCursor === "string" && CURSOR_RE.test(nextCursor)) {
    tail = `\n\nMore older entries exist — pass cursor: ${nextCursor}`;
  } else {
    tail = `\n\nMore entries exist but the continuation token could not be displayed — narrow the window with since/until instead`;
  }
  return lines.join("\n\n") + tail;
}
