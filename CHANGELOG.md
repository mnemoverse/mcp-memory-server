# Changelog

All notable changes to `@mnemoverse/mcp-memory-server`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The
project is pre-1.0, so a MINOR bump may change behaviour.

**What counts as a PATCH here**, stated precisely because 0.8.1 needed the line
drawn — and restated because the first version of this paragraph forbade
something 0.8.1 then went and did.

A patch may change TEXT: what a tool returns, and what a tool or a parameter says
*about itself*. An MCP tool's output is text, and so is a description — both land
in a model's context and nowhere else — so a release that only fixes untrue
sentences is a patch even though every result line looks different afterwards.
0.8.1 rewrote five parameter descriptions and four tool descriptions on exactly
that reasoning.

A patch may add a READ-ONLY PROBE — an extra GET a handler consults so that a
sentence it prints can be true — and MUST say so in its entry. A probe changes
no stored state, but it is not free: reads spend rate budget even where they
are quota-exempt, so an undisclosed probe is a cost the caller pays without
being told. 0.8.1 adds such probes; the disclosure is in its entry below.

A patch may NOT change SHAPE or ROUTING: no tool added, removed or renamed; no
parameter added, removed, renamed, retyped, or made optional or required; no
annotation flipped; and nothing that moves data — a domain normalisation, a
default, a scope — however obviously correct it seems. The earlier wording said
"never a tool's input schema", which reads as forbidding the description strings
too, since a description *is* part of the published JSON schema. The line is
between the schema's SHAPE and its PROSE, and it is the shape that is frozen in a
patch.

This file starts at 0.8.1. Entries for earlier versions are reconstructed from
the release commits and are deliberately terse — for anything before 0.8.1 the
git history and the GitHub releases are the record.

## [0.8.1] — unreleased

An honesty pass. Every result line looks different afterwards, and nine
descriptions with them, but no data moves and no tool or parameter changes shape
— this release fixes places where the server was saying something untrue.
Prompted by an incident, then by dogfooding the whole surface with ten agents
(#64), then by adversarial reviews that kept finding false statements *inside the
fix itself*.

"No data moves" is true and incomplete without this: 0.8.1 ADDS READ-ONLY
PROBES. To say what an empty answer did not cover, the zero-result paths of
`memory_read` and `memory_list_recent` now consult `GET /memory/rooms` and/or
`GET /memory/stats` before answering. 0.8.0 probed nothing on a domain-scoped,
room-scoped or filtered read and nothing anywhere in the feed — only the plain
unscoped read probed stats. Now every zero-result answer probes once, and the
plain unscoped `memory_read` probes twice (the room list for the scope note,
stats for the first-contact greeting; the feed never greets, so it stays at
one). The request the caller asked for is byte-identical for every input, and
the probes are GETs under the same auth scope that change nothing and do not
count against the daily quota — but they are NOT rate-limit exempt, so against
the free tier's 60 requests/minute an empty read now spends 2-3 requests where
0.8.0 spent 1-2. Answers with results are untouched.

**How many, and where each number can be checked**, because a release about
unverifiable claims is in no position to make one. Round one found **thirteen**;
they are the ten bullets under "false statements the first draft introduced" —
where the two destructive tools share a bullet and count as two — plus the
`domain`-trimming revert described in the next paragraph, and the withdrawn "no
relevance floor" claim, which is corrected in "Changed" rather than listed as a
bullet. Round two is the **eight** bullets under "Fixed in the second review
round" — and not all of them are one statement each: one groups three smaller
fixes, and one groups three claims withdrawn rather than repaired. A later
inventory read every string in the client against the engine source and found
**six** places where a name was printed by a renderer that could not reproduce it
("a name is printed exactly, or not at all", six bullets) and **seven** false
claims produced by a single probe shape ("unknown is not the same as none", five
bullets, of which the first lists three).

One thing was cut for exactly that reason: an earlier draft trimmed whitespace
off `domain` before sending it. It looked like a pure win — names match
byte-for-byte in the engine, so `" engineering"` opens a permanent second store.
But core deliberately rejects a non-canonical room address, so trimming
`" xroom:room_01ABC"` normalised past that guard and the write would have landed
in the **room's** store, visible to every member, where 0.8.0 hard-failed. It
also silently relocated padded personal domains while `memory_delete_domain`
kept sending the raw name.

The revert is enforced, the return is not scheduled. What holds today is
`test/requests.test.ts`, which compares every send path against 0.8.0's bodies for
padded, non-breaking, zero-width and room-address domains — a coercion cannot be
deleted again without failing. What normalisation should look like when it comes
back (`memory_delete_domain` included, room addresses exempt, zero-width
characters handled — `trim()` does not strip those) is written down here and
**nowhere else**: it is not on the 0.9 issue (#64) and has no issue of its own, so
"returns in 0.9.0" would be a promise with nothing behind it.

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
- **A future `since` is named as such**, with **this client's clock** — not the
  server's, which this client cannot read. It used to read exactly like "you're
  caught up". The first draft of this bullet and of the note itself said "the
  current server time"; that was corrected during review and a test now forbids
  the phrase (see "Fixed after review" below).
- **A CASING slip is distinguished from an empty store.** Domain names match
  byte-for-byte, so `"Project:Acme"` silently opens a second permanent store
  beside `"project:acme"`. An empty scoped read says "that is not the same store
  as X, which does exist" — under two conditions, both narrower than this bullet
  originally claimed: a known domain must differ from the one searched **in case
  only**, and both names must be printable exactly (they now are for any name the
  engine can hold, including Cyrillic — see "a name is printed exactly"). A twin
  that differs by a space or a zero-width character is NOT diagnosed; that read
  gets the name-free "No store has that exact name", and the gap is listed under
  "Known and NOT fixed here".
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
  signal is worth surfacing (#64) and depends on core growing a usable floor
  first (mnemoverse-core#449); this is a removal until there is one. (An earlier
  draft of this entry claimed there was NO floor. There is one — it is simply too
  low to ever mean "I don't know".)
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

The suite grew from **31 tests at 0.8.0 to 279**, and the ones that mattered most
were replaced rather than added to. Every number in that sentence is reproducible
— `git archive <ref> | tar -x -C tmp && (cd tmp && npx vitest run)` — and here is
the whole curve, measured that way: `main` **31**, the commit before the gate
**60**, the gate itself **116**, then **119**, **189** after the naming fix,
**213** after the harness (which replaced 17 tests and added 41), **241** after
the probe-state fix, **279** with the assembled-answer file.

Two corrections to this paragraph's own history, kept rather than swapped, because
the release is about the habit of swapping them. It said the suite "grew from 60
tests": 60 is a mid-branch count taken at the commit that wrote the sentence, not
0.8.0's, which is 31. And it said the "116" it once carried had been wrong at the
time — it was not; 116 was exact when written and went stale three tests later.

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
  rises. What became of each, since "withdrawn" did not stay true for two of
  them: the FIRST was later done properly — `memory_stats` prints exact literals
  now, so the check a note pointed at can answer (see "a name is printed exactly,
  or not at all"). The SECOND came back only in part: not as a count beside a list
  of readable rooms, where both objections above still stand, but as its own
  sentence for the state where EVERY room is archived — where staying silent is
  not available, because it either dangles a colon or lets the answer claim the
  memory is empty. In the mixed case archived rooms are still unmentioned, which
  is listed under "Known and NOT fixed here". The THIRD stands withdrawn and is
  not coming back; the shipped `NOT STORED` message predicts nothing about a
  retry.
- **`NOT STORED` no longer quotes a verdict nobody gave.** A live surface answers
  `{"stored":false}` with no reason and no score, and the first draft asserted a
  specific rejection anyway. The server's reason and the novelty score are now
  printed only when the server sent them. Precisely what stayed unconditional:
  the sentence naming the *mechanism* — writes are gated on what a memory adds
  over the same domain — because that is a statement about core, not an inference
  from this response. `/memory/write` refuses for exactly one reason (two branches
  in the engine, both "Below importance threshold"); the batch endpoint has other
  failure paths, and this client does not call it. An earlier version of this
  bullet said "the mechanism is now named only when the server named it", which
  described a draft that did not carry that sentence at all.
- **Smaller ones:** the feedback zero-branch dropped an invented frequency
  ("most often"); the neutral line stopped implying 0 leaves ranking alone,
  which this file's own comment forbids; the room boundary moved into the
  descriptions of `memory_feedback`, `memory_delete` and `memory_delete_domain`,
  where it is read *before* acting rather than confessed afterwards.

### Fixed after review — false statements the first draft introduced

Three adversarial reviews read every new string against the engine code. What
they found is listed here rather than quietly corrected, because the release is
about exactly this failure mode and the fix committed it thirteen times — the ten
bullets below, counting the destructive-tools bullet as the two tools it names,
plus the `domain`-trim revert described at the top of the 0.8.1 section and the
"no relevance floor" correction under "Changed".

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
  similar to something already stored* — so rewriting the same fact does not
  address what was measured, and the text ended with "write it again", looping a
  compliant agent. Worst in the case it was written for: a correction is by nature
  similar to what it corrects (mnemoverse-core#450). The shipped message names the
  real mechanism and asks for what is DIFFERENT rather than a restatement. Two
  things this bullet used to claim and no longer does: that "a rewrite scores the
  same or lower" — asserted as fact, probably backwards, and withdrawn in the
  round above — and that the message "points at delete-then-write", which was
  removed before shipping because the blocking memory can be a room atom that
  `memory_delete` cannot touch. There is no such advice in the text.
- **"The closest existing domain" was invented.** It named the first element of
  an unordered query result with any prefix relation, so it was not a nearest
  neighbour, could differ between identical calls, and let a one-character
  domain be the "closest" match for every name starting with that letter.
  Removed. The function kept the name `nearestDomainNote` for the rest of the
  release and is now `noSuchDomainNote`, after what it actually builds: the
  disclosure for the "no store with that exact name" state, which either names an
  exact case-insensitive twin or names nothing at all. Nothing in it searches for
  a nearest anything.
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
- **Room names moved to the exact renderer too** — a follow-up inside this
  release; an earlier draft of this entry kept them on `safeInline` as "a
  different principal's string" whose reversibility was not a requirement. The
  sanitiser did not make hostile names harmless so much as it made ordinary
  names WRONG: two live rooms named "проект" and "план" both rendered
  "(unnamed room)" in the note that asks the reader to pick one, "Zoë" was
  quoted as "Zo" in sentences presenting it as the name, and
  `memory_create_room({name: "проект"})` echoed `Created shared room ""`. The
  exact literal is single-line with quotes, backslashes and invisibles escaped,
  so the anti-injection property survives the change. A name too long to print
  is DECLARED unprintable — never renamed, and never "(unnamed room)", which is
  reserved for a genuinely absent or empty name. On the same pass, the
  `memory_list_rooms` line for an `[archived]` room stopped saying
  `use domain="…"` — core refuses every read of an archived room with a 403, so
  that clause instructed a call that cannot succeed; the address stays visible,
  with that fact beside it.

### Fixed after review — unknown is not the same as none

The release's own thesis, applied to the place it was still broken: every probe
answered with a **string plus a boolean**, and a falsy string is how this client
spelled both "there is nothing" and "we could not look". Seven false claims came
out of that one shape — five bullets, the first of which lists three. (This
paragraph said "six" and did not add up.)

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

A follow-up inside this release reached the last family the substitution had:
the RESULT ARRAYS themselves. `Array.isArray(x) ? x : []` turned a 200 whose
body did not carry the array core always sends into an empty listing, and the
empty listing into a sentence about the world — `memory_read` and
`memory_list_recent` fed such a body to the whole zero-result machinery (head
sentence, scope probe, diagnosis), and `vault_list` answered "No secrets are
stored in your Vault yet.", an absence claim about the Vault derived from a
body this client could not read. All three now answer the way the room list
already does — the body came back in a shape this client does not recognise,
which is not evidence of absence — and a genuinely empty array answers exactly
as it did before. On the same pass the three tools no test had ever invoked
(`vault_list`, `memory_create_room`, `memory_invite_to_room`) got behavioural
tests through the harness; until then, hard-coding `vault_list`'s list to `[]`
left the whole suite green.

### Fixed after review, wave 3

A third adversarial wave ran over the finished branch. One line per theme; two
of them — the room-name renderer and the unreadable-body guards — are the
follow-ups already described at length in the sections above.

- **Feed head honesty.** The feed's empty head was selected by `since` alone,
  so `until` or `exclude_author` on their own produced "No memories in … yet."
  — an emptiness claim about a store the filters merely narrowed. The head is
  now chosen by EVERY filter that narrowed the window, and an empty CONTINUED
  page (a cursor was passed) speaks about the continuation, never the store.
- **Room names print exactly, or not at all.** Two live rooms named "проект"
  and "план" both rendered "(unnamed room)"; room names moved to the
  exact-literal renderer, and an archived room's list line stopped instructing
  the read core refuses with a 403 (see "a name is printed exactly").
- **Gloss corrections.** Four sentences described a nicer engine than the one
  that ships: the truncation hint recommended shrinking `top_k` (not a cap, by
  this release's own description); the feedback-zero line described a neutral
  record the engine does not keep; "Hebbian edges" was glossed as links
  between memories when core counts concept-concept links; and
  `memory_delete`'s miss asserted a room atom "still exists", which this
  client cannot know — it now claims only the boundary.
- **Legend-vs-cap ordering.** The escape legend was appended before the size
  cap, and the cap truncates from the end — so exactly the pages long enough
  to need the legend lost it. It is applied to the capped text now, and a cap
  that removes every escaped name drops the legend with it.
- **Vault/items shape guards.** A 200 whose body lacks the array core always
  sends stopped rendering as an empty list: `memory_read`, the feed and
  `vault_list` answer "unreadable", never "absent" (the follow-up above).
- **Description tests.** Every advertised tool and parameter description is
  pinned through `tools/list`; inverting or deleting one now goes red.
- **The gate itself.** Request bodies are compared SERIALIZED, so
  byte-identical is what is asserted, not deep equality; the feed's bare-404
  guard is pinned from both sides; the eastern CI leg moved to Asia/Tokyo,
  because Europe/Lisbon is UTC+0 from late October to late March and left the
  future-watermark diagnosis unguarded east of UTC for five months; and
  `test/` itself is now typechecked (`tsconfig.test.json`,
  `npm run typecheck:test`, a CI step) — closing the gap an earlier version of
  this entry recorded under "In this repository".

### Known and NOT fixed here

Complete as of this release, including the things the fix itself deliberately left
alone. Each entry says what is not known or not done, not merely that something is
"limited"; where a gap has an issue, the issue is named, and where it has none,
that is said too.

#### In the engine — behaviour this client can only describe, not repair

- **Cross-language recall is absent, not degraded** (mnemoverse-core#448).
  Measured on production, one domain, one minute apart: an English query against
  English content scored a clean hit; a Russian query against Russian content
  ranked the right answer two points above the wrong one; an English query against
  the *same fact stored in Russian* returned **zero**. Causes are core-side
  (English-only production embedder, ASCII-only concept extraction). The connector
  cannot detect it, so a silo reads exactly like a genuine absence.
- **There is a relevance floor and it is too low to mean anything**
  (mnemoverse-core#449). `min_relevance` defaults to 0.3, so a query about
  something never stored still returns near-neighbours at scores indistinguishable
  from real hits. This is why 0.8.1 removed the percentage rather than explaining
  it; a signal worth showing depends on core growing a usable floor first. Related
  and also unfixed: `top_k` is not a bound (the same query at 1 / 5 / 20 returned
  6 / 7 / 4 items) and relevance exceeds 1.0 after positive feedback.
- **The importance gate silently rejects corrections, and its scoring is
  incoherent** (mnemoverse-core#450). A correction is phrased like its target and
  therefore scores as a near-duplicate; the stale fact stays as the sole record.
  Measured beside it: `"ok"` was stored at importance 0.44, above two substantive
  project facts. 0.8.1 makes the rejection loud (`NOT STORED`) and can do no more
  than that.
- **Archived rooms are invisible to a member, and nothing here reopens one.** Core
  filters `is_archived = FALSE` out of the member query and hard-codes
  `archived=false` on joined rows, so a member of an archived room cannot see it in
  any list. 0.8.1 speaks only in the state where EVERY room the caller has is
  archived; in the MIXED case the scope note still names the readable rooms and
  says nothing about the archived ones, for the two reasons recorded in
  `src/scope.ts` (that clause only ever rendered for owners, and it promised a
  recovery that does not exist). Archiving has no inverse anywhere in the data
  plane, this client or the portal, so the sentence deliberately offers no way
  back. No issue filed for the member-visibility asymmetry.

#### Surface this connector does not have yet — waiting for a MINOR (#64)

- **No batch write.** Eight decisions in one conversation is eight round trips,
  each demanding a content/domain/concepts decision. The single most requested fix
  from the dogfood.
- **No supersede/update semantics.** There is no update verb: a correction becomes
  a competing atom, and under ordinary phrasing the stale one can win (measured:
  53% vs 52%; at `top_k: 1` the stale one alone). Needs core#450.
- **No room fan-out.** 0.8.1 makes an unscoped read *say* it did not cover rooms.
  It still does not cover them: there is no single call meaning "what's new in any
  room I'm in". Rooms are separate tenants, so this is cross-tenant querying with
  per-room access checks and cursors across orgs — plus a product question about
  whether room traffic should land in a personal feed at all.
- **Hosted claude.ai connector parity.** That surface reports a rejected write as
  `{"stored":false}` with no reason, never shows a score, caps content at 5,000
  characters against 10,000 here, uses `memory_ids` where this uses `atom_ids`, and
  **has no delete tools at all** — 10 tools against the 12 registered here.
  Storage is provably identical; the two front doors are not. Owned by neither this
  repo nor core.
- **`memory_stats` lists every domain with no counts and no filter** (~55 on the
  dogfood account, spanning unrelated projects). Two agents called it unhelpful.
  Per-domain counts need core.
- **`exclude_author` takes a value this tool set cannot supply.** The parameter
  reaches the engine correctly and works if the caller knows a `principal` from
  somewhere else (the REST API), but no tool here ever renders one — `render.ts`
  deliberately never prints it, since it may be an email — so a model working from
  these results has nothing to pass, and a guess like `"me"` filters nothing,
  silently. 0.8.1's fix was to say exactly that in both descriptions; the
  parameter stays, because removing it is a schema change.
- **Domain normalisation is not scheduled.** See the trim revert at the top of this
  section: the plan exists only in this file, with no issue.

#### Sentences this release did not make honest

Each of these was reached during the release, examined against the engine, and
left — because the fix changes behaviour rather than wording, or because the
obvious fix would introduce a different false claim. They are listed so the next
release does not have to find them again.

- **A count that is missing is still rendered as zero, and zero as an absence
  claim.** Four sites: `memory_feedback`'s `updated_count ?? 0`, which answers
  "none of those ids matched a memory in your own domains"; `memory_delete`'s
  falsy `!deleted`, which answers "Nothing was deleted"; `memory_delete_domain`'s
  `deleted ?? 0`, which answers "NOTHING was deleted"; and `memory_read`'s
  `search_time_ms ?? 0`, which prints a fabricated `(0ms)`. Core sends all four
  fields today, so none is reachable through core — but `apiFetch` converts a 204
  or an empty body into `{}`, and its own note records that FastAPI DELETE handlers
  may switch to 204, at which point a successful delete would report that nothing
  was deleted. This is the defect `memory_stats` and `memory_write` fixed in this
  release, left standing on the three surfaces that turn the zero into a
  *sentence* — where it is worse, because a wrong number is not a claim about the
  world and "NOTHING was deleted" is — and on the one that prints it as a
  measurement.
- **`(end of feed — nothing older)` also means "there is more and I would not
  print the cursor".** The end-of-feed line is chosen by one boolean that folds
  "the server sent no cursor" together with "the server sent one that failed the
  shape check". Could-not-render spelled exactly like does-not-exist — this
  release's own subject, in the one place it did not reach. A third branch needs a
  third sentence.
- **A bare 404 on `/memory/recent` is reported as a deployment fact.** The message
  says the service "does not support the recent-entries feed yet". Engine 404s
  carry an error `code`, so a real room-404 is excluded, but a gateway, a proxy or
  a wrong `MNEMOVERSE_API_URL` produces the same bare 404 and is indistinguishable
  from here. The boolean was renamed to `bare404` so the code stops asserting it;
  the sentence still does.
- **Room addresses are printed through the lossy sanitiser.** `safeInline` is
  what room addresses, roles, scopes, vault aliases and author tags still get
  (room NAMES left it in the room-name fix above: printed exactly, or declared
  unprintable). An address is different in kind even from those: the note
  *instructs* the reader to send it back. Divergence is unreachable today — core mints `room_<ULID>` and
  400s any non-canonical spelling, and vault aliases are charset-validated — and
  nothing in this repo pins that. The correct pattern is validate-then-print-raw,
  but the existing fallback then says "the server did not return a usable address",
  which would become a NEW false claim when the server returned one and this client
  refused it. So the fallback has to change with it.
- **`memory_delete` prints the caller's `atom_id` raw.** A padded or newline-
  bearing id lands unrendered in the diagnosis of a miss whose cause may be that
  very padding. The fix is the same exact-literal renderer the domain names now
  use.
- **`memory_delete_domain` names whatever the server echoed.** It prints
  `r.domain` and falls back to the value sent. Core echoes the path parameter, so
  the two agree today; a server that echoed something else would have a
  destructive confirmation name a store the caller never passed, one clause before
  telling them names match byte-for-byte.
- **"check that your API key is set" is offered where no key means no response.**
  Both room handlers suggest it when the server returns no usable address —
  reachable only after a 2xx, and `apiFetch` throws before sending anything when
  the key is missing. The advice points at a condition that cannot hold.
- **`vault_list` claims an absence over an incomplete scope.** "No secrets are
  stored in your Vault yet" is derived from a list route that skips every
  secret-atom without a reachable `secret:{alias}` external ref, so an account
  whose secrets were stored by another path is told it has none. The count in the
  populated case understates for the same reason.
- **The future-watermark note claims a frequency.** "a timezone slip is the usual
  cause" is a statistic this project does not have — the same class as the "most
  often" deleted from `memory_feedback`'s zero branch in this release, left
  standing on the other surface.
- **The case-twin diagnosis covers case only.** A read on `" engineering"` while
  `"engineering"` exists gets the name-free "No store has that exact name", not a
  padding-twin diagnosis. Extending the rule to whitespace and zero-width
  characters is a behaviour decision; `memory_stats` now closes the loop by
  printing both names exactly.
- **The `memory_stats` pointer was not restored to that diagnosis.** It was cut
  because the surface could not answer; it can now, and re-adding the pointer is a
  copy decision nobody has made. Its absence stays pinned by a test so it cannot
  drift back unnoticed.
- **A room with neither `role` nor `scope` renders an empty parenthetical** —
  `- "last-quarter" () [archived] — …`. Cosmetic; asserts nothing false.

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
