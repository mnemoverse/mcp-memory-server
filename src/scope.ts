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
 * Archived rooms are excluded: they are not somewhere new work arrives, so
 * naming them would pad the note with dead ends.
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
  if (live.length === 0) return "";

  const shown = live.slice(0, MAX_LISTED).map((r) => {
    const name = sanitize(r?.name) || "(unnamed room)";
    const roomId = sanitize(r?.room_id);
    const address = sanitize(r?.address) || (roomId ? `xroom:${roomId}` : "");
    return address ? `  - "${name}" — domain="${address}"` : `  - "${name}"`;
  });
  const rest = live.length - shown.length;
  const more = rest > 0 ? `\n  …and ${rest} more (memory_list_rooms)` : "";

  return (
    `\n\nScope: your own domains only. Shared rooms are separate stores and are NOT ` +
    `included in an unscoped read — ${live.length} room${live.length === 1 ? "" : "s"} ` +
    `went unsearched:\n${shown.join("\n")}${more}\n` +
    `Re-run with domain set to one of these to read it.`
  );
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
