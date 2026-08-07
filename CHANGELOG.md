# Changelog

All notable changes to `@mnemoverse/mcp-memory-server`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project is pre-1.0, so a MINOR bump may change behaviour and a PATCH is limited
to fixes that do not change what a call returns.

This file starts at 0.8.1. Entries for earlier versions are reconstructed from
the release commits and are deliberately terse — for anything before 0.8.1 the
git history and the GitHub releases are the record.

## [0.8.1] — unreleased

An honesty pass. Nothing in this release changes what a call **returns** — it
changes what the server **says**, in the places where it was saying something
untrue. Prompted by an incident and then by dogfooding the whole surface with
ten agents.

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
  and wasn't: there is no relevance floor, so a query about something never
  stored still returns the nearest neighbours — dogfooding got a real person's
  profile at "73%" for a question about someone fictional. It also wasn't a
  percentage of anything, since positive feedback pushes the score above 1.0 and
  reads showed "112%". Rank order still carries the ranking. A dependable
  signal is worth surfacing and is on the 0.9 list; this is a removal until
  there is one.
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
