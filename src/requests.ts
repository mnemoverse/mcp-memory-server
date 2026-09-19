/**
 * Request bodies, built by pure functions so the wire contract can be TESTED.
 *
 * Why this module exists. 0.8.1 is a patch, and its rule is that wording may
 * change but where data is written or read from may not. The branch broke that
 * rule twice and neither break was caught:
 *
 *   1. A `trim()` on the way out normalised past a deliberate 400-guard in
 *      core, so a padded room address would have written into a shared room
 *      visible to other accounts.
 *   2. The revert of that trim dropped `|| undefined` on the read path, so
 *      `domain: ""` became `WHERE domain = ''` — a store that cannot exist —
 *      turning a search of every domain into a guaranteed miss.
 *
 * The guard test at the time grepped src/index.ts for the ABSENCE of a trim.
 * That cannot catch a DELETED coercion, which is exactly what shipped: 60 tests
 * green with the divergence in place (reviews, 2026-08-08). A denylist over
 * source text is not a contract; a function whose output you can compare is.
 *
 * Rule for changing anything here: if a body changes for ANY input, that is a
 * MINOR release, however obviously correct the change looks. The tests pin the
 * whole matrix — whitespace, non-breaking and zero-width spaces, padded room
 * addresses, "0", ":" — because every one of those was a real finding.
 *
 * Deliberately NOT normalising: core matches domains byte-for-byte and rejects
 * non-canonical room addresses on purpose. Cleaning input here silently moves
 * data and defeats a security guard. Normalisation belongs in a future
 * release, with room addresses exempt, and with zero-width characters
 * handled — `trim()` does not strip those. (memory_delete_domain, once named
 * here as a second surface needing the same treatment, was withdrawn
 * 2026-08-20 — deletion is administrative-only now.)
 */

// KEYS_URL is imported for refusePlaceholderKey at the bottom of this file:
// a config-only guard that otherwise has nothing to do with request bodies,
// but needs the same console URL a 401 already points at (src/errors.ts) and
// is documented at its own definition rather than here.
import { KEYS_URL } from "./errors.js";

export interface ReadArgs {
  query: string;
  top_k?: number;
  domain?: string;
  order_by?: "relevance" | "recency";
  since?: string;
  until?: string;
  exclude_author?: string;
}

export interface RecentArgs {
  domain?: string;
  since?: string;
  until?: string;
  exclude_author?: string;
  limit?: number;
  cursor?: string;
}

export interface WriteArgs {
  content: string;
  concepts?: string[];
  domain?: string;
}

/**
 * The scope actually searched: what core receives, and therefore the only value
 * any message about the result may describe.
 *
 * `|| undefined` rather than a null check, because core filters on
 * `domain is not None` — an empty string would become a real, impossible
 * filter. Everything else passes through untouched.
 */
export function searchedScope(domain?: string): string | undefined {
  return domain || undefined;
}

/** memory_read. The temporal keys are omitted entirely when unused so the body
 * stays byte-identical for callers that never pass them (#404). */
export function readRequestBody(a: ReadArgs): Record<string, unknown> {
  return {
    query: a.query,
    top_k: a.top_k || 5,
    domain: searchedScope(a.domain),
    include_associations: true,
    ...(a.order_by ? { order_by: a.order_by } : {}),
    ...(a.since ? { since: a.since } : {}),
    ...(a.until ? { until: a.until } : {}),
    ...(a.exclude_author ? { exclude_author: a.exclude_author } : {}),
  };
}

/** memory_list_recent. */
export function recentRequestBody(a: RecentArgs): Record<string, unknown> {
  return {
    domain: searchedScope(a.domain),
    since: a.since || undefined,
    until: a.until || undefined,
    exclude_author: a.exclude_author || undefined,
    limit: a.limit || 20,
    cursor: a.cursor || undefined,
  };
}

/** memory_write. `"general"` is the server-side default made explicit, and is
 * what 0.8.0 sent — NOT a normalisation of the caller's value. */
export function writeRequestBody(a: WriteArgs): Record<string, unknown> {
  return {
    content: a.content,
    concepts: a.concepts || [],
    domain: a.domain || "general",
  };
}

/**
 * Refuse a docs placeholder key from CONFIGURATION ALONE, before any tool
 * call sends it anywhere.
 *
 * WHY THIS EXISTS. Production, 30 days: rejections carrying the docs
 * placeholder key (prefix mk_live_YOUR) arrived from user agent "node", this
 * server itself, repeating for up to 12 days on the same account. The agent
 * got a 401, got this server's generic replace-the-key sentence, and called
 * again. A value this client can recognise as a placeholder WITHOUT any
 * request is still worth refusing before the network, exactly as
 * `refuseInsecureBaseUrl` (src/index.ts) refuses an insecure
 * MNEMOVERSE_API_URL before the network, for the same reason: a config-only
 * guard is checked once and costs nothing, while a wasted round trip costs a
 * rate-limited request every time an agent cannot help but retry.
 *
 * FIRES ONLY FOR VALUES THAT ARE CERTAINLY PLACEHOLDERS: two shapes, and
 * nothing else, however odd:
 *
 *   (a) mk_live_ followed by an upper-case label (mk_live_YOUR_KEY,
 *       mk_live_USER_KEY, mk_live_CODING_AGENT_KEY), the same shape the
 *       engine itself classifies as placeholder_key.
 *   (b) mk_live_ followed only by the letter x, at least four of them,
 *       either case (mk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx), the
 *       template value shipped in src/configs/source.json.
 *
 * A self-hosted static-auth deployment can use an arbitrary key that does
 * not start with mk_live_ at all, and a TRUNCATED real key (mk_live_deadbeef,
 * say) must still reach the engine, whose answer is more precise than a
 * local guess would be. So both a mixed-case label (mk_live_Your_Key) and
 * anything shaped like a real key are left alone here on purpose, same as
 * every other value this function has never seen.
 *
 * PURE AND EXPORTED, colocated with the request builders rather than with
 * `refuseInsecureBaseUrl` itself, because that one needs a `URL` parse this
 * module has no other reason to import (the shape of the guard is the same,
 * the machinery differs). `apiFetch` in src/index.ts evaluates this once into
 * a module constant next to `BASE_URL_REFUSAL`, and checks both at the same
 * two call sites: inside `apiFetch`, and inside the startup probe.
 *
 * `KEYS_URL` is imported from src/errors.ts rather than repeated here as a
 * second literal, the same console page a 401 already points at.
 */
export function refusePlaceholderKey(
  key: string,
): { toolCall: string; startupLog: string } | undefined {
  const isLabelledPlaceholder = /^mk_live_[A-Z][A-Z_]*$/.test(key);
  const isTemplatePlaceholder = /^mk_live_[xX]{4,}$/.test(key);
  if (!isLabelledPlaceholder && !isTemplatePlaceholder) return undefined;
  return {
    toolCall:
      "Mnemoverse: this tool did not run, because MNEMOVERSE_API_KEY is " +
      "still the example value from the documentation, not a real key. " +
      "Nothing was sent: this client refuses the call instead. This is the " +
      "user's configuration, not a fault of the key, the network or the " +
      `service. Tell them to create a key at ${KEYS_URL}, put it in the ` +
      "MCP client config in place of the placeholder, and restart the MCP " +
      "server. Do not retry until then; every memory tool will fail the " +
      "same way until it is replaced.",
    startupLog:
      "Mnemoverse: startup key check SKIPPED, and nothing was sent. " +
      "MNEMOVERSE_API_KEY is still the example value from the " +
      `documentation, not a real key. Create one at ${KEYS_URL}, put it in ` +
      "the MCP client config in place of the placeholder, and restart. " +
      "Every memory tool will fail until it is replaced.",
  };
}
