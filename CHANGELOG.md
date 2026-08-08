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
- **Results carry their domain** (`@project:acme`). An unscoped search for a
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
  about a name that exists nowhere. It now stays silent whenever sanitising
  would change the name.
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
  They are now counted with an explicit "cannot be read at all".
- **`memory_stats` hid whitespace in domain names.** Joining bare names made a
  leading space invisible — the exact defect that creates an unreachable store —
  so the check we point callers at could not reveal what it was for. Names are
  now quoted.
- **`memory_write` printed `importance 0.00` for an unknown score**, the same
  `?? 0` lie fixed in `memory_stats` in this release.

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
