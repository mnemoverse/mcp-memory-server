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
 * searched. An empty result from an unscoped read must therefore say what it did
 * not cover: which rooms went unsearched and how to read them, that every room
 * it has is archived and reachable by no path, or that it could not find out.
 * Silence is correct in exactly one case — the caller has no rooms, so nothing
 * was missed — and that case is a distinct state below rather than the falsy
 * spelling of the other three.
 *
 * Kept out of index.ts so the copy can be unit-tested without booting the
 * stdio transport, matching render.ts and teaching.ts.
 */

import {
  domainPhrase,
  exactLiteral,
  roomNamePhrase,
  withDomainEscapeLegend,
} from "./names.js";
// "naive = UTC" is the convention core's schema and both `since` descriptions
// state; it used to be implemented here and nowhere else, which is how the
// renderer came to read the same wire value as local time. One implementation,
// two readers (src/time.ts).
import { parseAsUtc } from "./time.js";

/**
 * How to NAME the scope inside a sentence, so the sentence is true on its own
 * rather than corrected by a paragraph underneath it.
 *
 * "Nothing new since your watermark." was left untouched by the first two
 * passes of this release — the very sentence this module's header names as the
 * lie that cost two agents a day. A note was appended to it instead, so the
 * assembled answer read as two voices: one asserting you were caught up, the
 * next saying that assertion was meaningless. The sibling branch in memory_read
 * had it right all along by naming its filters inside the sentence (review,
 * 2026-08-08).
 *
 * The name inside that sentence then went through safeInline, which made the
 * sentence false in the case that matters most: a read on `" engineering"` — the
 * padded second store this release is about — answered `Nothing in
 * "engineering"`, naming a DIFFERENT store, and a whitespace-only scope printed
 * as `""`, i.e. as no scope at all. It is now the exact literal (src/names.ts),
 * and when a name cannot be reproduced the sentence names nothing rather than
 * naming something else.
 *
 * A room address stays unnamed ("that room") — unchanged, and deliberately: the
 * address is already in the caller's hand, and this sentence has no need to
 * print another principal's display string. Where a room's NAME is printed at
 * all ({@link liveRoomsNote} below, the room tools in index.ts) it goes through
 * `roomNamePhrase` (src/names.ts) — exactly, or declared unprintable — never
 * through the lossy sanitiser, which renamed "проект" to "(unnamed room)".
 *
 * Lives here rather than in index.ts so the sentence can be unit-tested: this is
 * the module about saying where we looked, and index.ts opens a stdio transport
 * on import.
 */
export function scopeLabel(searched: string | undefined): string {
  if (!searched) return "your own domains";
  if (searched.startsWith("xroom:")) return "that room";
  return domainPhrase(searched);
}

/**
 * "Nothing new since your watermark" is also what you get for a watermark in
 * the FUTURE — a mixed-up timezone or a bad relative-date calculation reads
 * exactly like a clean bill of health (dogfood, 2026-08-07). If the caller's
 * `since` is ahead of now, say so and show the current time; that is the whole
 * diagnosis, and the caller cannot reach it from "nothing new".
 *
 * The explaining clause claims a fact about TIME, never about any store. It
 * used to read "nothing has been written after it YET" — an absence claim over
 * EVERY store, printed directly above the scope disclosure admitting a room
 * went unsearched, and premised on an admittedly-approximate client clock
 * (review, 2026-08-08). The window is empty because it asks for entries newer
 * than a moment that has not happened; what any store holds is not this note's
 * to assert.
 *
 * `nowMs` is injected so the note is testable without freezing the clock.
 */
export function futureSinceNote(since: string | undefined, nowMs: number): string {
  if (!since) return "";
  const t = parseAsUtc(since);
  if (t === null || t <= nowMs) return "";
  return (
    `\n\nNote: that watermark is in the FUTURE — it asks for entries newer than a ` +
    `moment that has not happened yet, so an empty result here says nothing about ` +
    `whether you are caught up. ` +
    `This client's clock reads ${new Date(nowMs).toISOString().slice(0, 16)}Z ` +
    `(the server's may differ slightly). Check the watermark you passed — a timezone ` +
    `slip is the usual cause.`
  );
}

/**
 * The disclosure for the {@link NamedScope} arm `no-such-domain`: the caller
 * scoped a read to a domain that is not in `/memory/stats.domains`.
 *
 * WHAT IT DOES, which is not what it was called. Until 0.8.1 this was
 * `nearestDomainNote`, and the name outlived the behaviour twice over: the
 * "nearest"/prefix guess it was named for was deleted as unsound (see the body),
 * and even before that it was never a nearest-neighbour search. What remains is
 * two branches, and neither is a proximity search:
 *
 *   1. an EXACT case-insensitive twin, when one exists in the known list and
 *      both names can be printed reproducibly — the casing slip that silently
 *      forks a namespace, which is the one miss a reader can act on
 *      (dogfood, 2026-08-07);
 *   2. otherwise a NAME-FREE statement that no store OF THE CALLER'S OWN
 *      carries that exact name — bounded to its evidence: `/memory/stats.domains`
 *      covers the caller's own org bucket only, so rooms and other principals'
 *      stores are invisible to it and the sentence may not claim them (review,
 *      2026-08-08; the destructive sibling in index.ts already said "in your
 *      own store"). It is always safe to say and must never go quiet — silence
 *      here is byte-identical to "the store is there, your query merely
 *      missed".
 *
 * Deliberately conservative: only case differs. A whitespace or zero-width twin
 * (`" engineering"` beside `"engineering"`) is NOT diagnosed here — extending the
 * rule is a behaviour decision, and `memory_stats` closes that loop by printing
 * both names exactly. Recorded in CHANGELOG's "Known and NOT fixed here".
 */
export function noSuchDomainNote(
  domain: string,
  knownDomains: readonly string[],
): string {
  // The RAW name, exactly as searched. This used to trim — a second copy of
  // the mistake the caller had already made: a read on " engineering" searched
  // the padded store, then this checked "engineering", matched it, and the one
  // sentence that would have explained the miss was suppressed precisely when a
  // stray space had caused it (review, 2026-08-08).
  const wanted = domain;
  if (!wanted) return "";
  const lower = wanted.toLowerCase();

  // Match on the RAW values, print them through the EXACT renderer.
  //
  // This branch names two stores and invites the reader to act on one of them,
  // so it may only print a name it can reproduce. It used to render through
  // safeInline and guard the branch with `sanitize(x) === x`, which was correct
  // in spirit and expensive in practice: safeInline's charset is ASCII, so
  // every Cyrillic name — ordinary in this workspace — failed the guard and the
  // most useful sentence this module has went silent for a whole alphabet. (An
  // even earlier draft printed through the sanitiser without the guard, and
  // asserted facts about ":acme", a name that exists nowhere.)
  //
  // src/names.ts prints exactly or returns null, so the guard is now the
  // renderer itself and "проект" can be named as "проект". Both sides are
  // checked: naming a twin we cannot reproduce would send the reader to a
  // store whose name we just invented.
  const wantedLiteral = exactLiteral(wanted);
  const twin = wantedLiteral
    ? knownDomains
        .map((d) => ({ name: d, exact: exactLiteral(d) }))
        .find(
          (c) => c.name !== wanted && c.name.toLowerCase() === lower && c.exact !== null,
        )
    : undefined;
  if (wantedLiteral && twin?.exact) {
    return withDomainEscapeLegend(
      `\n\nDomain names are matched exactly, including case: ${wantedLiteral.literal} is not ` +
        `the same store as ${twin.exact.literal}, which does exist. Did you mean that one?`,
      wanted,
      twin.name,
    );
  }

  // NO "closest match" — the branch the old function NAME advertised, deleted
  // rather than repaired. It named the FIRST element of an unordered
  // `SELECT DISTINCT domain` having any prefix relation in either direction —
  // so it was not a nearest neighbour, it could differ between two identical
  // calls, and a one-character domain became the confidently-named "closest"
  // match for every name starting with that letter. This module's own contract
  // says a wrong guess is worse than silence, because the reader trusts it.
  //
  // The absence claim is narrowed twice: names match byte-for-byte, so a store
  // whose name carries a leading space or a zero-width character is real but
  // unreachable from a clean spelling — hence "that exact name", never "no such
  // store". And it is bounded to the caller's OWN stores, because that is all
  // the evidence covers: the known list is `/memory/stats.domains`, which
  // reports one org bucket and sees no room and no other principal's store.
  //
  // NO pointer to memory_stats here, and the reason has CHANGED. A previous
  // draft ended "— memory_stats quotes each name so you can see them", and that
  // was removed because it could not work: the sanitiser collapsed and trimmed
  // whitespace BEFORE the quotes went on, so " engineering" and "engineering"
  // printed identically, and the reader was sent to a check that could not
  // reveal the thing (reviews, 2026-08-08). memory_stats now prints exact
  // literals (src/names.ts), so that objection is gone — the check works.
  // Whether this sentence should carry the pointer again is a copy decision and
  // not part of the renderer change; its absence stays pinned by
  // test/scope.test.ts until someone decides. What must not come back is a
  // pointer to a surface that cannot answer.
  return (
    `\n\nNo store of your own has that exact name. Names match byte-for-byte, so a stray space, ` +
    `a different case, or an invisible character makes a separate store — one that ` +
    `exists and holds its own memories.`
  );
}

/** The subset of a room record anything here reads. Every field is normalised
 *  to a string-or-absent by {@link asRoom} before it is stored. */
export interface RoomSummary {
  room_id?: string;
  name?: string;
  address?: string;
  role?: string;
  scope?: string;
  archived?: boolean;
}

/** How many rooms to name before collapsing into a count. */
const MAX_LISTED = 5;

/* ========================================================================= *
 * KNOWLEDGE, AS A VALUE
 *
 * The defect this section replaces was structural, not verbal. Every probe used
 * to answer with a STRING plus a BOOLEAN — `{ note, roomsFound }` — and the two
 * were computed from different sets: the note filtered archived rooms out, the
 * flag counted them in. An account whose only room was archived therefore got
 * `roomsFound: true` (so the answer promised "That is not the whole picture:")
 * together with `note: ""` (so nothing followed the colon). A dangling colon and
 * no explanation, in the release about not asserting things we cannot know.
 *
 * A boolean cannot carry the state that matters here. "Could not check" and
 * "there are none" are different facts with the same falsy spelling, and every
 * consumer that reduced a note to `note ? … : …` re-derived the wrong one:
 *
 *   - a `/memory/rooms` body that was not an array became an EMPTY room list,
 *     so a contract violation was reported as "you have no rooms";
 *   - the same non-array became "that room is not in your list" — a membership
 *     claim on no evidence;
 *   - a 200 whose `domains` key was missing became an empty domain list, and
 *     then "No store has that exact name", definitively;
 *   - a FAILED room probe left the first-contact greeting reachable, so one
 *     answer could say "nothing has been saved yet" and "the room list could
 *     not be fetched" in the same breath.
 *
 * So a probe now returns a discriminated union whose arms ARE the four things
 * that can be true — live rooms / only archived rooms / no rooms / we could not
 * check — and the disclosure sentence is a FIELD on that value, computed once,
 * at construction, from the same arm it belongs to. The three arms that have
 * something to disclose carry `note`; the one that does not (`none`) does not
 * have the field at all, so "silence" and "a disclosure" are distinguishable by
 * the type system and a colon-carrying head cannot be concatenated with a note
 * that is not there.
 *
 * The scoped side gets the same treatment: {@link NamedScope} separates "the
 * store is there and the query missed" from "there is no store with that exact
 * name" from "we could not look", which the old `""` return value merged into
 * one indistinguishable answer.
 * ========================================================================= */

/**
 * Why a probe could not answer. Both are "we do not know", and they are kept
 * apart because the reader's next move differs: a fetch failure is worth
 * retrying, a shape this client cannot read is not.
 */
export type UncheckedReason = "fetch-failed" | "unrecognised-shape";

/**
 * What we know about the shared rooms an UNSCOPED read did not cover.
 *
 * `note` is the disclosure such a read must append, and it is present on
 * exactly the states that have something to disclose. Other consumers of the
 * same payload (memory_list_rooms) read the facts and ignore it.
 */
export type RoomScope =
  | {
      /** The probe answered, and the caller has no rooms at all. Nothing was
       *  missed, so there is nothing to disclose — hence no `note` field. */
      readonly state: "none";
    }
  | {
      /** At least one room can still be read by passing its address. */
      readonly state: "live";
      /** Every room in the list, live and archived — for memory_list_rooms. */
      readonly rooms: readonly RoomSummary[];
      readonly live: readonly RoomSummary[];
      readonly archived: number;
      readonly note: string;
    }
  | {
      /** Rooms exist and NONE of them can be read: every one is archived. */
      readonly state: "archived-only";
      readonly rooms: readonly RoomSummary[];
      readonly archived: number;
      readonly note: string;
    }
  | {
      /** We could not look. Not evidence in either direction. */
      readonly state: "unknown";
      readonly reason: UncheckedReason;
      readonly note: string;
    };

/** What we know about the ONE store a scoped read named. */
export type NamedScope =
  | {
      /** The scope exists and we are in it, so an empty result is a real miss. */
      readonly state: "present";
      readonly name: string;
    }
  | {
      /** No store with that byte-exact name in the caller's own bucket. */
      readonly state: "no-such-domain";
      readonly name: string;
      readonly note: string;
    }
  | {
      /** That address is not among the rooms this client can see. */
      readonly state: "no-such-room";
      readonly name: string;
      readonly note: string;
    }
  | {
      /** We could not look — so nothing may be concluded about the name. */
      readonly state: "unchecked";
      readonly name: string;
      readonly probed: "domains" | "rooms";
      readonly reason: UncheckedReason;
      readonly note: string;
    };

/**
 * Where a read looked, and what we know about what it therefore did not cover.
 *
 * The two halves are ONE value on purpose. A scoped read must not probe the room
 * list (a room address is checked against the rooms, a domain against the
 * domains — CodeRabbit #65), and an unscoped read must always probe it; as two
 * parameters those invariants were merely unwritten, and both were broken at
 * different points in this release. Here a `named` scope has no room knowledge
 * to be wrong about, and an `own-domains` scope cannot exist without it.
 */
export type ReadScope =
  | { readonly kind: "named"; readonly named: NamedScope }
  | { readonly kind: "own-domains"; readonly rooms: RoomScope };

/** The disclosure for either kind of scope — "" only where the type says there
 *  is genuinely nothing to disclose. */
export function readScopeNote(scope: ReadScope): string {
  const known = scope.kind === "named" ? scope.named : scope.rooms;
  return "note" in known ? known.note : "";
}

/**
 * One room record, with every field narrowed to the type it claims.
 *
 * Returns null when the value cannot be read as a room — which makes the WHOLE
 * payload `unknown` rather than silently contributing a room-shaped blank. A
 * non-boolean `archived` is rejected for the same reason: we would have to guess
 * whether the room is readable, and the guess decides whether the answer says
 * "re-run with domain set" or "nothing in there is reachable".
 *
 * It is also a latent crash fixed: `safeInline` does `(s ?? "").replace(…)`, so
 * a numeric `name` on the wire used to throw inside a renderer.
 */
function asRoom(value: unknown): RoomSummary | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const { archived } = r;
  if (archived !== undefined && archived !== null && typeof archived !== "boolean") {
    return null;
  }
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    room_id: str(r.room_id),
    name: str(r.name),
    address: str(r.address),
    role: str(r.role),
    scope: str(r.scope),
    archived: archived === true,
  };
}

/** The opening clause every unscoped disclosure shares. */
const SCOPE_PREFIX =
  `\n\nScope: your own domains only. Shared rooms are separate stores and are NOT ` +
  `included in an unscoped read`;

/**
 * The rooms an unscoped read did not cover, named so they can be read.
 *
 * Archived rooms are deliberately NOT mentioned here. A counting clause was
 * added and removed inside this release because it only ever rendered for
 * owners — core filters archived rooms out of the member query entirely and
 * hard-codes `archived=false` on joined rows — and because it promised recovery
 * "until it is unarchived" when core has archive with no inverse (reviews,
 * 2026-08-08). Both objections still stand for the MIXED case, which is this
 * one: there is a readable room to point at, and that is what a reader can act
 * on. The case where every room is archived is a different state with a
 * different sentence (see below), because there silence is not an option: it
 * either dangles a colon or lets the answer claim the memory is empty.
 *
 * The NAME is printed exactly (src/names.ts, `roomNamePhrase`) even though it is
 * OWNER-chosen and display-only. This note used to render it through the
 * injected sanitiser, which did not make hostile names harmless so much as it
 * made ordinary names WRONG: two live rooms named "проект" and "план" both
 * printed "(unnamed room)" in the very note that asks the reader to pick one
 * (review, 2026-08-08). The exact literal keeps the anti-injection property —
 * one line, quotes and backslashes and invisibles escaped — and a name that
 * cannot be printed within the cap is declared unprintable rather than altered.
 * The escape legend rides on the note itself, because this note only appears on
 * UNSCOPED answers, where the assembling call sites pass no room names as
 * legend candidates (they have `searched === undefined` in hand, not the list).
 *
 * `sanitize` (render.ts's safeInline) still guards the machine-shaped fields —
 * `address` and `room_id`, which core charset-validates — as a defensive pass,
 * unchanged.
 */
function liveRoomsNote(
  live: readonly RoomSummary[],
  sanitize: (s: string | undefined | null) => string,
): string {
  const listed = live.slice(0, MAX_LISTED);
  const shown = listed.map((r) => {
    const name = roomNamePhrase(r.name);
    const roomId = sanitize(r.room_id);
    const address = sanitize(r.address) || (roomId ? `xroom:${roomId}` : "");
    return address ? `  - ${name} — domain="${address}"` : `  - ${name}`;
  });
  const rest = live.length - shown.length;
  const more = rest > 0 ? `\n  …and ${rest} more (memory_list_rooms)` : "";

  return withDomainEscapeLegend(
    `${SCOPE_PREFIX} — ${live.length} room${live.length === 1 ? "" : "s"} ` +
      `went unsearched:\n${shown.join("\n")}${more}\n` +
      `Re-run with domain set to one of these to read it.`,
    ...listed.map((r) => r.name),
  );
}

/**
 * Every room the caller has is archived — the state that used to be spelled as
 * an empty note plus `roomsFound: true`, i.e. as a promise of a disclosure that
 * had been filtered out one function earlier.
 *
 * What it may claim, and why each clause is safe: an archived room refuses every
 * read for owner and member alike (core resolves the room, then returns 403
 * "Room is archived"); nothing in the client, the data plane or the portal plane
 * clears the flag, so this connector genuinely has no operation that reopens
 * one; and archiving is a soft flag, so the content is still there. The word
 * "unarchive" is avoided on purpose — the withdrawn draft promised recovery
 * "until it is unarchived", and no such operation exists to wait for.
 *
 * The rooms are counted, not named: there is no address that would do the reader
 * any good, and an owner-chosen name is only worth surfacing when it is
 * actionable.
 */
function archivedOnlyNote(archived: number): string {
  const plural = archived === 1 ? "" : "s";
  return (
    `${SCOPE_PREFIX}. You have ${archived} shared room${plural}, ` +
    `${archived === 1 ? "which is" : "all of which are"} archived. An archived room ` +
    `refuses every read, for its owner as much as for a member, and this client has no ` +
    `operation that reopens one. Archiving did not delete what is in there, so a memory ` +
    `you remember writing can be real and still be unreachable from here.`
  );
}

/** We could not look. Says so, and still states the boundary — dropping the
 *  caveat because the probe failed is the silence this module exists to end. */
function uncheckedRoomsNote(reason: UncheckedReason): string {
  const cause =
    reason === "fetch-failed"
      ? "the room list could not be fetched just now"
      : "the room list came back in a shape this client does not recognise";
  return (
    `${SCOPE_PREFIX}; ${cause}, so this answer cannot say whether any room went ` +
    `unsearched. Check memory_list_rooms and re-run with domain set.`
  );
}

/**
 * Classify a `/memory/rooms` body. Total: every payload maps to exactly one
 * state, and a payload that is not a list of rooms maps to `unknown` — never to
 * `none`, which is the substitution that turned a contract violation into "you
 * have no rooms".
 */
export function classifyRooms(
  payload: unknown,
  sanitize: (s: string | undefined | null) => string,
): RoomScope {
  if (!Array.isArray(payload)) {
    return { state: "unknown", reason: "unrecognised-shape", note: uncheckedRoomsNote("unrecognised-shape") };
  }
  const rooms: RoomSummary[] = [];
  for (const entry of payload) {
    const room = asRoom(entry);
    if (room === null) {
      return {
        state: "unknown",
        reason: "unrecognised-shape",
        note: uncheckedRoomsNote("unrecognised-shape"),
      };
    }
    rooms.push(room);
  }
  const live = rooms.filter((r) => !r.archived);
  const archived = rooms.length - live.length;
  if (live.length > 0) {
    return { state: "live", rooms, live, archived, note: liveRoomsNote(live, sanitize) };
  }
  if (archived > 0) {
    return { state: "archived-only", rooms, archived, note: archivedOnlyNote(archived) };
  }
  return { state: "none" };
}

/** Fetch the caller's rooms and classify them. Never throws — a failure is a
 *  state, not an exception, because every caller has to render it. */
export async function probeRoomScope(
  fetchRooms: () => Promise<unknown>,
  sanitize: (s: string | undefined | null) => string,
): Promise<RoomScope> {
  try {
    return classifyRooms(await fetchRooms(), sanitize);
  } catch {
    return { state: "unknown", reason: "fetch-failed", note: uncheckedRoomsNote("fetch-failed") };
  }
}

/**
 * Not in the room list — and the reason is not only "wrong address or not a
 * member", which is what this used to assert. A room the caller merely JOINED
 * disappears from the list the moment its owner archives it (core filters
 * `is_archived = FALSE` out of the member query), so for exactly the invited
 * teammate this release is about, the old two-cause sentence was false.
 */
const NO_SUCH_ROOM_NOTE =
  `\n\nThat room is not in your list — the address may be wrong, you may not be a ` +
  `member, or it may be archived: a room you only JOINED disappears from the list once ` +
  `its owner archives it. memory_list_rooms shows the ones you can read.`;

/** "We could not look" for a named scope, which the old code spelled as `""` —
 *  i.e. exactly like "the store is there and your query merely missed". */
function uncheckedNamedNote(probed: "domains" | "rooms", reason: UncheckedReason): string {
  const cause =
    reason === "fetch-failed"
      ? "could not be fetched just now"
      : "came back in a shape this client does not recognise";
  return probed === "rooms"
    ? `\n\nWhether you are a member of that room could not be checked — the room list ` +
        `${cause}. So this empty result is not evidence that the address is wrong or that ` +
        `you are not in it. memory_list_rooms shows the rooms you can read.`
    : `\n\nWhether a store with that exact name exists could not be checked — the domain ` +
        `list ${cause}. So this empty result is not evidence that the name is wrong; names ` +
        `are matched byte-for-byte, and memory_stats lists them exactly.`;
}

function unchecked(
  name: string,
  probed: "domains" | "rooms",
  reason: UncheckedReason,
): NamedScope {
  return { state: "unchecked", name, probed, reason, note: uncheckedNamedNote(probed, reason) };
}

/**
 * Probe for the one store a scoped read named.
 *
 * A ROOM ADDRESS IS CHECKED AGAINST THE ROOM LIST, never against `/memory/stats`
 * — that exclusion is the whole reason this release exists. `memory_stats`
 * reports the caller's own org bucket only, and not one of an account's twelve
 * live rooms appears in its domain list, so probing it for an `xroom:` address
 * would confidently answer "No store of your own has that exact name" about a
 * room the caller is a member of: the false-absence claim being fixed,
 * reintroduced by the fix (CodeRabbit, #65).
 *
 * The argument is the RAW value that was sent, never a trimmed copy. A read on
 * `" engineering"` searched the padded store while a trimmed diagnosis checked
 * `"engineering"`, found it, and stayed silent — suppressing the one note that
 * explains the miss precisely when a stray space had caused it.
 *
 * Private because `name` must be non-empty, which only {@link probeReadScope}
 * can guarantee: `searchedScope` maps `""` to `undefined`, so an empty domain is
 * not a scope at all and takes the own-domains path.
 */
async function probeNamedScope(
  name: string,
  fetchStats: () => Promise<unknown>,
  fetchRooms: () => Promise<unknown>,
  sanitize: (s: string | undefined | null) => string,
): Promise<NamedScope> {
  if (name.startsWith("xroom:")) {
    let payload: unknown;
    try {
      payload = await fetchRooms();
    } catch {
      return unchecked(name, "rooms", "fetch-failed");
    }
    const rooms = classifyRooms(payload, sanitize);
    if (rooms.state === "unknown") return unchecked(name, "rooms", rooms.reason);
    const all = rooms.state === "none" ? [] : rooms.rooms;
    const member = all.some((r) => r.address === name || `xroom:${r.room_id}` === name);
    return member
      ? { state: "present", name }
      : { state: "no-such-room", name, note: NO_SUCH_ROOM_NOTE };
  }

  let payload: unknown;
  try {
    payload = await fetchStats();
  } catch {
    return unchecked(name, "domains", "fetch-failed");
  }
  const domains = (payload as { domains?: unknown } | null | undefined)?.domains;
  // Core's response model declares `domains: list[str]` with no default, so it
  // is always present and always an array of strings on a 200. A missing key or
  // a non-string element therefore means the body is not core's, and the only
  // honest reading is that we did not get to look — not that the store is absent.
  if (!Array.isArray(domains) || domains.some((d) => typeof d !== "string")) {
    return unchecked(name, "domains", "unrecognised-shape");
  }
  const known = domains as string[];
  if (known.includes(name)) return { state: "present", name };
  return { state: "no-such-domain", name, note: noSuchDomainNote(name, known) };
}

/**
 * Build the {@link ReadScope} for one read: where it looked, and what we know
 * about what it therefore did not cover. One GET per call — the room list for
 * an unscoped read or an `xroom:` address, `/memory/stats` for a plain domain
 * — and callers reach it on zero-result paths only. That is MORE probing than
 * 0.8.0 did, not "exactly as before" (an earlier version of this comment):
 * 0.8.0 made no probe at all on a domain-scoped, room-scoped or filtered read
 * and none anywhere in the feed; only the plain unscoped read probed stats.
 * The added reads are disclosed in the 0.8.1 CHANGELOG entry, rate cost
 * included.
 *
 * `searched` must be the value that went over the wire — `searchedScope(domain)`
 * — so that the diagnosis and the request can never describe different stores.
 * A falsy value takes the own-domains path because that is what the request did:
 * core filters on `domain is not None`, and `searchedScope` drops `""`.
 */
export async function probeReadScope(
  searched: string | undefined,
  fetchStats: () => Promise<unknown>,
  fetchRooms: () => Promise<unknown>,
  sanitize: (s: string | undefined | null) => string,
): Promise<ReadScope> {
  if (!searched) {
    return { kind: "own-domains", rooms: await probeRoomScope(fetchRooms, sanitize) };
  }
  return { kind: "named", named: await probeNamedScope(searched, fetchStats, fetchRooms, sanitize) };
}
