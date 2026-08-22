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
