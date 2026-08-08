/**
 * Search-scope honesty — the note that turns "nothing found" from an assertion
 * about the WORLD into a statement about where we actually looked.
 *
 * Why this module exists (incident 2026-08-07). Two agents lost a working day
 * to the same silent failure: a message was written into a shared room, and an
 * unscoped `memory_list_recent` answered "Nothing new since your watermark."
 * The write was fine, the index was fine, and the read was fine — an UNSCOPED
 * read simply never covers rooms.
 *
 * That is not a filter oversight; it is how the store is built. A room is a
 * separate storage tenant (core ADR-019): with no `domain`, the request runs
 * against the caller's OWN org, and room atoms live in the room's org. So the
 * unscoped feed cannot see them and never could.
 *
 * The defect is therefore not the scoping — it is the WORDING. "Nothing new"
 * is a claim about absence, and absence is only knowable within the scope you
 * searched. Every empty result from an unscoped read must say which rooms it
 * did not look in, and how to look in them.
 *
 * Kept out of index.ts so the copy can be unit-tested without booting the
 * stdio transport, matching render.ts and teaching.ts.
 */

/**
 * "Nothing new since your watermark" is also what you get for a watermark in
 * the FUTURE — a mixed-up timezone or a bad relative-date calculation reads
 * exactly like a clean bill of health (dogfood, 2026-08-07). If the caller's
 * `since` is ahead of now, say so and show the current time; that is the whole
 * diagnosis, and the caller cannot reach it from "nothing new".
 *
 * `nowMs` is injected so the note is testable without freezing the clock.
 */
export function futureSinceNote(since: string | undefined, nowMs: number): string {
  if (!since) return "";
  const t = parseAsUtc(since);
  if (t === null || t <= nowMs) return "";
  return (
    `\n\nNote: that watermark is in the FUTURE — nothing has been written after it YET, ` +
    `so an empty result here says nothing about whether you are caught up. ` +
    `This client's clock reads ${new Date(nowMs).toISOString().slice(0, 16)}Z ` +
    `(the server's may differ slightly). Check the watermark you passed — a timezone ` +
    `slip is the usual cause.`
  );
}

/**
 * Parse an ISO-8601 instant the way the SERVER does: an offset-less value is
 * UTC, not local time.
 *
 * `Date.parse("2026-08-08T13:00:00")` returns LOCAL midnight-relative millis,
 * while both tool descriptions here and core's schema say "naive = UTC". The
 * mismatch made this note lie in both directions (review, 2026-08-08): west of
 * UTC a perfectly sane watermark was declared to be in the future and every
 * clause of the note was false; east of UTC a genuinely future watermark was
 * shifted into the past and the note stayed silent, missing the one case it
 * exists for.
 *
 * Date-only values ("2026-08-08") are already parsed as UTC by spec, so only
 * date-TIME values without an offset need the Z.
 */
function parseAsUtc(iso: string): number | null {
  const s = iso.trim();
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const isDateTime = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s);
  const t = Date.parse(isDateTime && !hasOffset ? `${s.replace(" ", "T")}Z` : s);
  return Number.isNaN(t) ? null : t;
}

/**
 * A scoped read that finds nothing looks identical whether the domain is empty
 * or MISSPELLED — and a casing slip silently creates a second, permanent shard
 * of what the writer believes is one bucket (dogfood, 2026-08-07). When we can
 * name a domain that differs only in case, or one that is obviously the
 * intended neighbour, saying so is the difference between a dead end and a fix.
 *
 * Deliberately conservative: only an exact case-insensitive match or a clear
 * prefix relationship counts. A fuzzy guess that names the wrong domain would
 * be worse than silence, because the reader would trust it.
 */
export function nearestDomainNote(
  domain: string,
  knownDomains: readonly string[],
  sanitize: (s: string | undefined | null) => string,
): string {
  const wanted = domain.trim();
  if (!wanted) return "";
  const lower = wanted.toLowerCase();

  // Match on the RAW values, render only sanitized ones. A domain name is
  // caller-chosen and, for the twin, comes back from storage — both can carry
  // newlines or instruction-shaped text, and this note lands in a model's
  // context. Same treatment room names already get (CodeRabbit, #65).
  const safeWanted = sanitize(wanted);

  // STAY SILENT when sanitising CHANGES the name. safeInline's charset uses
  // ASCII \w, so a Cyrillic domain — ordinary in this workspace — renders as
  // something else entirely: "проект:acme" came out as ":acme", and the note
  // then stated facts about a name that exists nowhere. Two different Cyrillic
  // domains could even render identically and be declared different stores
  // (review, 2026-08-08). No note beats a note about the wrong name.
  if (safeWanted !== wanted) return "";

  const caseTwin = knownDomains.find(
    (d) => d !== wanted && d.toLowerCase() === lower && sanitize(d) === d,
  );
  if (caseTwin) {
    return (
      `\n\nDomain names are matched exactly, including case: "${safeWanted}" is not ` +
      `the same store as "${caseTwin}", which does exist. Did you mean that one?`
    );
  }

  // NO "closest match" any more. It named the FIRST element of an unordered
  // `SELECT DISTINCT domain` having any prefix relation in either direction —
  // so it was not a nearest neighbour, it could differ between two identical
  // calls, and a one-character domain became the confidently-named "closest"
  // match for every name starting with that letter. This module's own contract
  // says a wrong guess is worse than silence, because the reader trusts it.
  //
  // The absence claim is narrowed too: names match byte-for-byte, so a store
  // whose name carries a leading space or a zero-width character is real but
  // unreachable from a clean spelling. Hence "no store with that exact name",
  // never "no such store".
  return (
    `\n\nNo store has that exact name. Names match byte-for-byte, so a stray space ` +
    `or an invisible character makes a different store — memory_stats quotes each ` +
    `name so you can see them.`
  );
}

/** The subset of a room record this note needs. */
export interface RoomSummary {
  room_id?: string;
  name?: string;
  address?: string;
  archived?: boolean;
}

/** How many rooms to name before collapsing into a count. */
const MAX_LISTED = 5;

/**
 * The note appended to an empty UNSCOPED result.
 *
 * Returns "" when there is genuinely nothing to disclose — no rooms means
 * nothing was missed, and a caveat about an empty set is noise that trains
 * readers to skip caveats.
 *
 * Archived rooms are not LISTED — no new work arrives there — but they are
 * COUNTED in a trailing clause, because omitting them entirely understated the
 * answer to the question the reader is actually asking. An owned archived room
 * still holds content, still appears in memory_list_rooms, and reads of it are
 * a hard 403 — so it is unreachable from every read path. An agent hunting a
 * lost memory used to see "nothing found" plus "2 rooms went unsearched", both
 * empty, and conclude the memory did not exist while it sat in the third,
 * archived one (review, 2026-08-08).
 *
 * `sanitize` is injected (render.ts's safeInline) because a room name is
 * chosen by its OWNER and surfaced to a DIFFERENT principal's model — the
 * same anti-injection treatment every other room-name render gets.
 */
export function formatUnsearchedRoomsNote(
  rooms: readonly RoomSummary[],
  sanitize: (s: string | undefined | null) => string,
): string {
  const live = rooms.filter((r) => !r?.archived);
  const archived = rooms.length - live.length;
  if (live.length === 0 && archived === 0) return "";

  const shown = live.slice(0, MAX_LISTED).map((r) => {
    const name = sanitize(r?.name) || "(unnamed room)";
    const roomId = sanitize(r?.room_id);
    const address = sanitize(r?.address) || (roomId ? `xroom:${roomId}` : "");
    return address ? `  - "${name}" — domain="${address}"` : `  - "${name}"`;
  });
  const rest = live.length - shown.length;
  const more = rest > 0 ? `\n  …and ${rest} more (memory_list_rooms)` : "";
  const archivedClause =
    archived > 0
      ? `\nPlus ${archived} archived room${archived === 1 ? "" : "s"}, which cannot be ` +
        `read at all — content in there is unreachable until it is unarchived.`
      : "";

  const head =
    live.length > 0
      ? `Shared rooms are separate stores and are NOT included in an unscoped read — ` +
        `${live.length} room${live.length === 1 ? "" : "s"} went unsearched:\n${shown.join("\n")}${more}\n` +
        `Re-run with domain set to one of these to read it.`
      : `Shared rooms are separate stores and are NOT included in an unscoped read.`;

  return `\n\nScope: your own domains only. ${head}${archivedClause}`;
}

/**
 * Fetch the caller's rooms and build the note. Never throws.
 *
 * FAILS LOUD, NOT SILENT: if the room list can't be fetched we still state the
 * boundary, just without the names. Dropping the caveat because the probe
 * failed would put us straight back into the behaviour this module exists to
 * end — the reader would again be told "nothing" and believe it covered
 * everything.
 */
export async function unsearchedRoomsNote(
  fetchRooms: () => Promise<unknown>,
  sanitize: (s: string | undefined | null) => string,
): Promise<string> {
  try {
    const rooms = await fetchRooms();
    return formatUnsearchedRoomsNote(
      Array.isArray(rooms) ? (rooms as RoomSummary[]) : [],
      sanitize,
    );
  } catch {
    return (
      `\n\nScope: your own domains only. Shared rooms are separate stores and are NOT ` +
      `included in an unscoped read; the room list could not be fetched just now, so ` +
      `check memory_list_rooms and re-run with domain set.`
    );
  }
}
