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
  "You own this long-term memory. It persists across sessions and every AI tool this user connects (Claude, ChatGPT, editors). Use it as a habit: call memory_read before answering anything that may have come up before, and memory_write the moment you learn a durable fact, preference, or decision — don't wait to be asked. Rate recalls with memory_feedback so good ones surface faster; memory_stats shows counts; memory_list_recent: newest first; prune with memory_delete; memory_delete_domain wipes a domain, only with user go-ahead. Rooms (memory_create_room, memory_invite_to_room, memory_join_room, memory_list_rooms) share memory with others; vault_list names stored secrets by alias, never values. Never store passwords, API keys, payment data, MFA codes, government IDs, or health records.";

/** The pre-existing zero-result message — kept as the fail-open fallback. */
export const NO_MATCH_MESSAGE = "No memories found for this query.";

/** Hint for an UNSCOPED no-match against a non-empty store: widen the query.
 *  (No drop-the-filter clause — none was set; advising to remove a filter that
 *  does not exist nudges the model into confabulating state.) */
export const NO_MATCH_HINT = " Try a broader query.";

/** Hint for a DOMAIN-SCOPED no-match: here a filter genuinely exists, so
 *  suggesting to drop it is honest and actionable. */
export const NO_MATCH_SCOPED_HINT =
  " Try a broader query, or drop the domain filter to search all domains.";

/**
 * First-contact greeting: shown ONLY when a read comes back empty AND the
 * store holds zero memories — i.e. the very first read of this account's life.
 * Seeds the ANSWER, not the store: one functional paragraph that says what
 * this store is, how to save the first memory, and one next step. It can never
 * appear again once anything is stored (total_atoms > 0 takes the other branch).
 */
export const EMPTY_STORE_WELCOME =
  "Your long-term memory is empty — nothing has been saved yet, which is why this search returned nothing. " +
  "This store is your own persistent memory: whatever you save survives across sessions and across every AI tool this user has connected. " +
  'Save the first memory now with memory_write, e.g. content: "User prefers TypeScript strict mode" — future sessions will recall it with memory_read.';

/**
 * Decide what a zero-result memory_read should say.
 *
 * DOMAIN-SCOPED reads (`scopedToDomain` — the caller passed a `domain` arg,
 * e.g. a shared room) never greet and never probe: the stats call measures the
 * PERSONAL store, so on a scoped read it could claim "the store is empty"
 * about a domain that has memories the query merely missed (review finding).
 * The scoped copy suggests dropping the filter — honest, one actually exists.
 *
 * UNSCOPED reads make ONE stats call (only ever on the zero-result path) to
 * distinguish "store is truly empty" from "no match for this query":
 * - total_atoms === 0     → EMPTY_STORE_WELCOME (first-contact greeting)
 * - total_atoms > 0       → no-match + the broaden hint (no filter clause)
 * - stats throws/malformed → the plain old no-match message (fail-open to the
 *   pre-greeting behavior; never surfaces an error, never writes anything)
 */
export async function buildReadEmptyResponse(
  fetchStats: () => Promise<{ total_atoms?: number }>,
  scopedToDomain = false,
): Promise<string> {
  if (scopedToDomain) return NO_MATCH_MESSAGE + NO_MATCH_SCOPED_HINT;
  let totalAtoms: number | undefined;
  try {
    totalAtoms = (await fetchStats())?.total_atoms;
  } catch {
    return NO_MATCH_MESSAGE;
  }
  if (totalAtoms === 0) return EMPTY_STORE_WELCOME;
  if (typeof totalAtoms === "number" && totalAtoms > 0) {
    return NO_MATCH_MESSAGE + NO_MATCH_HINT;
  }
  return NO_MATCH_MESSAGE;
}
