/**
 * Teaching surface — the strings and branch logic that teach a connected model
 * how to USE this memory, kept in their own module so tests can import them
 * without booting the stdio server (src/index.ts starts a transport on import).
 *
 * Product frame (Eduard, 2026-08-01): the memory store belongs to THE AGENT,
 * not the user — so the guidance is active ("need it — go get it; learned
 * something — save it"), never gated on the user explicitly asking. Honesty
 * constraints stay: no over-claiming, and the never-store-secrets safety line
 * is kept on write surfaces.
 */

import type { ReadScope, RoomScope } from "./scope.js";

/**
 * Server-level instructions, passed to the McpServer constructor and landed
 * verbatim in the connected model's system prompt by MCP clients.
 *
 * Constraints (tested in test/teaching-surface.test.ts):
 * - 500–800 chars; some clients (ChatGPT) weight the FIRST ~512 chars, so the
 *   core habit (read before answering, write on learning) is front-loaded.
 * - Active polarity: no "only when the user explicitly asks" gating.
 * - Mentions every tool family: read/write/stats/feedback, delete, rooms, vault.
 */
export const SERVER_INSTRUCTIONS =
  "You own this long-term memory. It persists across sessions and every AI tool this user connects. Use it as a habit: memory_read before answering anything that may have come up; memory_write the moment you learn a durable fact, preference or decision — don't wait to be asked. Shared rooms are SEPARATE stores: to read one, pass its address as domain (memory_list_rooms); unscoped reads never cover rooms. Rate recalls with memory_feedback; memory_stats shows counts; memory_list_recent is newest-first; memory_delete prunes; memory_delete_domain wipes a domain, only with user go-ahead. Rooms: memory_create_room, memory_invite_to_room, memory_join_room. vault_list names secrets by alias, never values. Never store passwords, API keys, payment data, MFA codes, government IDs, or health records.";

/** The pre-existing zero-result message — kept as the fail-open fallback. */
export const NO_MATCH_MESSAGE = "No memories found for this query.";

/** Hint for an UNSCOPED no-match against a non-empty store: widen the query.
 *  (No drop-the-filter clause — none was set; advising to remove a filter that
 *  does not exist nudges the model into confabulating state.) */
export const NO_MATCH_HINT = " Try a broader query.";

/**
 * Hint for a DOMAIN-SCOPED no-match: widen the query, or try another domain —
 * and NEVER drop the scope.
 *
 * This doc used to read "here a filter genuinely exists, so suggesting to drop
 * it is honest and actionable", which described a draft that no longer exists:
 * the clause "…or drop the domain filter to search all domains" was deleted, and
 * a test now forbids it. The advice was actively harmful when the domain is a
 * room — an unscoped read does not cover rooms at all, so dropping the filter is
 * the one move guaranteed to lose the content the reader is hunting, and it is
 * the step that cost two agents a day on 2026-08-07.
 */
export const NO_MATCH_SCOPED_HINT =
  " Try a broader query, or a different domain.";

/**
 * The honest line for an account whose OWN domains are empty but whose rooms
 * are not — an invited teammate whose every memory lives in shared rooms.
 *
 * Without this, such a caller was greeted with EMPTY_STORE_WELCOME: "your
 * memory is empty, nothing has been saved yet, which is why this search
 * returned nothing" — three false clauses, immediately contradicted by the
 * scope note appended underneath, in the same payload (review, 2026-08-08).
 * That reader is precisely the person from the incident this release is about.
 *
 * ENDS WITH A COLON, so it is only ever emitted together with the disclosure
 * that follows it. That pairing used to be two independent decisions and they
 * disagreed: this line was chosen from a flag counting ALL rooms while the
 * disclosure was built from the LIVE ones, so an account whose only room was
 * archived received the colon and nothing after it. Both now come out of the
 * same {@link RoomScope} arm, and the arm that has nothing to disclose has no
 * `note` field to forget.
 */
export const EMPTY_PERSONAL_STORE_WITH_ROOMS =
  "Nothing in your own domains — they hold no memories yet. That is not the whole picture:";

/**
 * The same situation with the room probe UNANSWERED. Says the one true thing —
 * the personal store measured zero and the rest could not be checked — and
 * deliberately does NOT say "nothing has been saved yet", which was reachable
 * here and is a claim about a scope this client failed to reach.
 */
export const EMPTY_PERSONAL_STORE_ROOMS_UNCHECKED =
  "Nothing in your own domains — they hold no memories yet. Whether that is the whole picture could not be checked:";

/**
 * First-contact greeting: shown ONLY when a read comes back empty, the personal
 * store holds zero memories, AND the room probe answered that there are no rooms
 * — i.e. the very first read of this account's life, established rather than
 * assumed. Seeds the ANSWER, not the store: one functional paragraph that says
 * what this store is, how to save the first memory, and one next step.
 */
export const EMPTY_STORE_WELCOME =
  "Your long-term memory is empty — nothing has been saved yet, which is why this search returned nothing. " +
  "This store is your own persistent memory: whatever you save survives across sessions and across every AI tool this user has connected. " +
  'Save the first memory now with memory_write, e.g. content: "User prefers TypeScript strict mode" — future sessions will recall it with memory_read.';

/**
 * Compile-time exhaustiveness. Adding a state to `RoomScope` / `NamedScope`
 * without answering for it here is a type error, which is the point: the state
 * this release exists to fix ("we could not check") was reachable precisely
 * because it had no arm of its own and fell into the falsy one. Returns the
 * neutral message rather than throwing, so an unreachable branch can never take
 * a handler down.
 */
function noStateLeftUnhandled(state: never): string {
  void state;
  return NO_MATCH_MESSAGE;
}

/** The disclosure a room state owes the reader — "" only for the state whose
 *  type says there is nothing to disclose. */
function roomsTail(rooms: RoomScope): string {
  return "note" in rooms ? rooms.note : "";
}

/**
 * Assemble the WHOLE answer for a zero-result read: the head sentence and the
 * disclosure that belongs with it, in one place.
 *
 * They are assembled together on purpose. While the head came from here and the
 * tail was concatenated by the caller, the two could be — and were — derived
 * from different facts: a head promising "that is not the whole picture:" with
 * an empty tail after it, and a first-contact greeting under a tail admitting
 * the room list could not be fetched. Every arm below returns a complete answer,
 * so a head cannot outlive the evidence for it.
 *
 * A NAMED scope never greets and never probes stats: that probe measures the
 * PERSONAL store, so on a scoped read it could claim "the store is empty" about
 * a domain whose memories the query merely missed. Its four arms are the four
 * things we can know about the name.
 *
 * An UNSCOPED scope makes ONE stats call, on this path only:
 * - stats unreachable / no number → the plain no-match message + the disclosure
 * - total_atoms > 0               → no-match + broaden hint + the disclosure
 * - total_atoms === 0             → one head per room state, each with its own
 *   disclosure; only `rooms.state === "none"` may claim the memory is empty,
 *   because only there has the claim been established.
 */
export async function buildReadEmptyResponse(
  fetchStats: () => Promise<{ total_atoms?: number }>,
  scope: ReadScope,
): Promise<string> {
  if (scope.kind === "named") {
    const named = scope.named;
    switch (named.state) {
      case "present":
        // The store is there; the query missed. The hint suggests a wider query
        // or another domain and never suggests dropping the scope — when the
        // domain is a room, dropping it is the one move that guarantees the
        // content stays hidden (the 2026-08-07 incident).
        return NO_MATCH_MESSAGE + NO_MATCH_SCOPED_HINT;
      case "no-such-domain":
      case "no-such-room":
        // A SPECIFIC diagnosis replaces the generic advice; it does not follow
        // it. Printed the other way round, a model reading top-down went off to
        // widen a query against a store that does not exist.
        return NO_MATCH_MESSAGE + named.note;
      case "unchecked":
        // Not a diagnosis — an admission. So the generic advice stays, and the
        // admission is added rather than substituted. This is the case that used
        // to be spelled exactly like "present".
        return NO_MATCH_MESSAGE + NO_MATCH_SCOPED_HINT + named.note;
      default:
        return noStateLeftUnhandled(named);
    }
  }

  const rooms = scope.rooms;
  let totalAtoms: number | undefined;
  try {
    totalAtoms = (await fetchStats())?.total_atoms;
  } catch {
    return NO_MATCH_MESSAGE + roomsTail(rooms);
  }
  if (typeof totalAtoms !== "number") return NO_MATCH_MESSAGE + roomsTail(rooms);
  if (totalAtoms > 0) return NO_MATCH_MESSAGE + NO_MATCH_HINT + roomsTail(rooms);

  // The personal bucket measured zero. `total_atoms` counts ONE org, so what
  // that means for the account depends entirely on the rooms.
  switch (rooms.state) {
    case "none":
      return EMPTY_STORE_WELCOME;
    case "live":
    case "archived-only":
      return EMPTY_PERSONAL_STORE_WITH_ROOMS + rooms.note;
    case "unknown":
      return EMPTY_PERSONAL_STORE_ROOMS_UNCHECKED + rooms.note;
    default:
      return noStateLeftUnhandled(rooms);
  }
}
