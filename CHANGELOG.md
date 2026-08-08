# Changelog

All notable changes to `@mnemoverse/mcp-memory-server`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The
project is pre-1.0, so a MINOR bump may change behaviour.

**What counts as a PATCH here**, stated precisely because 0.8.1 needed the line
drawn: a patch may change the WORDING a tool returns, but never where data is
written or read from, and never a tool's name, input schema or annotations. An
MCP tool's output *is* text, so a release that only fixes untrue sentences is a
patch even though every result line looks different afterwards. Anything that
moves data — a domain normalisation, a default, a scope — is a MINOR, however
obviously correct it seems.

This file starts at 0.8.1. Entries for earlier versions are reconstructed from
the release commits and are deliberately terse — for anything before 0.8.1 the
git history and the GitHub releases are the record.

## [0.8.1] — unreleased

An honesty pass. Every result line looks different afterwards, but no data moves
and no schema changes — this release fixes places where the server was saying
something untrue. Prompted by an incident, then by dogfooding the whole surface
with ten agents, then by three adversarial reviews that found thirteen more
false statements *inside the fix itself*.

One thing was cut for exactly that reason: an earlier draft trimmed whitespace
off `domain` before sending it. It looked like a pure win — names match
byte-for-byte in the engine, so `" engineering"` opens a permanent second store.
But core deliberately rejects a non-canonical room address, so trimming
`" xroom:room_01ABC"` normalised past that guard and the write would have landed
in the **room's** store, visible to every member, where 0.8.0 hard-failed. It
also silently relocated padded personal domains while `memory_delete_domain`
kept sending the raw name. Normalisation returns in 0.9.0, with
`memory_delete_domain` included, room addresses deliberately exempt, and
zero-width characters handled (`trim()` does not strip those).

### Fixed — an empty answer now describes its scope instead of asserting absence

- **Shared rooms are no longer invisible in an unscoped read.** A room is a
  separate storage tenant, so an unscoped `memory_read` / `memory_list_recent`
  never covered rooms — and answered "Nothing new since your watermark", which
  is a claim about the world. Both tools now name the rooms that went
  unsearched and how to read them. Two agents lost a working day to this on
  2026-08-07; the write, the index and the read were all fine.
- **Removed advice that caused that incident.** The no-match hint for a scoped
  read used to end "…or drop the domain filter to search all domains". When the
  domain is a room, dropping it is the one move that guarantees the content
  stays hidden. A test used to *require* that wording; it now forbids it.
- **A future `since` is named as such**, with the current server time. It used
  to read exactly like "you're caught up".
- **A misspelled domain is distinguished from an empty one.** Domain names match
  byte-for-byte, so a casing slip silently opens a second permanent store; an
  empty scoped read now says "that is not the same store as X, which does
  exist".
- **`memory_stats` no longer renders a missing field as `0`.** "Associations: 0"
  could read as "this memory has learned nothing" when the server simply hadn't
  answered. Unknown now says unknown; the jargon is glossed; a footer notes that
  rooms are not counted.
- **`memory_write` says NOT STORED when the importance gate rejects a write.**
  The old "Filtered — …" named the mechanism but never the outcome. In
  dogfooding it swallowed a *correction* to a wrong fact — the stale version
  stayed as the only record and looked more authoritative for having no
  competitor.
- **`memory_feedback` explains a zero.** "Feedback recorded for 0 memories." was
  one character from the success line; it now says the ids didn't match and
  where real ids come from. A success echoes the direction, so the loop shows it
  did something.

### Changed

- **Read results no longer show a relevance percentage.** It read as confidence
  and wasn't: the engine's floor (`min_relevance`, default 0.3) is low enough
  that a query about something never stored still returns near-neighbours —
  dogfooding got a real person's profile at "73%" for a question about someone
  fictional, and month-old notes at "73%" for "what's new". It also wasn't a
  percentage of anything, since positive feedback pushes the score above 1.0 and
  reads showed "112%". Rank order still carries the ranking. A dependable
  signal is worth surfacing and is on the 0.9 list; this is a removal until
  there is one. (An earlier draft of this entry claimed there was NO floor.
  There is one — it is simply too low to ever mean "I don't know".)
- **Results carry their domain** (`@"project:acme"`). An unscoped search for a
  common name returned five different people's "Maria Chen" from five projects,
  ranked together, with nothing on the line to tell them apart.
- **Server instructions** (the string clients put in the model's system prompt)
  now state the room rule.
- **Descriptions stopped advertising things that don't work.** `exclude_author`
  asked for a principal no tool in the set exposes and called itself "the
  'everyone but me' read" — passing `"me"` filters nothing, silently. `top_k` is
  not a cap: the same query at 1 / 5 / 20 returned 6 / 7 / 4 items. Neither is
  fixable connector-side, so saying so is the whole available fix.
- Two `domain` descriptions were simply false — "omit to search across all
  domains" / "omit for all your domains". Rooms were never in that "all".

### Added — the test gate this repository did not have

`.github/` contained no reference to `vitest`. Three workflows, none of them
running a test; no git hooks. The whole suite ran only when a human typed it, on
a package that publishes to npm and whose instructions land verbatim in a
model's system prompt. Found by fire-testing, not by reading: four of this
release's own messages were reverted to their old wording, 32 lines deleted, and
the suite stayed green — then a grep showed it would not have mattered either
way.

`test.yml` now runs typecheck and tests on every push and pull request, across
**three timezones**. Not a stylistic choice: the naive-timestamp fix below is
invisible under `TZ=UTC`, which is exactly what a runner defaults to, so a
UTC-only job would have shipped that bug green.

The suite also grew from 60 tests to 279 (the number in this paragraph was
written as 116 while the count was 119, then the naming fix added 70 more, then
the harness below replaced 17 and added 41, then the knowledge fix added 28, then
the assembled-answer file added 38 — a countable claim nobody was counting), and
the ones that mattered most were replaced rather than added to.
The wire contract is now pinned by calling the real body builders
(`src/requests.ts`) and comparing against 0.8.0's bodies for every domain shape —
whitespace, non-breaking and zero-width spaces, padded room addresses. The guard
it replaced was a regex asserting the ABSENCE of a `trim()`, which cannot catch a
DELETED coercion — and a deleted coercion is what shipped. Both sabotages now
fail loudly: removing `|| undefined` breaks 3 tests, adding a trim breaks 6.

### Added — the copy is now tested by CALLING the tools

The gate above still could not reach the sentences it was guarding. `src/index.ts`
opened a stdio transport at import time, so importing it from a test started a
server on the runner's stdin and stdout instead of handing back a handler — and
every user-visible sentence in this release was therefore protected, at best, by a
regex over the source of that file. That is why three review rounds each found
false sentences in the fix itself, and why two of the guards written against them
turned out to be theatre.

A source assertion can only say "this string appears in this file". It cannot say
which branch prints it, whether that branch is reachable, what the rest of the
sentence says, which probe was consulted to justify the claim, or whether the
value interpolated into it is the value that was searched. Every defect in this
release lived in one of those gaps.

`test/harness.ts` connects a real MCP client to the real server over the SDK's
in-memory transport and stubs the HTTP layer, so a test calls a tool by name and
reads the text a user would read. An UNSTUBBED request fails the test rather than
quietly taking a fall-open path — several handlers swallow probe failures on
purpose, so a forgotten stub would otherwise move an assertion onto the "we could
not check" branch while it still read like the "there is none" branch, which is
the confusion this whole release is about.

The two test files that read `src/index.ts` as text carried 41 tests between them;
they now carry 29, and `test/tool-wiring.test.ts` no longer reads the source at
all — its parameter list comes from `tools/list`, as a model sees it, and its
values come out of the request the handler actually sent. 53 behavioural tests
live in `test/handlers.test.ts` and `test/startup.test.ts`. What stays a source
assertion is labelled in place with the reason no call can establish it (chiefly
the "never" rules: no handler sends a name the reader must reproduce through the
lossy sanitiser, and none normalises a domain).

Among the things that now have a test for the first time: that a room address is checked
against the ROOM list and never against `memory_stats` (the false-absence claim
CodeRabbit found reintroduced by the fix); that the first-contact greeting is
decided AFTER the room probe, so a rooms-only account is never told nothing was
ever saved; that a failed room probe is treated as neither evidence nor silence;
that the escape legend appears at most once in an answer assembled from two notes;
and that a parameter reaching the wire under the right key carries the right
VALUE, which the previous tripwire could not see at all. Each of these was
fire-tested: eleven separate sabotages of `src/index.ts` and `src/requests.ts`,
every one caught, each by the test that names it.

One thing still had no test: the CONCATENATION. Every clause above is checked on
its own, and the defects a review kept finding were in the joins — a sentence
telling the reader they were caught up followed by one explaining that the first
was meaningless, a head promising "that is not the whole picture:" with nothing
after the colon, a first-contact greeting printed above an admission that the room
list could not be fetched. Each individual clause in those answers was true.
`test/assembled.test.ts` therefore asserts PROPERTIES of the finished string, over
34 situations — the ones named in the incident and the ones only the matrix
reaches: no absence claimed beyond the scope that was searched, nothing left
dangling, one emptiness explained once, every named store reproducible
byte-for-byte, and generic advice never standing in front of a specific diagnosis
(an admission is not a diagnosis and is exempt). Five sabotages, five RED runs:
advice put back in front of the name diagnosis (5 failed), the sanitiser back on
the searched name (1), the greeting made reachable on an unanswered room probe (4,
including the cross-situation check that exactly ONE answer may say the memory has
never been written to), the disclosure dropped from behind the colon — the live
bug's exact shape (3) — and an admission APPENDED to a definitive claim instead of
replacing it, which is the move this release made twice before it was caught (3).

There is no change to what the published CLI does. The seam is one strict check —
`MNEMOVERSE_MCP_NO_AUTOSTART === "1"`, set only by the harness — and it defaults
to today's behaviour. Deliberately NOT the usual `import.meta.url ===
process.argv[1]` idiom: under `npx` the thing on argv[1] is a generated shim, on
Windows a `.cmd` wrapper, so that comparison would be false for real users and
would fail by starting no server at all, silently. `test/startup.test.ts` pins the
default and the narrowness across nine cases, by mocking the transport class and
counting how many the module opens: inverting the check, widening it to a truthy
test, and replacing it with the entry-point idiom each fail it.

### Fixed in the second review round

- **The lying sentence was still there.** `"Nothing new since your watermark."`
  went untouched through two passes — the exact sentence `src/scope.ts`'s header
  names as the failure that cost two agents a day. A note had been appended to
  it instead, so the answer read as two voices: one saying you were caught up,
  the next saying that claim was meaningless. The scope is now **inside** the
  clause ("Nothing new in your own domains since your watermark"), which is what
  the sibling branch in `memory_read` had been doing correctly all along.
- **The revert had moved a read.** Restoring 0.8.0's send behaviour dropped
  `|| undefined` on `memory_read`, so `domain: ""` became `WHERE domain = ''` — a
  store that cannot exist — turning a search of every domain into a guaranteed
  miss. Core filters on `domain is not None`, not on truthiness.
- **A trimmed copy for wording desynced from the value searched.** A read on
  `" engineering"` searched the padded store but checked `"engineering"` for its
  diagnosis, found it, and stayed silent — suppressing the one note that says a
  stray space makes a different store, precisely when a stray space had. For a
  whitespace-only domain it went the other way and claimed the search had
  covered the caller's own domains when it had covered none. There is now one
  value, used for the request and for every statement about it.
- **Generic advice preceded the specific diagnosis.** "Try a broader query, or a
  different domain." printed first, then "that is not the same store as X, which
  does exist" — so a model reading top-down went off to widen a query against a
  store that does not exist. A diagnosis now replaces the advice rather than
  following it.
- **The greeting fired on a failed probe.** Rooms were treated as existing
  whenever the room note was non-empty, and the failure branch returns a
  non-empty note — so a genuinely new account whose first read coincided with a
  `/memory/rooms` blip was told "that is not the whole picture" on no evidence,
  and lost the one message that teaches how to save a first memory.
- **Three claims were withdrawn rather than repaired**, because they did not
  work: quoting domain names in `memory_stats` (the sanitiser trims whitespace
  before the quotes go on, so `" engineering"` and `"engineering"` print
  identically — and a note pointed readers there to verify); the archived-rooms
  count (core hides archived rooms from the member query entirely, so it only
  ever rendered for owners — not the reader this release is about — and it
  promised recovery "until it is unarchived" when core has archive with no
  inverse); and the `NOT STORED` prediction that "rewording will score the same
  or lower", which is probably backwards, since novelty falls as similarity
  rises. Of the three, the first TWO were later done properly rather than left
  withdrawn — see "a name is printed exactly, or not at all" and "unknown is not
  the same as none" below. Only the third stands withdrawn. The archived-rooms
  claim came back in a different place: not as a count beside a list of readable
  rooms (both objections above still hold there), but as its own sentence for the
  state where EVERY room is archived — where staying silent is not available,
  because it either dangles a colon or lets the answer claim the memory is empty.
- **`NOT STORED` no longer states a cause it cannot see.** A live surface answers
  `{"stored":false}` with no reason and no score; the mechanism is now named only
  when the server named it.
- **Smaller ones:** the feedback zero-branch dropped an invented frequency
  ("most often"); the neutral line stopped implying 0 leaves ranking alone,
  which this file's own comment forbids; the room boundary moved into the
  descriptions of `memory_feedback`, `memory_delete` and `memory_delete_domain`,
  where it is read *before* acting rather than confessed afterwards.

### Fixed after review — false statements the first draft introduced

Three adversarial reviews read every new string against the engine code. What
they found is listed here rather than quietly corrected, because the release is
about exactly this failure mode and the fix committed it thirteen times.

- **The first-contact greeting told a rooms-only account its memory was empty.**
  `total_atoms` counts the personal org only, so an invited teammate with three
  full rooms and no personal writes was greeted with "nothing has been saved
  yet" — and contradicted by the new scope note in the same payload. The
  greeting is now suppressed whenever unsearched rooms exist.
- **The future-watermark note was broken by timezones.** `Date.parse` reads an
  offset-less timestamp as LOCAL, while the tool descriptions and the engine
  both say naive means UTC. West of UTC it declared sane watermarks to be in the
  future and every clause was false; east of UTC it stayed silent for the case
  it exists for. It now parses as UTC, and attributes the clock to *this client*
  rather than to the server.
- **The NOT STORED advice described a gate that does not exist.** It told the
  caller to rewrite the content as a cleaner factual statement. The gate scores
  geometric novelty against the nearest existing memory — rejection means *too
  similar to something already stored* — so a rewrite scores the same or lower,
  and the text ended with "write it again", looping a compliant agent. Worst in
  the case it was written for: a correction is by nature similar to what it
  corrects. It now names the real mechanism and points at delete-then-write.
- **"The closest existing domain" was invented.** It named the first element of
  an unordered query result with any prefix relation, so it was not a nearest
  neighbour, could differ between identical calls, and let a one-character
  domain be the "closest" match for every name starting with that letter.
  Removed.
- **The domain hint lied about non-Latin names.** The sanitiser's charset is
  ASCII, so `"проект:acme"` rendered as `":acme"` and the note asserted facts
  about a name that exists nowhere. The immediate fix was to stay silent
  whenever sanitising would change the name — which silenced the most useful
  sentence in the module for an entire alphabet. It now NAMES the store, because
  the renderer changed; see below.
- **`memory_feedback`'s zero answer blamed deletion.** The tool takes no
  `domain`, and the engine defaults to `"general"` — so the ordinary way to get
  zero is rating atoms that live in a room. The atoms exist and the ids are
  valid; the message now says so.
- **Both destructive tools asserted absence they could not know.**
  `memory_delete` answered "No memory found with id X" for a room atom — and
  this release made room ids *more* visible, so an agent is more likely to bring
  one there, ask to forget it, and be told it never existed while it stays.
  `memory_delete_domain` answered "Deleted 0 memories from domain X", the shape
  of a successful wipe, when nothing matched. Both now state the boundary.
- **Archived rooms were hidden from the scope note.** They still hold content
  and reads of them are refused, so an agent hunting a lost memory saw "nothing
  found" plus "2 rooms unsearched", both empty, and concluded it did not exist.
  The counting clause written for this was withdrawn (see above) and the earlier
  drafts of this bullet claimed it had shipped. What shipped instead is narrower
  and lands where the defect actually bites: when EVERY room is archived, the
  answer says so and says what it means. In the mixed case the note still names
  only the readable rooms. See "unknown is not the same as none" below.
- **`memory_stats` hid whitespace in domain names.** Joining bare names made a
  leading space invisible — the exact defect that creates an unreachable store —
  so the check we point callers at could not reveal what it was for. Quoting was
  tried and withdrawn as a fix that wasn't one; the working fix is below.
- **`memory_write` printed `importance 0.00` for an unknown score**, the same
  `?? 0` lie fixed in `memory_stats` in this release.

### Fixed after review — a name is printed exactly, or not at all

One function was doing two incompatible jobs. `safeInline` is an anti-injection
SANITISER: it maps every character outside `[\w .@:+/-]` to a space, collapses
runs of whitespace, trims the ends and truncates. That is right for a value the
reader only looks at and never retypes — a room name chosen by its owner, an
agent name chosen by a connector. It is wrong for a value the engine matches
BYTE-FOR-BYTE, and every place this release names a domain was using it:

- `" engineering"` and `"engineering"` printed the same string. The `@domain`
  tag this release added exists to tell stores apart, and it merged the two
  stores that a stray space creates — the founding defect of the release,
  reproduced by the fix for it. Worse, `" general"` sanitised to `general` and
  was then SUPPRESSED as the default bucket, so a memory from a padded store
  rendered as if it came from the caller's own.
- `"проект:acme"` and `"план:acme"` both printed `@:acme`. Two stores, one
  output string, and a name that exists nowhere.
- `memory_stats` could not answer the question two tool descriptions send the
  reader there to ask ("confirm the exact domain name before a delete"), because
  the list was sanitised before it was printed.
- `memory_delete_domain` confirmed a wipe of `"project x"` when what was wiped
  was `" project x"` — a destructive confirmation naming the wrong store, one
  clause before telling the reader that names match byte-for-byte.
- `Nothing in "engineering" matches…` was a sentence about a store the search
  never touched, and a whitespace-only scope rendered as `""`.
- `Server reason: Below importance threshold (0.412 < 0.500)` — core's only
  rejection reason — was relayed as `Below importance threshold 0.412 0.500`,
  the comparison operator and both delimiters deleted from a quote whose label
  promises it verbatim.

Names now go through a second renderer (`src/names.ts`), which prints a value as
a **JSON string literal** or refuses to print it. `JSON.parse(literal) === value`
for every input — that is the contract, and it is asserted mechanically rather
than by sampling characters, because a renderer that satisfies it cannot merge
two names into one string. Quotes make padding visible; control characters,
zero-width characters, bidi overrides and no-break spaces become `\uXXXX`;
non-ASCII letters pass through, so a Cyrillic name stays itself. It is still
one line with no unescaped quote, which is what the injection surface needs.

Consequences worth stating plainly:

- **Nothing is truncated.** A cut name is not reproducible, so a name too long
  to print exactly is not printed: sentences fall back to "the domain you
  passed", the `memory_stats` list COUNTS what it could not name (dropping it
  would assert a store does not exist), and the `@domain` tag says the name is
  missing rather than disappearing — an absent tag means "the default bucket".
- **A `\uXXXX` escape appears only when one was needed**, and any answer that
  contains one carries a single closing clause explaining that the escape is one
  character and the quotes are not part of the name.
- **The non-Latin case-twin diagnosis works again.** It had been silenced for
  every name the ASCII sanitiser would rewrite; it now names both stores.
- **Room names keep `safeInline`, deliberately.** They are a different
  principal's string shown to this one, and reversibility is not their
  requirement.

### Fixed after review — unknown is not the same as none

The release's own thesis, applied to the place it was still broken: every probe
answered with a **string plus a boolean**, and a falsy string is how this client
spelled both "there is nothing" and "we could not look". Six false claims came
out of that one shape.

- **A `/memory/rooms` body that was not an array became an empty room list.** So
  a contract violation was reported to the reader as fact, three different ways:
  `memory_list_rooms` answered "You have no shared rooms yet"; a scoped read
  answered "That room is not in your list — either the address is wrong or you
  are not a member", a membership claim on no evidence; and an unscoped read
  dropped its scope caveat entirely, which is exactly the silence this release
  exists to end.
- **A 200 with no `domains` key became an empty domain list**, and then "No store
  has that exact name", definitively. Core's response model always carries
  `domains: list[str]`, so a missing key means the body is not core's — the one
  thing it cannot mean is that the store is absent.
- **A failed probe on a scoped read was spelled `""`** — byte-identical to "the
  store is there and your query merely missed".
- **The first-contact greeting was reachable on a FAILED room probe**, so one
  answer could say "your long-term memory is empty, nothing has been saved yet"
  and "the room list could not be fetched" in the same breath.
- **A dangling colon, and this one shipped.** The flag that gated the "That is not
  the whole picture:" line counted ALL rooms; the disclosure it promised was built
  from the LIVE ones. An owner whose only room is archived therefore received the
  colon and nothing after it — a promise of an explanation that had been filtered
  out one function earlier.

Fixed at the shape rather than at the sentences. A probe now returns a
discriminated union whose arms **are** the states — live rooms / only archived
rooms / no rooms / could not check — and the disclosure sentence is a FIELD on
that value, computed once, from the same arm it belongs to. The arm with nothing
to disclose has no `note` field at all, so pairing a colon-carrying head with a
missing disclosure is a **type error** rather than a convention; the same applies
to the scoped side, where "the store is there", "there is no store with that
exact name" and "we could not look" are three arms instead of one empty string. A
scoped read cannot carry room knowledge and an unscoped read cannot lack it,
because they are one value with two shapes rather than two parameters. Adding a
state without answering for it anywhere is a compile error.

Two smaller things fell out of it. The "not in your list" sentence no longer
offers only two causes: a room the caller merely JOINED disappears from core's
list the moment its owner archives it, so for exactly the invited teammate this
release is about, both stated causes were wrong. And a room record whose `name`
is not a string no longer reaches `safeInline`, which is `(s ?? "").replace(…)`
and would have thrown inside a renderer.

Fire-tested: ten sabotages of the four changed files, each caught, and the two
type-level guarantees checked by making the compiler reject them.

### Known and NOT fixed here

- **Cross-language recall is absent, not degraded.** Measured on production:
  an English query against English content scored a clean hit; a Russian query
  against Russian content ranked the right answer two points above the wrong
  one; an English query against the *same fact stored in Russian* returned
  **zero**. Core-side (English-only production embedder, ASCII-only concept
  extraction) — tracked for 0.9.
- No supersede/update semantics: a correction competes with the fact it
  corrects, and under ordinary phrasing the stale one can win.
- No batch write.
- The hosted claude.ai connector reports a rejected write as
  `{"stored":false}` with no reason, and has no delete tools at all.

## [0.8.0] — 2026-08-06

- `until` and `exclude_author` on the recent feed (#61, #62).

## [0.7.0] — 2026-08-04

- Temporal read parameters and `memory_list_recent`; results render ids and
  dates (#56, #59). Shipped on top of an unreleased 0.6.0.

## [0.6.0] — unreleased, folded into 0.7.0

- Rooms discovery, `vault_list`, and the teaching surface — server instructions
  where there had been none (#52, #57, #58). Manifest corrected to 11 tools.

## [0.5.0] — 2026-07-10

- Rooms MCP tools: create, invite, join (#50, #51).

## [0.4.2] — 2026-07-04

- Maintenance release (#47).
