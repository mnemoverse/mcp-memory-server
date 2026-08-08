/**
 * Result-rendering helpers for memory_read and memory_list_recent.
 *
 * Kept out of index.ts (same move as teaching.ts) so tests can pin the
 * rendered contract: since the #404 temporal work, every item line
 * carries its id and created_at date WHENEVER the server provides them
 * (memory_feedback / memory_delete are uncallable without ids — the tool
 * description always promised them, the old render never delivered any;
 * a reader cannot reason about recency it cannot see). Legacy response
 * shapes without atom_id/created_at degrade gracefully: those parts of
 * the line are simply omitted.
 */

import {
  MAX_DOMAIN_TAG_LITERAL,
  exactLiteral,
  withDomainEscapeLegend,
} from "./names.js";

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
 * Sanitize a string for inline interpolation into tool output (CN-032:
 * hostile connectors choose their own agent_name; a room name is chosen by its
 * OWNER and shown to a JOINER's model). The single implementation, imported by
 * index.ts and injected into src/scope.ts.
 *
 * NOT for anything the reader must reproduce. This is lossy and non-injective
 * by design — non-ASCII becomes spaces, whitespace is collapsed and trimmed,
 * the tail is cut — so two distinct values can come out as one string and a
 * padded value comes out as its clean twin. For a domain name, an id, or
 * anything else that gets compared or sent back, use src/names.ts
 * (`exactLiteral`), which prints exactly or refuses to print.
 */
export function safeInline(s: string | undefined | null, cap = 200): string {
  return (s ?? "")
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
 */
export function formatDateTag(createdAt?: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  const iso = d.toISOString();
  return ` · ${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

/**
 * One memory_read result line:
 * `N. content (concepts) @domain [by X] · 2026-08-01 21:04Z\n   id: <uuid>`
 *
 * The id sits on its own indented line: full-width (feedback/delete need
 * the EXACT id, truncation would break them) without crowding the content
 * line a model actually reads.
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

/** Full feed page: items newest-first + how to continue / that it's over. */
export function formatRecentPage(items: RecentItem[], nextCursor?: string | null): string {
  const lines = items.map((it, i) => formatRecentItem(it, i));
  // Defense-in-depth (CN-032 posture): the cursor is server-supplied and
  // interpolated into instructional text — only echo it when it matches the
  // opaque urlsafe-base64 shape ours always has.
  const cursorOk = nextCursor != null && /^[A-Za-z0-9_=-]{1,512}$/.test(nextCursor);
  const tail = cursorOk
    ? `\n\nMore older entries exist — pass cursor: ${nextCursor}`
    : `\n\n(end of feed — nothing older)`;
  // The escape legend belongs to the PAGE, not to each tag: a feed can carry
  // twenty lines and the explanation is only useful once. Absent entirely
  // unless some domain on this page actually needed an escape.
  return withDomainEscapeLegend(
    lines.join("\n\n") + tail,
    ...items.map((it) => it?.domain),
  );
}
