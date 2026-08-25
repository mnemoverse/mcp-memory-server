/**
 * The one place that decides what an offset-less timestamp MEANS.
 *
 * This module exists because the answer was written down twice and implemented
 * once. Both `since` parameter descriptions and core's own schema say a naive
 * ISO-8601 value is UTC; `Date.parse("2026-08-08T13:00:00")` says it is local
 * time. The gap was closed for the future-watermark note in 0.8.1 (src/scope.ts)
 * and left open in the renderer (src/render.ts), so the same wire value decided
 * one thing on the way in and another on the way out — a convention two modules
 * read differently is not a convention.
 *
 * It lives on its own rather than in scope.ts because render.ts must not depend
 * on scope.ts: the dependency deliberately runs the other way (scope.ts takes
 * `safeInline` as an injected parameter precisely to avoid importing the
 * renderer), and names.ts is about printing names, not about reading clocks.
 */

/**
 * Parse an ISO-8601 instant the way the SERVER does: an offset-less value is
 * UTC, not local time. Returns epoch milliseconds, or `null` for anything that
 * cannot be read as an instant.
 *
 * The mismatch this fixes is not cosmetic — it moved dates. West of UTC a
 * perfectly sane watermark was declared to be in the future and every clause of
 * the future-watermark note was false; east of UTC a genuinely future watermark
 * was shifted into the past and the note stayed silent, missing the one case it
 * exists for (review, 2026-08-08). On a rendered result line the same reading
 * printed `2026-08-01T23:30:00` as `2026-08-02 06:30Z` in America/Los_Angeles:
 * a memory dated to a day it was not written, with a `Z` asserting it was UTC.
 *
 * Date-only values ("2026-08-08") are already parsed as UTC by spec, so only
 * date-TIME values without an offset need the Z.
 *
 * `value` is `unknown` because both call sites read it off the wire, where the
 * response types are aspirational: `created_at` is typed as a string and can
 * arrive as a number. A value that is not a string is not an ISO-8601 instant,
 * so it is `null` here rather than a guess — `new Date(1754082281605)` is a
 * perfectly good date for a field whose contract says it is text.
 */
export function parseAsUtc(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const isDateTime = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s);
  const t = Date.parse(isDateTime && !hasOffset ? `${s.replace(" ", "T")}Z` : s);
  return Number.isNaN(t) ? null : t;
}
