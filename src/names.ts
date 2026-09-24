/**
 * Naming a thing so the reader can reproduce it — the counterpart to
 * `safeInline`, and deliberately NOT the same tool.
 *
 * `safeInline` (src/render.ts) is a SANITISER: it maps every character outside
 * `[\w .@:+/-]` to a space, collapses runs of whitespace, trims the ends and
 * truncates. That is the right treatment for a display string chosen by a
 * DIFFERENT principal — an agent name — where the only job is to make a
 * hostile value harmless to paste into a model's context and nothing about the
 * value needs to stay recognisable. (Room names looked like that class and are
 * not — see the threat model at the bottom.)
 *
 * It is the WRONG treatment for any value the reader is expected to compare or
 * send back, and it was being used for exactly that (reviews, 2026-08-08):
 *
 *   - `" engineering"` and `"engineering"` rendered identically, so the
 *     `@domain` tag added in this release could point a reader at the wrong
 *     store, and `memory_stats` could not support the byte-exact check that
 *     `memory_delete_domain`'s own description sends the reader there for.
 *   - `"проект:acme"` and `"план:acme"` both rendered as `:acme` — one lossy
 *     transform, two distinct stores, one output string. A whitespace-only
 *     domain rendered as the empty string, i.e. as no name at all.
 *   - Core's only write-rejection reason, `"Below importance threshold (0.412 <
 *     0.500)"`, was relayed under the label `Server reason:` as
 *     `Below importance threshold 0.412 0.500` — the comparison operator and
 *     both delimiters deleted from a quote that claims to be verbatim.
 *
 * Domain names are matched byte-for-byte everywhere in the engine (parameterised
 * equality on raw bytes; no trim, no case-fold, no normalisation in the schema,
 * the storage layer or a migration), so a name that cannot be reproduced cannot
 * be acted on. Hence the rule this module implements: **print a value exactly,
 * or do not print it at all.**
 *
 * ## The renderer
 *
 * `exactLiteral` returns the value as a JSON string literal, chosen because it
 * satisfies both halves of the problem at once and needs no bespoke decoder:
 *
 *   - REVERSIBLE. `JSON.parse(literal) === value`, for every input, including
 *     lone surrogates. That is the contract, and it is asserted directly in
 *     test/names.test.ts rather than approximated by sampling characters.
 *     Spaces stay inside the quotes, so leading/trailing/doubled whitespace is
 *     visible; control characters become `\n` or a `\uXXXX` escape; non-ASCII
 *     letters pass through untouched, so Cyrillic survives as itself.
 *   - INJECTION-SAFE for the surface it lands on. The output is one line: no
 *     raw newline can forge a new instruction block, `"` and `\` are escaped so
 *     the quoted context cannot be closed early, and line/paragraph separators
 *     (U+2028/U+2029, which `JSON.stringify` leaves raw) are escaped here.
 *
 * On top of `JSON.stringify` this escapes everything invisible or
 * whitespace-confusable that it leaves alone: U+007F–U+009F, all format
 * characters (zero-width space and joiners, soft hyphen, bidi overrides, BOM),
 * line and paragraph separators, and every space separator EXCEPT plain U+0020
 * — so a name padded with a no-break space is distinguishable from one padded
 * with an ordinary one. Combining marks are left as they are: they are ordinary
 * letters in many languages, and the guarantee here is byte-exact round-trip,
 * not visual uniqueness.
 *
 * ## Truncation
 *
 * A truncated name is not reproducible, so nothing is truncated. When the
 * literal would exceed the cap, `exactLiteral` returns `null` and the call site
 * must choose a NAME-FREE phrasing ("the domain you passed"). The caps are set
 * so this is unreachable for any name the engine can hold — the `atoms.domain`
 * column is `VARCHAR(100)` — leaving only pathological values (a hundred
 * control characters) unnamed.
 *
 * ## Threat model, stated because it differs from `safeInline`'s
 *
 * A `domain` is never another principal's free text. `/memory/stats` reports
 * the caller's own org bucket only and never contains a room; an atom that
 * lives in a room bucket carries the canonical `xroom:<room_id>` as its domain,
 * and core 400s any non-canonical spelling of that while `room_id` itself is
 * charset-validated. So every value rendered here is either the caller's own
 * string or a machine-shaped address — with one exception. Room NAMES are
 * another principal's free text — chosen by an owner, shown to a joiner — and
 * they are printed through this module too ({@link roomNamePhrase}, 0.8.1): the
 * literal is already the anti-injection treatment (one line; quotes,
 * backslashes and invisibles escaped), while the sanitiser it replaces did not
 * make hostile names harmless so much as it made ordinary names WRONG — two
 * live rooms named "проект" and "план" both rendered "(unnamed room)" in the
 * note that asks the reader to pick one, and "Zoë" was quoted as "Zo". A room
 * name is display-only (the ADDRESS beside it is what a reader re-sends), so a
 * name that cannot be printed within the cap degrades to a phrase saying so —
 * never to a truncated or rewritten name, and never to "(unnamed room)", which
 * is reserved for a room that genuinely has no name.
 */

/**
 * Everything `JSON.stringify` passes through raw that a reader cannot see, or
 * cannot tell apart from a plain space. U+0020 is exempted in the replacer so
 * ordinary spaces stay legible inside the quotes.
 */
const NOT_REPRODUCIBLE_RAW = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Zs}]/gu;

/** Escape every UTF-16 unit of a match — a match may be a surrogate pair. */
function escapeUnits(match: string): string {
  let out = "";
  for (let i = 0; i < match.length; i++) {
    out += "\\u" + match.charCodeAt(i).toString(16).padStart(4, "0");
  }
  return out;
}

export interface ExactLiteral {
  /** The value as a JSON string literal, quotes included. */
  literal: string;
  /**
   * True when the literal is more than the value wrapped in quotes — i.e. it
   * contains at least one escape, so the text between the quotes is NOT the
   * name and must be decoded before it is sent back.
   */
  escaped: boolean;
}

/** Longest literal we will print for a domain name in a sentence or a list. */
export const MAX_DOMAIN_LITERAL = 256;

/**
 * Longest literal we will print as an `@domain` tag on a result line.
 *
 * Shared, not mirrored: the ` [by "name"]` author tag (`formatAuthorTag`,
 * src/render.ts) reuses this SAME constant rather than a second one of its
 * own (owner decision I66-4, issue #66, 2026-09-24): one calibrated number,
 * not two magic values that happen to agree today and can drift apart later.
 */
export const MAX_DOMAIN_TAG_LITERAL = 128;

/**
 * The value as a reproducible JSON string literal, or `null` when it cannot be
 * printed within `max` — in which case the caller must not name it at all.
 */
export function exactLiteral(
  value: string | null | undefined,
  max = MAX_DOMAIN_LITERAL,
): ExactLiteral | null {
  // Not just a null check: a response field the types say is a string can be a
  // number or an object on the wire, and `JSON.stringify(5)` returns an
  // UNQUOTED `5` that no longer round-trips. A value that is not a string is
  // not a name we can print exactly, so we do not print it.
  if (typeof value !== "string") return null;
  const literal = JSON.stringify(value).replace(NOT_REPRODUCIBLE_RAW, (m) =>
    m === " " ? m : escapeUnits(m),
  );
  if (literal.length > max) return null;
  return { literal, escaped: literal.slice(1, -1) !== value };
}

/**
 * A domain named inside a sentence: the exact literal, or `fallback` — a phrase
 * that names nothing — when it cannot be reproduced.
 */
export function domainPhrase(
  name: string | null | undefined,
  fallback = "the domain you passed",
  max = MAX_DOMAIN_LITERAL,
): string {
  return exactLiteral(name, max)?.literal ?? fallback;
}

/**
 * A room name as display text, with the three states kept apart because each
 * used to collapse into the next (reviews, 2026-08-08):
 *
 *   - a printable name is the exact literal — "проект" is `"проект"`, not
 *     "(unnamed room)"; "Zoë" is `"Zoë"`, not `"Zo"`;
 *   - a name that cannot be printed within the cap is SAID to be unprintable —
 *     claiming the room is unnamed would be false, and printing an altered
 *     spelling would be worse;
 *   - only a genuinely absent or empty name is "(unnamed room)".
 *
 * The phrases carry no quotes of their own, so they cannot be mistaken for a
 * printed name: every real name on a page is a quoted JSON literal, and a room
 * literally named `(unnamed room)` still renders distinguishably, in quotes.
 *
 * `name` is `unknown` because two of the call sites read it off the wire where
 * the types are aspirational; a non-string is not a name, so it falls to the
 * unnamed phrase — the same narrowing `asRoom` (src/scope.ts) applies.
 */
export function roomNamePhrase(name: unknown): string {
  if (typeof name !== "string" || name === "") return "(unnamed room)";
  return exactLiteral(name)?.literal ?? "(room name cannot be printed exactly)";
}

/**
 * How many characters of NAMES the `Domains:` line may spend.
 *
 * Sized against the tool-result cap it exists to respect: `MAX_RESULT_CHARS` in
 * src/index.ts is 96,000, and the reserve covers the four other stats lines, the
 * escape legend, and the truncation notice `capResult` appends if it ever fires.
 * The relationship is pinned behaviourally — "memory_stats fits the result cap
 * without losing its tail", test/handlers.test.ts — so this number cannot drift
 * away from that one in silence.
 */
export const MAX_DOMAIN_LIST_CHARS = 90_000;

/**
 * The `Domains:` line of memory_stats — the surface this tool's own
 * description sends the reader to "to confirm the exact domain name before
 * writing to it", which it could not do while the names went through
 * `safeInline`. (Until 2026-08-20, `memory_delete_domain`'s description sent
 * readers here for the same reason, before deletion was withdrawn to an
 * administrative REST-only operation.)
 *
 * A name that cannot be printed exactly is COUNTED, never silently dropped:
 * dropping it would make this list assert that a store does not exist, on the
 * one surface whose job is the opposite. An absent or empty list keeps the
 * existing "none reported", which is honest about both of the states core can
 * produce (no key on a non-core 200, or a genuinely empty bucket). The
 * NON-ARRAY half of that first branch is unreachable from `memory_stats`
 * (S7, 2026-09-23): its handler now returns `isError` before calling this
 * function when `domains` is not an array at all, since its outputSchema
 * requires one; it stays here for the direct unit tests below and as
 * defense in depth for any other caller.
 *
 * `maxChars` bounds the NAMES, and it is the reason memory_stats is no longer
 * the one tool result that could exceed the 25K-token Connectors Directory cap.
 * This line is linear in the number of stores and nothing bounded it: 4,000
 * domains rendered past 100,000 characters, every time, with no hostile input
 * involved. Cutting the list here rather than capping the whole message is
 * deliberate — `capResult` truncates from the END, so a blind cap would have
 * eaten the average-quality line and the reminder that rooms are separate
 * stores, i.e. the parts of the answer that are not the wall of names.
 *
 * What is cut is COUNTED and its cause is NAMED, in a clause kept separate from
 * the unprintable one: "the list is too long" and "this name cannot be
 * reproduced" are different facts about different names, and merging them would
 * put the wrong cause on both.
 */
export function formatDomainList(
  domains: unknown,
  emptyLabel = "none reported",
  maxChars = MAX_DOMAIN_LIST_CHARS,
): string {
  if (!Array.isArray(domains) || domains.length === 0) return emptyLabel;
  const rendered = domains.map((d) => exactLiteral(d as string));
  const named = rendered.filter((x): x is ExactLiteral => x !== null);
  const unnamed = rendered.length - named.length;

  // First N that fit, in order — not "every one that fits", which would print a
  // list whose gaps follow no rule a reader could describe.
  const shown: string[] = [];
  let used = 0;
  for (const x of named) {
    const cost = (shown.length > 0 ? 2 : 0) + x.literal.length;
    if (used + cost > maxChars) break;
    used += cost;
    shown.push(x.literal);
  }
  const overflow = named.length - shown.length;

  // "cannot be printed exactly", not "too long": length is the reachable cause,
  // but a value that is not a string at all lands here too, and naming the wrong
  // cause is the habit this release exists to break.
  const clauses: string[] = [];
  if (unnamed > 0) {
    clauses.push(
      `(+${unnamed} name${unnamed === 1 ? "" : "s"} not shown — cannot be printed exactly)`,
    );
  }
  // Says outright what a shortened list would otherwise imply. This tool's own
  // description sends a reader here to confirm a store's exact name before
  // writing to it, so a name that is merely absent from the line must not read
  // as a store that is absent from the account.
  if (overflow > 0) {
    clauses.push(
      `(+${overflow} more name${overflow === 1 ? "" : "s"} not shown — the list is ` +
        `longer than one tool result can carry, so a name you do not see here may ` +
        `still exist)`,
    );
  }
  return [shown.join(", "), ...clauses].filter((s) => s !== "").join(" ");
}

/**
 * The one clause that explains the escaping, so a reader cannot mistake
 * `"engineering\u200b"` for a name whose last six characters are a backslash, a
 * `u` and four digits.
 *
 * Deliberately absent unless an escape was actually used: the common case is a
 * plain name, where the quotes are the whole convention and a legend would be
 * the sort of caveat that trains readers to skip caveats.
 */
export const DOMAIN_ESCAPE_LEGEND =
  "\n\n(Quoted names above are printed as JSON string literals so they can be " +
  "reproduced exactly: the surrounding quotes are not part of the name, and an " +
  "escape such as \\u00a0 or \\n stands for ONE character. Decode it before you " +
  "send the name back — do not paste the escape text.)";


/**
 * Append {@link DOMAIN_ESCAPE_LEGEND} to `message` if one of `names` was printed
 * in it WITH an escape, and the legend is not there already.
 *
 * Two properties, both by construction rather than by call-site discipline:
 *
 *   - At most once per answer. A message is assembled from several independent
 *     notes and more than one of them may have named a store.
 *   - Only for a name that is actually on the page. A caller passes the
 *     candidates it had; whether a sentence named one of them depends on the
 *     branch it took (`scopeLabel` says "that room" for a room address, and
 *     nothing at all for a name it cannot reproduce). A legend that explains
 *     escapes in a name the reader cannot see is a caveat about nothing.
 */
export function withDomainEscapeLegend(
  message: string,
  ...names: (string | null | undefined)[]
): string {
  return withEscapeLegendAt(MAX_DOMAIN_LITERAL, message, ...names);
}

/**
 * The same legend, for a surface that printed its literals under a different
 * cap. The result-line tags (`@domain`, `[by "name"]`) refuse a literal longer
 * than MAX_DOMAIN_TAG_LITERAL and print a name-free fallback instead, so a
 * candidate must be judged under THAT cap there: judged under the larger
 * note cap, a name in between the two would count as printed-and-escaped
 * whenever its literal happens to appear in a result's content, and the
 * legend would explain an escape the tag never showed (review round 2 on
 * issue #66).
 *
 * The at-most-once check looks for the whole legend, not a fragment of it:
 * a fragment short enough to fit a printed literal (an author name from
 * another connector, say) could otherwise appear inside a tag and suppress
 * the legend for a genuinely escaped name elsewhere on the page. The whole
 * legend is longer than any literal either cap admits.
 */
export function withEscapeLegendAt(
  max: number,
  message: string,
  ...names: (string | null | undefined)[]
): string {
  if (message.includes(DOMAIN_ESCAPE_LEGEND)) return message;
  const needed = names.some((n) => {
    const r = exactLiteral(n, max);
    return r !== null && r.escaped && message.includes(r.literal);
  });
  return needed ? message + DOMAIN_ESCAPE_LEGEND : message;
}

/**
 * A third renderer, for values that go into `structuredContent` as the
 * service sent them rather than into a sentence a reader compares by eye.
 *
 * `exactLiteral` is for a value the reader must reproduce byte-for-byte (a
 * domain name): it either prints the value exactly, quotes included, or
 * refuses to print it at all (the TEXT path for a write's `reason` keeps
 * using it, `src/tools.ts`, `reasonQuote`). `structuredContent` is a
 * different surface: a consumer reads `reason` as a plain string field, not
 * as a quoted literal it must decode, so the same escaping convention does
 * not apply. What still applies is CN-032: `reason` is text the memory
 * service chose, and it reaches a caller's context unquoted, so it must be
 * stripped of the same instruction-hiding character classes `safeInline`
 * strips for a display string, while leaving ORDINARY text untouched,
 * because core's only write-rejection reason,
 * `"Below importance threshold (0.047 < 0.1)"`, must survive with its
 * parentheses and `<` intact, which `safeInline` itself does not guarantee
 * (it deletes both; see the block comment at the top of `src/render.ts`).
 *
 * Matches the connector's own field description for this value verbatim:
 * "Ordinary text is preserved exactly; only control, bidi, zero-width, and
 * repeated-whitespace characters are normalized before display"
 * (mnemoverse-mcp-remote, `memoryWriteOutput.reason`). The character classes
 * are copied from its `safeInline` (src/tools/index.ts) so the two servers
 * normalise the same bytes the same way:
 *
 *   - C0 controls (U+0000-U+001F) and C1 controls (U+007F-U+009F), which
 *     includes tab, newline and CR, are each replaced with a space, not
 *     deleted, so removing one cannot glue two words together.
 *   - Bidi controls (U+061C ALM, U+200E-U+200F LRM/RLM, U+202A-U+202E the
 *     explicit embedding/override pairs and PDF, and U+2066-U+2069 the
 *     isolate pairs and PDI) are also replaced with a space.
 *   - Zero-width format characters (U+200B-U+200D ZWSP/ZWNJ/ZWJ, U+2060 word
 *     joiner, U+FEFF ZWNBSP/BOM) are dropped with no replacement, since they
 *     sit inside words rather than between them.
 *   - Whitespace runs (including the spaces just introduced) are then
 *     collapsed to one space each, and the result is trimmed.
 *
 * Reused by later slices for the other free-text fields the service can
 * return unquoted: room name, `share_message`, `next_steps`.
 */
export function structuredText(s: unknown, cap: number): string | undefined {
  if (typeof s !== "string" || s.trim() === "") return undefined;
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBidi =
      code === 0x061c || // ARABIC LETTER MARK
      (code >= 0x200e && code <= 0x200f) || // LRM, RLM
      (code >= 0x202a && code <= 0x202e) || // LRE, RLE, PDF, LRO, RLO
      (code >= 0x2066 && code <= 0x2069); // LRI, RLI, FSI, PDI
    const isZeroWidth =
      code === 0x200b || // ZERO WIDTH SPACE
      code === 0x200c || // ZWNJ
      code === 0x200d || // ZWJ
      code === 0x2060 || // WORD JOINER
      code === 0xfeff; // ZWNBSP / BOM
    // Every other Unicode format character (general category Cf) is dropped
    // as well: the Tag block (U+E0000 to U+E007F, an invisible copy of ASCII
    // used to smuggle text past a reader), U+00AD SOFT HYPHEN, and the rest.
    // `exactLiteral` already escapes the whole category on the text surface;
    // the data surface removed only the curated lists above until Sigma
    // showed the gap on #168 (review round 4). Zl and Zp (line and paragraph
    // separators) count as control here: they break a value the same way a
    // newline does.
    const isOtherFormat = /^[\p{Cf}]$/u.test(ch);
    const isLineSeparator = /^[\p{Zl}\p{Zp}]$/u.test(ch);
    if (isControl || isBidi || isLineSeparator) out += " ";
    else if (isZeroWidth || isOtherFormat) continue;
    else out += ch;
  }
  const collapsed = out.replace(/\s+/g, " ").trim();
  // The cap counts code points, as the connector's safeInline does: slicing
  // the UTF-16 string could cut an astral character at the boundary into a
  // lone surrogate.
  return collapsed === "" ? undefined : [...collapsed].slice(0, cap).join("");
}
