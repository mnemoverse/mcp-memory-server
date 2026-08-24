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

import { MAX_DOMAIN_TAG_LITERAL, exactLiteral } from "./names.js";
import { parseAsUtc } from "./time.js";

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
 * ` [by X]` / ` [by X · external]` — agent identity only, never the human
 * `principal` (may be an email / PII), even though the response carries it.
 */
export function formatAuthorTag(p?: Provenance | null): string {
  if (!p) return "";
  const raw = p.agent_name || p.agent || p.client_env || "";
  const who = safeInline(raw, 64);
  if (!who) return "";
  return p.is_external ? ` [by ${who} · external]` : ` [by ${who}]`;
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
export function formatRecentPage(items: RecentItem[], nextCursor?: string | null): string {
  const lines = items.map((it, i) => formatRecentItem(it, i));
  // Defense-in-depth (CN-032 posture): the cursor is server-supplied and
  // interpolated into instructional text — only echo it when it matches the
  // opaque urlsafe-base64 shape ours always has. Core mirrors the same regex on
  // its side, so a cursor that fails here is a contract violation, not a value.
  //
  // KNOWN DEFECT, not fixed in 0.8.1 and recorded in the CHANGELOG: this one
  // boolean decides an existence claim about a different thing. `false` means
  // EITHER "the server said there is nothing older" OR "the server said there IS
  // more and I refuse to print the token", and both print `(end of feed —
  // nothing older)`. That is could-not-render spelled exactly like does-not-
  // exist — the collision this release is about, surviving in the one place the
  // fix did not reach. It needs a third branch and therefore a new sentence,
  // which is a behaviour change.
  const cursorOk = nextCursor != null && /^[A-Za-z0-9_=-]{1,512}$/.test(nextCursor);
  const tail = cursorOk
    ? `\n\nMore older entries exist — pass cursor: ${nextCursor}`
    : `\n\n(end of feed — nothing older)`;
  return lines.join("\n\n") + tail;
}
