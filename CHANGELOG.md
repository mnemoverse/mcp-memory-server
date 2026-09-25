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

**What a MINOR may do to the tool surface** (stated 2026-09-13, after a reader
asked to diff a saved `tools/list` against a live one): add tools and add
annotation fields, each with its own line here. It may not remove or rename a
tool or a tool's input parameter, and it may not drop, rename or silently flip a
declared annotation field. A removal or a rename, of a tool, a parameter or an
annotation field, is announced one MINOR ahead (the tool or parameter stays and
its description says `deprecated since x.y, removed in x.z`; a rename also names
the old and the new name) and lands only in the announced version. A renamed
parameter is accepted under both names until then, and a renamed annotation
field is declared under both names until then, since a MINOR may add a field but
not remove one. (Parameters were added to this rule on 2026-09-21, with the
first parameter rename, so that it and the README say the same thing.) A MINOR
may also add an output schema (`outputSchema`, with `structuredContent`
returned alongside the same text) to a tool that did not have one; once
declared, that schema's fields are add-only under this same rule. `tools/list`
is therefore frozen per released version, and
two servers of one version that differ are a bug. The README section "Tool
surface stability" is the reader-facing statement of the same rule.

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

## [Unreleased]

### Fixed

- **A 403 for a missing scope is explained as a scope refusal, not as a room
  problem.** When the engine's 403 message names a scope in the vocabulary
  core and the hosted connector use (`Token lacks memory:write scope`, `the
  token lacks the memory:write scope`; a write with a read-only token is how
  the connector refuses a write on the package's surface at step 4 of
  ADR-025), the explanation says the credential identified the account but
  does not carry a scope the call needs (the usual "is NOT the problem"
  opening would contradict that, so this one 403 opens differently), that
  reading still works when the missing scope is the write scope and the read
  scope is not named too, and what to do (re-authorize with write access, or
  with the access the call needs, under `auth: "oauth"`; use a key that has
  it under api-key). Before this, such a 403 fell through to the generic
  sentence, which guesses "most often the room it addressed" and points at
  `memory_list_rooms`, a wrong cause stated confidently. The room causes keep
  precedence: room membership is itself called a scope on this surface, so a
  room refusal that says "scope" keeps its room diagnosis, and the bare word
  "scope" alone is not a scope refusal. Core's other scope sentence, `Route
  has no scope policy; denied by default`, is a gap in the server's own
  configuration, not a credential problem: it gets its own diagnosis, which
  asks nothing of the credential and tells the agent to report exactly what
  was refused. Text only, no shape change: PATCH by the rule above.

## [0.12.0] — 2026-09-25

### Added

- **`MemoryToolDeps` gains two optional dependencies, `wording` and
  `writeAuthor`, for a second server registering these tools (STEP4-2/3/5,
  owner 2026-09-24).** Both default to exactly this package's existing
  behaviour: a consumer supplying neither gets byte-identical descriptions,
  error text and write bodies to every release before this one, which the
  full existing suite proves unchanged.
  `wording: { serverNoun?, auth?, keysUrl?, rawDetail? }` lets a second
  server speak in its own voice. `serverNoun` ("this server" default vs
  "this connector") is substituted into the three tool descriptions that
  name the server (`memory_read`'s `top_k`, `memory_feedback`'s
  `coactivation_edges`, `vault_list`). `auth: "oauth"` rewords every
  401/403 explanation for a caller who never holds an API key at all (a
  hosted connector minting one on their behalf): no explanation under this
  mode names `MNEMOVERSE_API_KEY`, an environment variable, an MCP client
  config file, the keys console, or a key at all (the 403 room-permission
  causes speak about "this account" rather than "this key", and the opaque
  403 declines to blame "the sign-in"), and each says what an OAuth user
  can actually do instead (reconnect, sign in again); the per-minute 429
  likewise says "this account is hitting its rate limit" rather than "this
  key" under oauth, and the quota and unknown 429 sentences never named the
  credential. The 404, 409, 422/400, 5xx, network and unreadable-body
  explanations are
  unchanged under either mode; where they mention a key it is only to rule
  it out as the cause.
  `keysUrl` replaces the console URL the api-key vocabulary prints,
  overridden by the engine's own validated `details.keys_url` when core
  sends one. `rawDetail` (default `true`) is the STEP4-3 flag held in
  reserve to drop the raw wire-body tail from an explanation, shipped now
  and set to `false` only once a specific deployment's error envelopes are
  checked and found to echo request content back in `details`. The three
  error classes (`ApiError`, `NetworkError`, `UnreadableBodyError`) accept
  the same optional `wording` as a second constructor argument, and
  `registerMemoryTools`/`registerMemoryResources` apply `deps.wording` to
  every one of them that `apiFetch` rejects with, so a consumer states its
  wording once: each class gains a `withWording` method that re-renders the
  same failure under another wording, `ApiError` now carries `retryAfter`
  and `UnreadableBodyError` its `bodyPreview` so nothing is lost in that
  re-rendering, and a rejection of any other type passes through untouched.
  `writeAuthor: () => WriteAuthor | undefined` is called once per
  `memory_write`; a returned value is sent as the request body's `author`
  field exactly as returned (no normalisation beyond a `typeof` guard;
  core re-normalises server-side). `WriteAuthor` mirrors core's
  `ProvenanceWriteSchema` field for field (`principal`, `agent`,
  `agent_name`, `client_env`, `is_external`, all optional); core honours
  `author` only for a SERVICE/supplier caller and silently ignores it for
  an OIDC end-user (`mnemoverse-core src/mnemo/api/routes.py:211-276`,
  `_get_provenance`, verified 2026-09-24), so this dependency is useful
  only to a server vouching for someone else, not to an end-user's own
  key. The stdio server supplies neither dependency, and its own requests
  do not change. `Wording` and `WriteAuthor` are exported from `/shared`.
  Full contract and the exact sentences `auth` switches: `docs/shared.md`,
  linked from the README's `/shared` paragraph.

- **`MAX_RESULT_CHARS` and `capResult` are exported from `/shared`.** Both
  already existed in `src/tools.ts`; this slice makes them a named export of
  the shared entry point (ADR-025), alongside the existing tool/prompt/resource
  exports. `MAX_RESULT_CHARS` is the hard cap on a tool result's text, 96,000
  characters (24,000 tokens), unchanged by this slice, and `capResult` is the
  helper that applies it, truncating on a code-point boundary (never inside a
  UTF-16 surrogate pair) and appending the truncation notice, so a consumer does not have to re-implement
  a `slice` that can cut a surrogate pair. `structuredContent` stays uncapped
  (OD-11). This is the handoff for a later step in which the hosted connector
  (`mnemoverse-mcp-remote`) adopts this export in place of its own
  `src/constants.ts` `CHARACTER_LIMIT = 25000`; that adoption is not part of
  this slice, and the connector's literal is untouched here. The notice text
  itself is unchanged, so every existing truncation-notice assertion still
  pins the same string, and so is the cut for every hint this package passes
  (the 200-character reserve); a consumer's hint longer than that reserve
  widens the reserve instead of pushing the result over the cap, and a hint
  is bounded at 1,000 code points.
- **`memory_list_rooms` and `vault_list` declare output schemas and return
  `structuredContent` alongside their unchanged text.** `memory_list_rooms`
  returns `{rooms: [{room_id, name?, address, role, scope, archived}]}`;
  `vault_list` returns `{secrets: [{alias, context, concepts}]}`. Field names
  and descriptions are copied from the connector's own `roomListOutput`/
  `vaultListOutput` (mnemoverse-mcp-remote), field for field and description
  for description.
  **OD-14** (owner, 2026-09-23): `memory_list_rooms`'s room `name` is OPTIONAL
  here though the connector marks it a required `z.string()`, and so is
  `scope`, for the reason OD-13 gave on `memory_join_room`: the text already
  has a supported state for a membership whose write access core did not
  report, and a required field would turn it into an SDK validation error. `structuredText`
  returns `undefined` for a genuinely empty or absent name, and that is a
  real, already-tested outcome ("keeps '(unnamed room)' for a genuinely
  absent or empty name"), forcing it through a required field would reject
  the WHOLE reply with an SDK "Output validation error" on an unnamed room,
  which is a supported, non-error case, not a malformed response. The
  rejected alternative was falling back to the literal empty string, which
  would have the text say "(unnamed room)" while the data silently said
  `name: ""`, the same text/data lie this package's optional fields
  otherwise refuse to tell. `room_id`/`address`/`role`/`scope` keep the same
  `safeInline` sanitisation and the same `xroom:<room_id>` address fallback
  the text already applies; `archived` is `Boolean(r?.archived)`. `name` is
  present in the data exactly when the text prints it: the same
  `exactLiteral` check `roomNamePhrase` uses (the JSON literal at most
  `MAX_DOMAIN_LITERAL`, 256, once quoted and escaped) decides, and the value
  is the `structuredText` normalisation of the raw name, never a truncated
  prefix presented as the name; a name the text prints as "(room name cannot
  be printed exactly)" has no `name` key in the data. One stated exception:
  a name made only of the characters `structuredText` removes (whitespace,
  control, bidi, zero-width) is printed exactly in the text, as an escaped
  literal with the legend, but has no plain data value, so the data omits
  the key rather than carry `""` or the raw characters. A row whose `room_id` or
  `role` sanitises to nothing (core's `RoomListItemSchema` sends both on every
  row), or whose address cannot be rebuilt from `room_id`, is dropped from the
  data instead of emitted with empty strings in required fields; the text keeps its existing per-row
  degrade, and the drop is reported once per call on stderr, as `vault_list`
  and `memory_stats` report theirs. One divergence from the connector's
  schema that is not about fields: the connector declares its output
  objects `.strict()`, this package registers plain shapes as the SDK
  expects; the schema is used for outbound validation of this package's own
  `structuredContent` only, so strictness has no observable effect.
  **OD-15** (owner, 2026-09-23): `vault_list`'s `alias`, `context` and
  `concepts` all stay REQUIRED, matching the connector exactly, the
  divergence here is behavioural, not shape. A row whose `alias` or `context`
  is not a usable string (including one that was never sent at all) is
  SKIPPED from `structuredContent.secrets`, never turned into `isError` for
  the whole call: an earlier draft of this slice would have made one
  cosmetically bad row fail the ENTIRE list, directly reversing the existing,
  deliberately named behaviour "a broken alias is one anonymous row, not a
  dead tool", the text already substitutes `(no alias)` for that one row and
  leaves every other row and the call itself untouched, so the data now
  follows the same rule. This package does not fabricate `""` for a value it
  does not have, so a row with no `context` at all (a real, already-tested
  case, the existing "openai-key" fixture with no context) is ALSO dropped
  from the data even though the text still prints its plain `- alias` line
  for it unchanged. The drop is not silent: it is reported once per call on
  stderr, in this package's existing startup-diagnostic style (the
  "Mnemoverse: ..." lines in src/index.ts), naming how many rows were
  dropped, mirroring `memory_stats`'s S7 domain-drop diagnostic.
  **`concepts`** is a brand-new field with no text-side precedent (nothing in
  this tool's text renders it): core sends it on every row, so a row without
  it, or with a value that is not an array of strings, is treated the same as
  a malformed alias/context and drops the row; no `[]` is fabricated for a
  value core did not send. `alias`, `context` and each concept go through
  `structuredText` with core's own caps (200, 10,000 and 200), the same
  normalisation the room name gets, and a value that normalises to nothing
  (an empty or whitespace-only alias, which the text prints as `(no alias)`)
  drops the row rather than being carried as `""`.
  **No existing text-only reply gains `isError`** in this slice: both tools'
  unreadable-body degrade paths (an unrecognised `/memory/rooms` or
  `/vault/secrets` body) were already `isError` since S2.

- **`memory_create_room`, `memory_invite_to_room` and `memory_join_room` declare
  output schemas and return `structuredContent` alongside their unchanged text.**
  `memory_create_room` returns `{room_id, address, name?}`; `memory_invite_to_room`
  returns `{share_message, join_url?, code?, scope?, room_address?, expires_at?}`;
  `memory_join_room` returns `{room_id, address, name?, scope?, already_member?,
  next_steps}`. Field names and descriptions are copied from the connector's own
  `roomCreatedOutput`/`roomInviteOutput`/`roomJoinedOutput` (mnemoverse-mcp-remote),
  field for field and description for description.
  **OD-13** (owner, 2026-09-23): several fields the connector marks required are
  OPTIONAL here instead: `name` on create and join, `scope`/`already_member` on
  join, and `code`/`scope`/`room_address`/`expires_at` on invite. The connector's
  core client types those fields as always-present; this package treats every
  wire value as untyped and already has a non-degraded three-state phrase for a
  room name core did not send and for a join whose scope core did not report, so
  "core sent no usable value for this field" is an existing, honestly
  representable outcome here rather than an error, and the schema says so by
  making the field optional rather than forcing a fabricated placeholder into a
  field declared required. `join_url` and `share_message` on invite are the one
  exception with a different shape: `share_message` is the field guaranteed
  present, and it is the SAME message the text forwards (one selection feeds
  both surfaces: core's own share_message when the body has one, else
  `join_url`), normalised through `structuredText`; `join_url` itself stays
  optional, carried through `safeInline` with the connector's cap of 400 and
  present only when something remains.
  **`next_steps`** in `memory_join_room`'s structuredContent is the SAME usage
  sentence the text already prints, never core's own `next_steps` field; that
  field is written for REST callers and is deliberately not echoed (see the
  comment above `memory_create_room` in src/tools.ts).
  **Caps**: room `name` is capped at 200 characters, `share_message` at 800,
  through `structuredText` (src/names.ts), the same control/bidi/zero-width
  normalization `memory_write`'s `reason` field already gets.
  **Three existing text-only degrade replies now carry `isError: true`**, text
  unchanged. `memory_create_room`'s "Room ... was created but the server did not
  return a usable address" and `memory_join_room`'s "The server did not return a
  room address" both previously described a missing `address` only; the gate
  now also fires on a missing/non-string `room_id` (core's schemas require both
  on every create and join), and the sentence still speaks only of "address" in
  either case, since a caller cannot tell from the outside which of the two
  fields core actually omitted. `memory_invite_to_room`'s reply for a body
  with no forwardable message (the "(no message returned)" sentence when the
  body has neither `share_message` nor `join_url`, or the blank the text
  already printed for a `share_message` that is present but empty,
  whitespace-only or not a string) is the third: same text, `isError: true`,
  since there is no honest `share_message` to put in the data.
  **`structuredContent.name` on `memory_create_room` comes from the response
  only.** The text keeps echoing the name the caller chose when core's body
  omits one; the data does not, because the schema says "as stored" and a
  body without `name` is no evidence of what core stored.

- **`memory_stats` declares an output schema and returns `structuredContent`
  alongside its unchanged text.** A client that reads structured tool results
  now gets `{memory_count, domains, episodes?, prototypes?, hebbian_edges?,
  avg_valence?, avg_importance?}` as data instead of parsing the four lines.
  `memory_count` and `domains` are copied from the connector's own
  `memoryStatsOutput` (mnemoverse-mcp-remote), field for field and
  description for description, under the CONNECTOR's naming rather than
  core's (`total_atoms`): the same structured consumer reads both servers,
  and a data field spelled differently between them would defeat the point
  of one shared shape (decision Q3, owner, 2026-09-23). Both are required.
  The other five fields are this package's own addition, the rest of what
  this tool's text already reports, each optional and present only when
  core sent a usable number for it: the three counts use the same
  non-negative-safe-integer rule `updated_count` already applies, and the
  two averages use `Number.isFinite`, so a value in a shape the schema
  could not hold (a string, a non-integer count, a non-finite average) is
  simply absent, never defaulted to 0 or fabricated.
  `domains` in `structuredContent` is FILTERED, not an error: a non-string
  element (core can only ever send an array of strings, but this client does
  not assume it) is dropped from the data rather than turning the whole
  reply into `isError`, since the text's own `Domains:` line already counts
  such an element in its "not shown, cannot be printed exactly" clause
  (`formatDomainList`, unchanged). The drop is not silent, though: it is
  reported once per call on stderr, in this package's existing
  startup-diagnostic style (the "Mnemoverse: ..." lines in src/index.ts),
  naming how many entries were dropped, because a structured consumer reading
  only `structuredContent` has no other way to learn that the array it got
  is shorter than what core sent. `structuredContent.domains` is also not
  capped, unlike the text's `Domains:` line (`MAX_DOMAIN_LIST_CHARS`): an
  account with thousands of domains gets every name in the data even where
  the text truncates.
  The text a caller already reads does not change, with two exceptions.
  First, `memory_count` and `domains` are now REQUIRED for a non-error
  reply: a body without a usable `total_atoms` (a non-negative safe integer)
  or without an ARRAY `domains` used to degrade gracefully into this tool's
  own "unknown" numbers and "none reported" domains; it is now the
  unreadable-answer error (`isError`), the same OD-8 precedent
  `memory_feedback` took above, because there is no honest
  `structuredContent` to build for either shape. Second, the malformed
  OPTIONAL fields are a disclosed text/data divergence rather than a text
  change: `episodes`, `prototypes`, `hebbian_edges`, `avg_valence` and
  `avg_importance` keep printing whatever the existing `num()`/`dec()`
  helpers print for a value in any shape at all (they are `typeof`-only, by
  design, so the text is byte-identical to before), while `structuredContent`
  omits the same value whenever it fails the stricter check above. So a
  service that sends `episodes: 1.5` still prints "1.5 episodes" in the
  text, and a service that sends `avg_valence: 1e400` (parsed as `Infinity`)
  still prints "valence Infinity" in the text, while neither reaches
  `structuredContent` at all, the same kind of divergence S5 disclosed for
  its cursor semantics.

### Fixed

- **Author tags erased non-Latin names to nothing.** `formatAuthorTag`'s
  `[by X]` tag rendered agent identity through `safeInline`, whose charset is
  ASCII `\w`: a Cyrillic, CJK or Arabic `agent_name` sanitised to the empty
  string and the tag disappeared with no trace, leaving a memory with a real
  author looking unauthored (issue #66). `@domain` got the same fix in 0.8.1
  ("The domain hint lied about non-Latin names," above); this is the author
  tag's turn. Every author name is now printed as an exact JSON string
  literal through `exactLiteral` (src/names.ts), the same treatment
  `formatDomainTag` already gives `@domain`, for EVERY name, not only ones
  that need escaping: `[by "sigma"]`, `[by "Ольга" · external]` (owner
  decision I66-1, 2026-09-24, full symmetry with domains). `" · external"`
  sits outside the quotes, since it is a server-added qualifier and not part
  of the name (I66-3). The literal is capped at `MAX_DOMAIN_TAG_LITERAL`
  (128), the SAME constant `@domain` uses, not a second one that happens to
  share the value (I66-4), and a name too long to print exactly gets the
  disclosed fallback `[by (name cannot be printed exactly)]` rather than
  vanishing. An escaped author literal now gets the same "printed as JSON
  string literals" escape-legend sentence an escaped domain already gets
  (`withDomainEscapeLegend`, src/tools.ts), on both `memory_read` and
  `memory_list_recent`. Two things about that legend changed with it (review
  round 2): on the result-line surfaces a candidate is judged under the tag
  cap (`MAX_DOMAIN_TAG_LITERAL`), the cap the tag actually printed under,
  so a name too long for the tag cannot earn a legend through a literal
  that merely appears in a result's content; and the at-most-once check
  looks for the whole legend rather than a fragment of it, so an author
  name equal to that fragment, sent by another connector, can no longer
  suppress the legend for a genuinely escaped name on the same page.
  `is_external` counts as external only when it is the boolean `true`.
  And `structuredContent.author` follows the tag's own rule (review round
  3): it is present exactly when the tag prints the name, decided by the
  same `exactLiteral` check under the same cap, and carries the whole
  normalised name; the old 64-code-point cap, inherited from `safeInline`,
  could hold a shorter name than the page showed, or a name the page had
  refused. One stated exception: a name made only of the characters
  `structuredText` removes (whitespace, control, bidi, zero-width) is
  printed exactly in the tag, as an escaped literal with the legend, but has
  no plain data value, so the data omits `author` rather than carry `""` or
  the raw characters. `structuredText` itself (src/names.ts) now drops every
  Unicode format character, not only its curated lists of bidi and
  zero-width code points: the Tag block (U+E0000 to U+E007F, an invisible
  copy of ASCII used to smuggle text past a reader) and U+00AD SOFT HYPHEN
  passed into `structuredContent.author` unchanged while the text tag
  escaped them (Sigma, review round 4). This is the one normaliser every
  structured free-text field uses (room names, `reason`, `share_message`,
  `next_steps`, vault aliases and contexts), so those fields gain the same
  rule; line and paragraph separators (U+2028, U+2029) now count as control
  characters there too.
  **`structuredContent.author` had the same erasure, undetected**, found
  while fixing this, not reported in the original issue: it fed off the same
  `safeInline`-sanitised value, so a non-Latin name reached neither surface.
  It now runs through `structuredText` (src/names.ts) instead, the same
  control/bidi/zero-width-only normalisation `memory_write`'s `reason` field
  already gets, so a name survives in the data whenever it survives on the
  page. This drops bracket/quote stripping from the bare field (owner
  decision I66-2, 2026-09-23): a JSON field value cannot be "closed early" by
  a literal `]` or `"` the way a hand-built sentence can, so the quoting on
  the TEXT tag now carries that burden, and the bare field only needs the
  same invisible/reordering-character defence every other `structuredText`
  field already has.
  **Disclosed divergence**: this is a visible TEXT change on every result
  line that carries an author (every `[by X]` becomes `[by "X"]`), which
  this project's own rule (the header of this file) treats as a PATCH, not a
  MINOR: no tool, no parameter and no schema shape changed. The 0.8.1
  domain-tag entry above made the identical call for the identical reason
  (owner decision I66-5, 2026-09-23).
  **Known and not fixed here**: the hosted connector (mnemoverse-mcp-remote)
  has its own, separate copy of this exact ASCII-erasure defect in its own
  author-tag rendering. This package shares no code with the connector, so
  this fix does not reach it; that is a separate issue for that repository.

### Changed

- **The removal of `memory_feedback`'s deprecated `atom_ids` parameter,
  announced in 0.11.0 for 0.12, moves to 0.13** (owner, 2026-09-24). 0.12.0
  ships sooner than that announcement assumed, and the stability rule above
  keeps a deprecated parameter for one full MINOR. The parameter is still
  accepted on its own, exactly as in 0.11; only its description changes, to
  `Deprecated since 0.11, removed in 0.13`.

## [0.11.0] — 2026-09-23

### Added

- **`@mnemoverse/mcp-memory-server/shared`: the ten memory tools as one function
  another MCP server can register.** ADR-025 (mnemoverse-core) makes this package
  the definition of the Mnemoverse MCP surface. Until now the hosted connector
  (`mnemoverse-mcp-remote`) kept its own hand-written copy of every tool, and the
  two had drifted in wording, errors, paging and room handling. The new entry
  exports `registerMemoryTools(server, { apiFetch })`, `SERVER_INSTRUCTIONS` and
  the three error classes an `apiFetch` must reject with. Importing it starts
  nothing: the stdio server stays in the main entry, which it does not import.
  This is the package's first `exports` map, and it narrows nothing: `.` still
  resolves to `dist/index.js` (as do `main` and the `bin`), and a `./dist/*`
  passthrough keeps every path under `dist/` importable exactly as before, so a
  consumer that imported, say, `@mnemoverse/mcp-memory-server/dist/errors.js`
  is not broken by the upgrade.
  The refactor behind it only moves code: the handlers in `src/tools.ts` are the
  lines that were in `src/index.ts`, verbatim except for indentation. No tool,
  parameter, text or annotation changes, and the stdio server behaves exactly
  as before. The two source-level denylists in the tests (no domain
  normalisation, no domain through `safeInline`) now scan `src/tools.ts` too.
  Scanning only the file the handlers left would have kept them green while
  guarding nothing.
- **`memory_feedback` can rate memories in a shared room.** It takes an
  optional `domain` (owner, 2026-09-22): pass the room's address, the same
  `xroom:...` you read the memories from. Until now the tool had no `domain`,
  so a rating of a room memory matched nothing, as its description warned. The
  engine has always routed a rating by `domain`. It refuses a
  non-member, an archived room and a read-only member, and the refusal names
  which one. Without `domain` the request is byte-identical to before and the
  rating goes to your own memories; an empty `domain` counts as none, as it
  does on `memory_read`. When nothing or only part matches, the
  reply now says whether it searched the room or your own domains, and gives
  the likely causes for that case.
- **`memory_feedback` reports the average valence the engine returns.** The
  engine answers every rating with the mean valence of the memories it reached,
  after the rating. The tool dropped it, and the hosted connector passed it on.
  The reply now ends with "The service reports their average valence is now
  0.42 (on a scale from -1 to 1)". A missing or non-numeric value prints
  nothing, never 0. The engine's co-activation count is not shown: it links
  concepts only for a request that carries the query's concepts, which this
  tool does not send, so the count is always 0.
- **`memory_invite_to_room` takes `max_uses`.** One invite can now let several
  people join; without it an invite stays single-use, as before, and the
  request is unchanged. The hosted connector already offered this, and the
  description here called every invite "one-time". Both ends come from core's contract (see the
  limits entry above): at least 1, at most 1000. The description, `llms.txt`, `llms-install.md`,
  the README table and the generated `manifest.json` say single-use by
  default. Core also returns a `next_steps` text on room create and join; it
  is still not shown, because it is written for REST callers, tells a
  read-only member to write, and carries the room name unescaped. The usage
  lines this server prints say the same things in MCP terms.
- **Three MCP prompts: `recall`, `save_insight`, `what_do_you_know`.** Clients
  that show prompts as commands (Claude Code as `/mcp__mnemoverse__recall`)
  get named shortcuts to the tools. Each renders one user message that asks
  the model to use `memory_read` or `memory_write`; none calls the API
  itself. They come from the hosted connector with the same names,
  arguments and wording, and another server registers them with
  `registerMemoryPrompts(server)` from `/shared`. One difference: the
  `domain` of `save_insight` is printed as an exact JSON literal, like every
  domain this package names, so a quote, newline or invisible character in
  it is escaped rather than breaking the message; a plain domain reads as
  before, and one too long to print exactly is refused. The
  withdrawn-claims and domain-normalisation denylists now read the prompts
  too.
- **An MCP resource, `memory://item/{memory_id}`.** Clients that attach
  resources can open one saved memory by the id a `memory_read` result
  shows. It returns only `memory_id`, `content` and `domain` as JSON; the
  engine's point read also carries scores and metadata a model does not
  need. It comes from the hosted connector with the same URI template,
  name and output, and another server registers it with
  `registerMemoryResources(server, { apiFetch })` from `/shared`. It reads
  the caller's own store only, because the engine's point read takes no
  domain, so a memory from a shared room cannot be opened; the
  description says so. A missing memory answers with MCP's
  resource-not-found code (-32002) and the engine's detail; any other
  failure keeps this package's explanation of it. A success whose body is
  not a memory (an empty 204, a missing content or domain) is an error in
  the words the tools use for an unreadable answer, never a resource made
  up from the id that was asked for. The id is decoded once from the URI
  and encoded once into the path.
- **Field limits are read from core's API contract, not typed here.**
  `src/limits.ts` is generated from the engine's OpenAPI document
  (`npm run limits:refresh`), the tools' schemas use those values, and a
  scheduled job (`npm run limits:check`) fails when the committed file stops
  matching what core publishes. ADR-025 gives the engine the limits; a copy
  nobody checks drifts, and four had:
  - **`memory_read`'s `top_k` accepts up to 500**, the engine's ceiling since
    June, instead of refusing anything over 50 here.
  - **Its description now says whose default 5 is.** This server fills in 5
    when the caller omits `top_k`, so the engine's own default of 10 never
    applies; the description said "default: 5" without saying which it was.
    A first draft of this change made the description say 10 and made it
    false; Copilot caught it on #151.
  - **`memory_write`'s `domain` is capped at 100 characters** and **`concepts`
    at 256 items**, as the engine caps them, so an over-long value is refused
    here with the field named rather than as a 422 from the API. Only the
    write schema bounds a domain in the contract, so read, `list_recent` and
    feedback still pass any domain through.
  - **`memory_invite_to_room`'s `max_uses` is capped at 1000**, the engine's
    ceiling. It had a floor only, and 5000 travelled to the API to be refused
    there.
- **Room guidance names `memory_list_recent`** (#64). `memory_create_room`'s
  description and reply, and `memory_join_room`'s usage line, named only
  `memory_write` and `memory_read`, though `memory_list_recent` is the tool
  that catches up on what others wrote in the room. A read-only or
  unknown-scope member is offered reading only, as before.
- **README: what to do when the hosted connector stops answering in a
  session** (the in-repository part of #97). Reconnecting on claude.ai does
  not revive a stuck session; reconnect from inside it (`/mcp` in Claude
  Code). Meanwhile this local server, with a key from the same account,
  reaches the same memory.
- **`memory_write` declares an output schema and returns `structuredContent`
  alongside its unchanged text.** A client that reads structured tool
  results now gets `{stored, memory_id, reason?, importance?}` as data
  instead of parsing the sentence. `reason` (capped at 400 characters, and
  absent when nothing remains after normalisation) and `importance` (a
  non-finite number, which JSON can carry as `1e400`, counts as not sent)
  appear only when the memory service actually sent them; nothing is
  defaulted or fabricated for an older core that omits either. `memory_id` is validated
  as a plain string, not a UUID: this package's ids are opaque, nothing in
  the contract promises they are UUIDs, and a stricter check would turn any
  future id-format change into a whole-page "Output validation error"
  instead of a value this client simply could not shape-check further. The
  text a caller already reads does not change, with one exception: a
  `stored: true` body that carries no string `atom_id` used to print
  `Stored (importance: N). ID: unknown` as a success; it is now the
  unreadable-answer error (`isError`), because core sends `atom_id` on
  every stored write, so a body without one is not core's answer and there
  is no honest `memory_id` to return for it.
- **`memory_read` declares an output schema and returns `structuredContent`
  alongside its unchanged text.** A client that reads structured tool
  results now gets `{items: [{memory_id, content, domain, created_at?,
  author?}]}` as data instead of parsing the numbered lines. `author` is the
  writing agent's sanitised name only (`sigma`, or `sigma · external` for a
  connector outside this account), never the human `principal`, even though
  core's response carries it. `created_at` appears only when core sent a
  string that parses as a date; a wrong-typed one (a number, say) or an
  unparseable string is dropped rather than guessed at, the rule
  `formatDateTag` already applies to the text. A value that states its
  offset (`Z` or `+hh:mm`) is carried exactly as sent; an offset-less
  one, which this package reads as UTC by contract, is re-emitted as the
  UTC ISO-8601 instant the text renders, because a structured consumer
  would otherwise read the naive string as local time and land on a
  different instant than the text shows. `content` is carried exactly as core sent it, with no
  cap and no normalisation: unlike the text, which `capResult` truncates for
  the 25K-token result-size limit, `structuredContent` is not capped
  anywhere else in this package either, so a capped page still carries every
  item in `structuredContent`. `memory_id` is validated as a plain string,
  not a UUID, for the same reason as `memory_write`'s (decision OD-7): this
  package's ids are opaque, nothing in the contract promises they are UUIDs,
  and a stricter check would turn any future id-format change into a
  whole-page "Output validation error" instead of a value this client
  simply could not shape-check further. The text a caller already reads
  does not change, with one exception: an item missing a string `atom_id`,
  `content` or `domain` used to degrade gracefully: the line simply omitted
  the missing part (no id line, no domain tag, or literal `(empty)` for
  content). The WHOLE answer is now the unreadable-answer error instead,
  because core's `MemoryItemSchema` always sends all three, so an item
  missing one is not core's answer and there is no honest `structuredContent`
  item to build from it.
- **`memory_list_recent` declares an output schema and returns
  `structuredContent` alongside its unchanged text.** A client that reads
  structured tool results now gets `{items: [...], next_cursor}` as data
  instead of parsing the page. Each item has the SAME shape memory_read's
  `structuredContent` items already have, `{memory_id, content, domain,
  created_at?, author?}` (the two tools now share one item schema in
  `src/tools.ts`, so this is a code-sharing change for `memory_read`, not a
  schema change: its emitted `tools/list` entry is byte-identical to before).
  `next_cursor` is the SAME field the hosted connector already returns under
  that name, but derived differently: this package pages through several
  core requests per call to stay under its own page-size budget
  (`LIST_PAGE_CHAR_BUDGET`), so `next_cursor` is the cursor of the last
  FULLY ACCEPTED batch, the same value the text's "More older entries exist"
  line prints, and `null` once the feed is exhausted or a filtered/empty
  answer has nothing to continue from, never core's newest-seen cursor,
  since a batch that did not fit the page is also absent from `items`, and
  pointing past it would both skip entries and contradict the page just
  shown. One difference from the connector's schema: `next_cursor` is
  optional here. The text already refuses to print a server-supplied
  token whose shape this client will not pass on (CN-032) and says so;
  the data now applies the same gate, and in that case the key is absent
  rather than null, because null would claim the listing is complete
  (decision OD-12, 2026-09-23). A token that is not a string at all
  counts the same, on both surfaces: the shape check is made after a
  type check, so a number cannot pass it by coercion. The text a caller already reads does not
  change, with two exceptions. First, the same item guard `memory_read` got in this release:
  an accepted entry missing a string `atom_id`, `content` or `domain` used
  to degrade gracefully in the rendered line; the WHOLE answer is now the
  unreadable-answer error instead, for the same reason (core's
  `MemoryItemSchema` always sends all three). Second, and different from
  `memory_read`'s change: a bare 404 from `/memory/recent` (no error `code`
  in the body, today's sign of an undeployed feed endpoint) used to be a
  quiet non-error text pointing the caller at `memory_read` instead; it is
  now the same sentence returned as `isError` (decision OD-9, owner,
  2026-09-23). This was the one branch left that could not honestly produce
  `structuredContent` once the schema was declared: `{items: [], next_cursor:
  null}` is a SCHEMA-VALID EMPTY PAGE, which would tell a structured
  consumer the feed was checked and found empty, when the truth is this
  client could not check it at all. `isError` is the shape the SDK's own
  `validateToolOutput` exempts from requiring `structuredContent`, the same
  mechanism `memory_write` and `memory_read`'s unreadable-answer replies
  already use, so this is that same escape hatch reached from a new branch,
  not a new one.
- **`memory_feedback` declares an output schema and returns
  `structuredContent` alongside its unchanged text.** A client that reads
  structured tool results now gets `{updated_count, avg_valence?,
  coactivation_edges?}` as data instead of parsing the sentence. `avg_valence`
  is the RAW number, not the text's two-decimal string and not its "-0.00" to
  "0.00" mapping: a structured consumer reads a value, not a display string,
  so it gets the number the service actually sent. `coactivation_edges` is
  forwarded as data even though the text still says nothing about it: the
  existing comment above `valence` in the handler explains why (this tool
  sends no `query_concepts`, so the number this tool would ever receive is
  always 0, and a sentence reporting a 0 that can never be anything else
  would say nothing), and that reasoning was always about the TEXT, not about
  a data field a structured consumer can still read and record. Both optional
  fields follow the same rule as `updated_count`: a value the service did not
  send, or sent in a shape the schema could not hold (a non-finite
  `avg_valence`, a non-integer or negative `coactivation_edges`), is absent
  from `structuredContent`, never defaulted to 0. The text a caller already
  reads does not change, with one exception: the UNKNOWN-count reply (the
  service acknowledged the call but reported no usable `updated_count`) used
  to be a non-error text saying so and telling the caller not to re-send the
  same rating; it is now the same sentence returned as `isError` (decision
  OD-8, owner, 2026-09-23), for the same reason `memory_list_recent`'s
  bare-404 reply became `isError` in this same release (OD-9): `updated_count`
  is REQUIRED in this schema, matching core's own `FeedbackResponseSchema`,
  so a body that sent no usable count is not core's answer and there is no
  honest `structuredContent` to build for it. `isError` is the shape the
  SDK's own `validateToolOutput` exempts from requiring one.

### Fixed

- **`memory_list_recent` no longer says "More entries exist" when the feed has
  ended.** When the engine answered with an empty `next_cursor` (`""`), the
  paging loop correctly stopped, but the page was rendered with that empty
  string as its cursor. The renderer reads only a missing cursor as the end, so
  a finished feed printed "More entries exist but the continuation token could
  not be displayed", an existence claim with nothing behind it. An empty
  cursor now ends the page as it ends the loop, on both paths that set it. Any
  other value the renderer cannot print still says entries exist. Found by
  CodeRabbit in the code this release moved to `src/tools.ts`; the bug predates
  the move.

### Changed

Three decisions about the shared MCP surface (owner, 2026-09-21). The stdio
server and the hosted connector had answered each one in opposite ways. Under this
file's tool-surface rule each change is announced here and none is silent.

- **`memory_feedback`: `destructiveHint` flips from `true` to `false`.** Only
  deletion is destructive. A rating moves a memory's valence and the weights of
  its associations, which decide how it ranks. The saved text, its concepts and
  its domain are untouched, and later ratings keep moving those scores. The old
  `true` cited the spec's "destructive update" to stored state. A client that
  confirms destructive tools would have asked before every rating, taxing the
  one signal the ranking learns from. Keeping every rating, so that any single
  one can be undone, is planned in the engine; until it ships, each rating
  replaces the previous scores.
- **All ten tools: `openWorldHint` flips from `true` to `false`.** Every tool
  works on the user's own memory store and reaches nothing else. That the
  store sits behind an API does not make it an open world.
- **`memory_feedback` takes `memory_ids`.** The tool rates memories, which is
  what every result is; an atom is the engine's word for its smallest unit.
  The hosted connector already names the parameter so.
  **`atom_ids` is deprecated since 0.11 and removed in 0.12**: until then it
  is still accepted on its own. Passing both is refused with a sentence and
  nothing is rated, since which list was meant would be a guess. Passing
  neither is refused the same way. The request to the API is unchanged: it
  still sends the engine's field name, `atom_ids`. Neither name checks the id
  format or caps the count, because the engine validates the ids and sets no
  maximum (ADR-025 keeps such checks with the engine). The one check here is
  that the list is not empty, since rating nothing is not a call. `llms.txt`,
  which agents read to learn the tools, names `memory_ids` too, and a test now
  holds every parameter listed there, with its type and whether it is
  required, to the schema the server registers.
- **Listing text: shared rooms named, and the "one key … ChatGPT" claim withdrawn.**
  The registry line in `src/configs/source.json` (and the `server.json` /
  `manifest.json` generated from it) now reads "Hosted AI agent memory that
  learns from outcomes, with shared rooms, in Claude, Cursor and ChatGPT." (99
  of the registry's 100 characters). Rooms have shipped for several releases
  and the line directories show did not mention them. The previous line, in
  every registry version since 0.3.10, said "one key … ChatGPT", which
  mnemoverse-docs `data/facts.json` `access.chatgptRule` rules out: ChatGPT's
  MCP path is OAuth-only, and its API-key path is a Custom GPT action. The same
  claim is corrected where it also stood: the npm `description` (now "one key or
  OAuth", and it names rooms), the README lead and "What is Mnemoverse Memory?"
  (one account: an API key locally, an OAuth sign-in on the hosted endpoint),
  and `mcpb.longDescription`, which also stops saying the server requires a key
  (it starts and lists its tools without one; tool calls need it). The README's
  "no self-hosted build" becomes the pricing page's position: Enterprise
  self-hosting by agreement, managed by default (facts.json
  `tiers.enterprise.selfHosting`, owner decision 2026-09-21). The Quick Start
  now opens with the no-key path, the hosted endpoint over OAuth, and the
  console links go to `/sign-up`, where the UTM tags survive (the console root
  redirects to `/sign-in` and drops them). `test/listing-text.test.ts` keeps
  these four surfaces from carrying the bare key-and-ChatGPT claim again, holds
  the registry line to 100 characters, and requires npm and the registry to
  name outcomes and rooms. Text only.
- **npm keywords** add `mcp-server`, `long-term-memory`, `agent-memory`,
  `claude-code` and `memory-rooms`, the terms npm search and the MCP directories
  that read package.json match on. Metadata only.
- **Gemini CLI gallery manifest in the repository root** (`gemini-extension.json`,
  `GEMINI.md`, the same files as `mnemoverse/gemini-extension`). The gallery lists
  only repositories that GitHub code search has indexed, and no mnemoverse
  repository created since 2026-07-18 is indexed, so the extension repository
  cannot appear; this one is. Not shipped: npm publishes only `files`, and
  `.mcpbignore` excludes both from the `.mcpb` bundle.
- **`memory_write`, `memory_read`, `memory_list_recent`, `memory_list_rooms` and
  `vault_list`: a 2xx body this client cannot read now comes back as a tool
  error, not a text-only reply.** The sentence itself is unchanged, the one
  these five already used for "this client cannot read the answer." What
  changes is the shape: once a tool declares an output schema, a non-error
  result needs structuredContent to go with its text, and there is no honest
  structuredContent for a body this client could not read (an empty shape such
  as `{items: []}` would claim an absence the body never stated). `isError` is
  the one shape the SDK exempts from that requirement, so it is what these five
  call sites now carry. The `memory://item/{memory_id}` resource keeps the same
  sentence without `isError`: it has no output schema to satisfy, and an
  unreadable body there already fails the read itself.

## [0.10.2] — 2026-09-20

A PATCH under this file's own rule: it changes TEXT and removes a request, and it changes no SHAPE and no ROUTING.
No `registerTool` call changes: no tool, parameter, annotation or default moves. What changes is what a tool call
and the startup line SAY when the API key is bad, and one case in which nothing is sent at all (a key that is
certainly a documentation placeholder). That is the opposite of a probe: fewer requests, not more.
`git diff v0.10.1..v0.10.2 --stat -- src/` touches `src/errors.ts`, `src/requests.ts` and `src/index.ts`, and in
`src/index.ts` only the two places that check the key before sending it.

### Security

- **A docs placeholder key never leaves the machine.** The engine sees this
  server calling it again and again with the example key from the install
  snippets (`mk_live_YOUR_KEY`). A value this client can recognise as a
  placeholder WITHOUT any request was still going out over the wire, and the
  generic 401 sentence gave the calling agent nothing that said "stop
  retrying". `refusePlaceholderKey` (src/requests.ts)
  recognises the two shapes that are certainly placeholders: an `mk_live_`
  label in upper case (`mk_live_YOUR_KEY`, `mk_live_USER_KEY`,
  `mk_live_CODING_AGENT_KEY`) and the `mk_live_xxxx…` template value shipped in
  `src/configs/source.json`. It refuses the call BEFORE `fetch`, at both
  credential-bearing call sites (`apiFetch` and the startup probe), the same
  shape as the existing `BASE_URL_REFUSAL` guard:

  > Mnemoverse: this tool did not run, because MNEMOVERSE_API_KEY is still the
  > example value from the documentation, not a real key. Nothing was sent […]
  > Tell them to create a key at https://console.mnemoverse.com/dashboard/keys
  > […]

  Anything else is left alone and still reaches the engine: a self-hosted
  static-auth secret with no `mk_live_` shape, a truncated real key, and a
  mixed-case label (`mk_live_Your_Key`) all get the engine's own, more precise
  401 rather than a local guess. The configured value is never echoed, not even
  the placeholder itself.

### Fixed

- **The `malformed_key` guidance no longer blames spaces around the key.** It listed "wrapped in quotes or
  surrounding spaces" among the common causes. `fetch` trims whitespace around a header value, so a padded key
  reaches the engine intact and is judged on its own; probed live, a quoted key is `malformed_key` and a key with a
  trailing space is not. The sentence now names the causes that do occur: a different token (such as an OAuth
  token), a key cut short in the paste, or a key wrapped in quotes.

- **A 401 now uses the engine's own `details.reason` when it sends one**
  (an engine change rolling out separately). `parseErrorEnvelope` reads
  `details.reason` (`missing_key` / `placeholder_key` / `revoked_key` /
  `invalid_key` / `malformed_key`) and `details.keys_url`, the latter validated
  against an allow-list (https only, host exactly `console.mnemoverse.com`)
  before it is ever shown, since a response body must not be able to point a
  reader at an arbitrary site; an off-host or plain-http value falls back to
  the same `KEYS_URL` every other 401 sentence already uses. `explain401`
  branches on the named reason after the existing "caller org not identified"
  clause and before the generic "api key" substring guess, so a valid key can
  still never be told to replace itself. An unknown reason, or no reason at
  all, every engine released today, falls through to today's
  founder-endorsed generic sentence unchanged, byte for byte.

### Documentation

- **`README.md`: check the API key before putting it in a config.** A key-check block next to the install step.
  Both forms ask for the key at a masked prompt and never pass it as a command argument, so it lands neither in
  shell history nor in the process list: bash streams the header through stdin (`curl -H @-`), PowerShell uses
  `Read-Host -AsSecureString` with `Invoke-WebRequest` and prints the error body on both Windows PowerShell 5.1
  and PowerShell 7. The table lists what the output contains: `total_atoms` for a working key, and
  `details.reason` per cause of a rejection.
- **`README.md`: first screen.** What the package gives you, in one sentence, and one paragraph on what is open
  source here (this server and the Python SDK, MIT) and what is a hosted service (the memory engine).
- **`llms-install.md`** (new, repository only, not part of the npm package): install steps written for an AI agent
  that sets the server up on a user's behalf, including what `NOT STORED` means on a second run of the verify step.
- `glama.json`: a second maintainer for the Glama listing.

## [0.10.1] — 2026-09-16

A PATCH under this file's own rule. Every change in this release lands in
`README.md`, `CONTRIBUTING.md`, `docs/`, or `.github/workflows/`, confirmed
with `git diff v0.10.0..origin/main --stat -- src/`, which reports nothing.
No tool, parameter, annotation or route moves, and no tool's behaviour
changes. The published package's contents change only through `README.md`
(the `files` field also ships `package.json`, whose own version field
necessarily advances with every release, and `dist/`, which is unchanged
since nothing under `src/` moved).

### Security

- **The generated VS Code snippet stopped telling readers to commit an API
  key** (#126). `.vscode/mcp.json` is meant to be shared with a team, so the
  old text said the key inside it should be shared too, which is advice to
  commit a live `mk_live_` key to a repository. The snippet now leads with
  the VS Code extension's key-free browser sign-in as the default path, and
  the JSON example uses a top-level `inputs` prompt (`type: "promptString"`,
  `password: true`) instead of a literal key value, referenced from `env` as
  `${input:mnemoverse-api-key}`. `genVscodeFormat()` in
  `scripts/generate-configs.mjs` builds the prompt from `source.json`'s
  `secret: true` env entries, so the fix reaches every surface that channel
  renders (`docs/configs/vscode.json`, `docs/snippets/vscode.md`, the
  generated block in `README.md`).
- **Closed all 11 open Dependabot alerts** (4 high, 7 medium), all transitive
  or dev-only, all resolved by `npm audit fix` within the existing semver
  ranges — `package.json` is unchanged, only `package-lock.json`. `hono`
  4.13.1 → 4.13.8 (via `@modelcontextprotocol/sdk`; GHSA-crvj-82cr-hjcx,
  GHSA-g6gw-c38x-mqfc, GHSA-gqvv-2mrq-wpjv) — no source file in this package
  imports `hono` directly, so none of the fixed request-parsing paths are ones
  we call. `fast-uri` 3.1.5 → 3.1.8 (via `ajv` via `@modelcontextprotocol/sdk`;
  GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf,
  GHSA-jqff-g426-hqxp). `qs` 6.15.3 → 6.16.0 (via `express` via
  `@modelcontextprotocol/sdk`; GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g).
  `vitest` (devDependency) 4.1.10 → 4.1.11 with its `@vitest/mocker`
  dependency, both GHSA-82fw-gwwq-j7x9.

### Fixed

- **The Cursor install snippet and the "Add to Cursor" button stopped
  contradicting the founder's own public guidance on where a key may
  live.** The generated snippet now recommends the global
  `~/.cursor/mcp.json` and says plainly not to use a project-level
  `.cursor/mcp.json`, since that file is committed with the repository; a
  new paragraph under the one-click button explains the button installs the
  placeholder key `mk_live_YOUR_KEY`, not the reader's own, and names the
  file Cursor actually wrote so a reader who already clicked it can fix the
  key (#123).
- **The VS Code deep link no longer encodes a literal API key.**
  `genVscodeDeepLink()` (`scripts/generate-configs.mjs`) baked
  `MNEMOVERSE_API_KEY=mk_live_YOUR_KEY` into
  `docs/configs/vscode-deep-link.txt` while the `.vscode/mcp.json` snippet
  right next to it already prompted for the key via `inputs` plus
  `${input:mnemoverse-api-key}`, the same generator disagreeing with itself
  about the same secret. VS Code's own source confirms the
  `vscode:mcp/install` link accepts a top-level `inputs` array, the same
  shape `.vscode/mcp.json` uses: `parseMcpInstallUriPayload` in
  `src/vs/workbench/contrib/mcp/browser/mcpWorkbenchService.ts` declares
  `IMcpInstallUriPayload { name; config; inputs?: IMcpServerVariable[] }` and
  reads `inputs` off the same top-level JSON object as `name`/`command`/`env`.
  This is undocumented on any published VS Code docs page, but present in the
  shipped TypeScript (checked against `microsoft/vscode` `main`,
  2026-09-15). The deep link now carries `${input:mnemoverse-api-key}` in
  `env` plus the matching `inputs` entry instead of the placeholder value.
  Found on review of #126.
- **The VS Code input prompt's description now comes from `source.json`.**
  `genVscodeInputs()` hardcoded its own sentence, which had drifted from
  `env.MNEMOVERSE_API_KEY.description`, the same field `genServerJson()`
  already publishes as the environment variable description in the MCP
  Registry manifest. Both now read the one description in
  `src/configs/source.json`. The VS-Code-only detail that used to live in the
  hardcoded sentence, namely the extension's browser sign-in as a no-key
  alternative, is not part of that shared, registry-facing description, so
  it stays where it was already stated correctly: the prose above the JSON
  block in `snippetVscode()`. Found on review of #126.

### Added

- **A README rewrite aimed at the surface a citation measurement showed is
  actually read.** A citation panel (77 plus 76 queries) found github.com
  ranking #1 or #2 as a source for Claude and ChatGPT, specifically this
  repository's root README, which answered "how do I connect this to seven
  clients" rather than "what is this." Restructured around a product-first
  opening ("What is Mnemoverse Memory?"), a "How it compares" section
  naming what it replaces (per-tool instruction files, vector-store RAG,
  local-first servers, with an honest note on when local-first is the
  better choice), one sentence on the research behind it (arXiv:2603.08965)
  with zero benchmark numbers as policy, and one canonical install block
  with the other seven clients collapsed into a details section (#120).
- **The README now points at the other five ways this project ships**:
  the Claude Code, Cursor and Gemini CLI plugins, the VS Code extension,
  and the `.mcpb` desktop bundle, plus the backend-neutral
  `agent-memory-discipline` skill and the `awesome-agent-memory` curated
  list (named separately, since both apply to any memory backend and the
  list includes competitors). None of the six had a single mention in the
  previous README despite it being, by the same citation measurement, where
  34 of 44 GitHub citations land. Verified live: all seven linked
  repositories return 200, all five manifests return 200, and the `.mcpb`
  bundle is present in the `v0.9.1` GitHub release. Deliberately left out:
  a marketplace install command for `claude-plugin`, whose manifest is
  still in an open PR and would fail today; printing an unverified command
  was ruled out rather than risking a broken one (#124).
- **A one-line PowerShell variant of the Claude Code install command**,
  generated from the same `source.json` as the existing bash form so the
  two cannot drift apart. The bash-only block used backslash line
  continuations, which PowerShell (the default shell on Windows) does not
  read, so a Windows reader following the published page hit a parse error
  on the first line of setup (#122).
- **A "Tool surface stability" policy, and `tools/list` is now frozen per
  released version.** Within a PATCH, tool names, argument schemas and the
  annotations object do not change (text may); within a MINOR, tools and
  annotation fields may be added but never removed, renamed or silently
  flipped, and a removal or rename is announced one MINOR ahead with a
  `deprecated since x.y, removed in x.z` note. Written down after a reader
  asked whether a saved `tools/list` could be diffed against a live one
  release over release. No code change: the frozen baseline is the ten
  tools this server already served in 0.10.0 (#125).
- **A failed `release.yml` run now opens a GitHub issue instead of failing
  silently on the Actions tab.** `v0.10.0` sat unpublished to npm for
  fifteen days after an `npm error 404` on the publish step, because the
  workflow's only notifier sat on the success branch and never ran, and the
  separate `release-sync-check` workflow caught the drift the next morning
  with no permission to open an issue while nobody was watching Actions.
  Both workflows now end in a `notify-on-failure` job that opens one issue
  per incident, deduped by an authorship, label and title-prefix match so a
  green run, a repeat failure or a reopened tag do not create duplicates,
  and guarded against a passer-by planting or hijacking the tracker on this
  public repository. CI-only; nothing under `src/` moved (#121).

## [0.10.0] — 2026-08-31

A PATCH under this file's own rule, corrected from the MINOR this paragraph
first claimed (Copilot caught it post-merge on #106). `formatRecentPage` now
picks its closing sentence from three states instead of two — but the states
were always there: `next_cursor` present-and-well-shaped, present-and-not, and
absent. What changed is WHICH SENTENCE an existing state gets, and a tool's
output text is exactly what "A patch may change TEXT" above covers. No tool,
parameter, annotation or route moves, and nothing moves data; the shape check
itself is byte-identical. "A new branch" is not a criterion this file states —
the criterion is SHAPE or ROUTING, and neither moved.

MINOR by this file's own rules, and stated up front: `memory_list_recent`
changes what goes on the wire. One request for the caller's `limit` becomes a
short series of small ones, and `limit` — which the schema already described as
a page size — is now a ceiling the page may legitimately come in under. No
tool, parameter, annotation or route changes; nothing moves data.

A BEHAVIOUR change, and therefore MINOR rather than a patch under this file's
own rules: there are two things `apiFetch` used to do with the API key that it
no longer does. Both were CodeRabbit findings on #93, both were pre-existing,
and both were deliberately kept OUT of that release — its entry declares itself
text-only ("no new request is made"), and a transport change riding inside a
wording release is exactly what that declaration exists to prevent (#99).

### Fixed

- **The recent-feed's end-of-feed line no longer conflates "nothing older"
  with "cursor could not be printed"** (#67). `formatRecentPage`
  (`src/render.ts`) used to decide the tail with one boolean: cursor absent,
  and cursor present-but-failing-the-opaque-shape-check, both printed
  `(end of feed — nothing older)`. That is could-not-render spelled exactly
  like does-not-exist — the collision 0.8.1 fixed everywhere else, recorded
  there as "Known and NOT fixed here" (see the 0.8.1 entry below). The
  shape check itself is unchanged (CN-032 defense-in-depth stays as strict as
  it was); only what gets said when a cursor fails it does. There are now
  three branches: no cursor still says `(end of feed — nothing older)`; a
  cursor that fails the shape check now says "More entries exist but the
  continuation token could not be displayed — narrow the window with
  since/until instead" (`since`/`until` are already parameters on
  `memory_list_recent`, so the advice is actionable today); a cursor that
  passes still says "More older entries exist — pass cursor: …".
- **The room usage line names what the membership scope actually allows.**
  `memory_join_room`'s description and its usage sentence, and
  `memory_list_rooms`'s per-room tail, all used to say "use domain=... [on
  memory_write / memory_read] to read and write the shared room" — true for a
  `read_write` membership, false for a `read` one: core refuses that member's
  `memory_write` with a 403 "Read-only membership cannot write to this room".
  All three surfaces now name `memory_read` unconditionally and only promise
  `memory_write` where the scope is `read_write`; a `read` membership is told
  the write will be refused, and a scope the response did not report at all
  gets no promise about write either way. Text-only.
- **`memory_write.domain` now says names are matched byte-for-byte.** The
  handler has long refused to trim or normalise a domain — a leading space
  opens a separate, permanent store beside the intended one — and
  `memory_read.domain` already explained its half of the same rule. This is
  the one place the fork actually gets CREATED, and it was the only silent
  one; the description now says so and points at `memory_stats` for the exact
  name, and names the room-address escape hatch. Text-only.
- **The npm package keyword list no longer claims "forgetting".** 0.9.1
  retracted "learns and forgets" from the README as false — unhelpful
  memories are out-ranked, not erased, and deletion is administrative-only
  since 0.9.0 — but the same claim survived as an npm keyword. Removed as
  part of the same retraction.
- **`llms.txt`'s install command now pins `@latest`,** matching every other
  install snippet in this repo. The bare form npm caches indefinitely and
  stops re-checking the registry (README, "Why `@latest`?") — an agent
  following `llms.txt` verbatim would have installed once and silently
  stopped receiving updates. `llms.txt` is hand-maintained (confirmed against
  `scripts/generate-configs.mjs`'s `OUTPUTS` list, which does not include it),
  so the fix is direct.

- **`memory_feedback` reads its own count honestly.** `r?.updated_count ?? 0`
  folded three different failures onto the same number:

  - **A count the service did not send was reported as zero.** A 200 without
    the field, an explicit `null`, and a 204 (which `apiFetch` turns into `{}`)
    all became `0` — and `0` prints *"No feedback was recorded — none of those
    ids matched a memory in your own domains"* followed by three causes for it.
    That is an absence claim read out of a body that carried no claim, and
    against core's async path — which acks before the worker runs — it can be
    a flat lie about a rating that was applied. The rule `memory_stats` already
    states in its own source now holds here too: a field the server did not
    send is UNKNOWN, not zero, and unknown gets its own sentence that diagnoses
    nothing.
  - **A string `"0"` is not `0`,** so `??` passed it through and the ±1
    branches printed *"The service reports 0 memories updated — they should
    surface sooner next time"*: two clauses contradicting each other inside one
    sentence. A negative passed through the same way (*"reports -2 memories
    updated"*). Only a non-negative integer is now treated as a count.
  - **A partial application was reported as an unqualified success.**
    `atom_ids.length` was never compared with the count, so five ids and
    `updated_count: 2` printed the success line and three silent misses — the
    typical shape of the room case, where half the ids came off a room read
    this tool cannot reach. The answer now says how many missed and why, reusing
    the zero branch's causes verbatim so the two cannot drift. A shortfall can
    only come from core's SYNC path (the async ack is exactly
    `len(atom_ids)`), where the number is the authoritative count of atoms that
    existed — so the diagnosis is sound, not a guess. A count LARGER than the
    ids sent is no shape core produces, but `MNEMOVERSE_API_URL` points
    wherever it is pointed: it is now named as not-a-per-id-result rather than
    printed as nine of the caller's memories rated.

- **"Negative feedback lets it fade" is gone from the three surfaces that
  outlived its own retraction (#95).** 0.9.1's own entry above records the
  claim as withdrawn — nothing time-decays, nothing is auto-deleted, and
  deletion has been administrative-only since 0.9.0 — and the README lost it.
  The `memory_feedback` tool description, the sentence the handler prints after
  every downvote (*"they should fade"*), and `llms.txt` all kept it. All three
  now carry the wording that release put in its place: a downvoted memory is
  **out-ranked, not erased**. `llms.txt` is hand-written — it is not one of the
  19 artifacts `verify:configs` checks, which is exactly how it went unnoticed
  — so it is now covered by the withdrawn-claims ban in
  `test/descriptions.test.ts`, which bans the word corpus-wide.

  Text-only, and one internal branch — a PATCH by this file's own rule.

- **A value with the wrong wire type can no longer kill the tool call it
  appears in.** `safeInline` was `(s ?? "").replace(…)`, which throws on
  anything that is not a string — and the MCP SDK turns a thrown Error into the
  ENTIRE result. So one numeric `agent_name` on one item of fifty replaced a
  page of memories with `(s ?? "").replace is not a function`: no `Mnemoverse: `
  prefix, no diagnosis, nothing to act on — the one shape every other failure in
  0.9.1 was rewritten to avoid. Five call sites took a wire value unnarrowed
  (the author tag on every read and feed line; `address` and `room_id` on
  memory_create_room; `scope` and `address` on memory_join_room; `alias` and
  `context` on vault_list). `asRoom` had already closed this class for the room
  list and recorded it as "a latent crash fixed"; this is the same fix, applied
  where that one did not reach. A field that cannot be read now costs the reader
  that field — an absent author tag, `(no alias)`, "the server did not return a
  room address" — and nothing else.

- **A timestamp without an offset is read as UTC, which is what the engine
  means by it.** `new Date("2026-08-01T23:30:00")` reads the value as LOCAL
  time, and `toISOString()` then printed the local reading with a `Z` — so the
  same stored atom carried a different clock time in every timezone a client sat
  in, and west of UTC a different DAY: `2026-08-01 23:30Z` in UTC, `14:30Z` in
  Asia/Tokyo, `2026-08-02 06:30Z` in America/Los_Angeles. The convention was
  already written down twice (both `since` descriptions, core's schema) and
  implemented once, in the future-watermark note; the renderer read the same
  wire value the other way. `parseAsUtc` now lives in `src/time.ts` and both
  modules use it — one convention, one implementation. A `created_at` that
  arrives as a number is no longer rendered as a date the contract does not
  promise.

- **memory_stats can no longer exceed the 25K-token result cap.** It was the
  one surface that never went through `capResult`, and its `Domains:` line is
  linear in the number of stores — 4,000 domains rendered 100,391 characters
  against a 96,000 cap, deterministically, with no hostile input involved. The
  fix bounds the LIST rather than the message, because a blind cap truncates
  from the end and would have taken the average-quality line and the reminder
  that rooms are separate stores down with the wall of names. What is cut is
  counted and says why, in its own clause: `(+400 more names not shown — the
  list is longer than one tool result can carry, so a name you do not see here
  may still exist)` — kept separate from the existing "cannot be printed
  exactly" count, because those are different facts about different names. This
  tool's own description sends readers here to confirm a store's exact name, so
  a silently shortened list would have answered that question with a false
  negative. `capResult` is now wired here too, as a second belt.

- **A write result this client cannot read is no longer reported as a refusal
  with a reason nobody gave.** `memory_write` branched on `if (r?.stored)`, so
  every 2xx that did not say `true` — a 204, an empty `{}`, a gateway's
  `{"ok":true}`, a `MNEMOVERSE_API_URL` aimed at something else — fell into the
  else-branch and printed `NOT STORED — nothing was saved.` followed by the
  mechanism: *"Writes are gated on how much a memory adds over what is already
  in the same domain, so a near-duplicate is refused."* Two claims, neither
  with evidence: that the memory is not in the store, and why. The four LIST
  surfaces have refused to make that substitution since 0.8.1 (truth F13);
  the write was the one left out. It now requires `stored` to be a real
  boolean, and answers an unreadable body with the same sentence the lists use
  — plus the clause a write needs: the outcome is unknown, so report the retry
  rather than this call, and tell the user neither that it saved nor that it
  was refused. A genuine `{"stored":false}` keeps the refusal and the
  mechanism unchanged.
- **A reply that arrived and could not be read is no longer diagnosed as "the
  network is down".** `JSON.parse` failing on a 200 was wrapped in the same
  error as `fetch()` rejecting, so a captive portal, a MITM proxy, an SPA
  shell served as `200 text/html`, or a body that stopped mid-stream all
  printed *"the memory service could not be reached at all — POST /memory/read
  failed before any HTTP response came back… That is a connectivity or DNS
  problem"* — while the Raw detail underneath quoted a `SyntaxError` out of the
  body it had just called nonexistent. Every clause was false, and the
  instruction it implies sends the user to debug working wifi. Such a response
  now gets its own explanation, naming the status that DID arrive, quoting the
  first 200 bytes of what could not be parsed (through the same inert filter as
  every other quoted body), pointing at `MNEMOVERSE_API_URL` and whatever sits
  in front of the API — and blaming neither the network nor the key. A real
  transport failure keeps the wording written for it, and the same treatment
  covers a body that dies mid-read on a non-2xx, which used to discard its
  status entirely.

- **A feed page is bounded by SIZE, not only by item count (#104).** Catching
  up on a shared room of long archival entries with
  `memory_list_recent(domain: "xroom:…", limit: 40, cursor: …)` returned ONE
  tool result of 72,648 characters. Claude Code refused to inline it and
  spilled it to a local file, which the agent then had to re-read in chunks; a
  client without that fallback loses the page entirely. This is the read-side
  half of a failure already recorded on the write side — the ten-agent dogfood
  of 2026-08-07 (#64) lost an agent to "died on the output limit".

  The global cap did not fire, and could not have. `MAX_RESULT_CHARS` is
  96,000, i.e. `24,000 tokens × 4 chars/token`, and 4 chars per token is an
  average over ordinary prose. Archival room entries carry ids, code,
  punctuation and non-ASCII and tokenize far worse, so a page that is 25%
  under the cap by that arithmetic was already past what the client would take.
  A cap derived from an optimistic ratio is not a promise about anyone's real
  limit.

  `limit` could not solve this from the caller's side either. It bounds the
  COUNT, and whether a count is safe depends on how long the entries happen to
  be — 1,500–4,000+ characters each in coordination rooms, against a 10,000
  write cap — which the caller cannot know before asking. Too high explodes;
  too low costs dozens of round trips for the same catch-up.

  The handler now assembles a page from sub-requests of at most ten entries and
  stops BEFORE a character budget (40,000) is exceeded, returning the server
  cursor of the last FULLY accepted sub-batch. The batch is small because a
  cursor names a batch boundary and nothing finer: that boundary is the
  granularity at which a page can end without skipping or repeating an entry.
  The returned cursor therefore continues exactly where the page stopped, and
  the tail already says so. A short-entry feed is unaffected — the budget never
  binds, the same entries come back with the same cursor.

  Two deliberate limits of the fix. The budget YIELDS to a single entry larger
  than itself: that entry is returned whole, as a page of one, because dropping
  it is silent data loss and truncating it needs a fetch-one-entry-by-id verb
  this server does not have (suggestion 2 of #104, not attempted here).
  And 40,000 is a conservative guess, not a measurement — roughly half of what
  already failed — because no client's true boundary has been measured.
  `MAX_RESULT_CHARS` is untouched: it is shared with `memory_read` and every
  other surface, and stays the final backstop after this budget has done its
  work.

- **A sub-request that fails mid-page no longer costs the whole page.**
  Chunking multiplies requests per call and so multiplies the chance one of
  them fails; throwing away the entries already fetched would make this change
  a regression for exactly the rooms it is for. The page is returned with its
  honest cursor and one sentence saying it stopped early because the next
  request "did not come back usable" — a short page with a valid cursor is
  otherwise indistinguishable from a page the budget ended, which is the
  could-not-fetch/does-not-exist collision this project keeps closing. A
  failure on the FIRST sub-request still surfaces as the error it is, including
  the endpoint-absent degrade.

- **The tool now says all of this to the model reading it.**
  `memory_list_recent` states that a page is bounded by size and that the
  cursor holds the rest; `limit` is described as a ceiling rather than a page
  size, with the practical guidance suggestion 3 of #104 asked for (in
  long-entry rooms, ask for 5–10 — a large `limit` there buys nothing the
  budget will not take back and costs round trips); `domain` warns that room
  entries are long enough that paging is the normal case.

### Security

- **`MNEMOVERSE_API_URL` must address the API over https, or the tool refuses
  to run (CWE-319).** `apiFetch` attached `X-Api-Key` to whatever the variable
  held, so a base URL spelled `http://` — a typo, a copied tunnel address, a
  misread doc — put a live `mk_live_` key in cleartext on every hop between the
  user and that host, on every single tool call, with nothing anywhere saying
  so. The key is the whole account: it reads and writes that user's memory. A
  refused base URL now fails the call **before the request is made**, with:

  > Mnemoverse: this tool did not run, because MNEMOVERSE_API_URL does not
  > address the API over https — its scheme is `http://` — and sending the API
  > key to it would put a live `mk_live_` key on the wire in cleartext […] Tell
  > them to change MNEMOVERSE_API_URL to the https:// form of the same host […]
  > or, if they are deliberately running the engine on their own machine, to
  > address it as http://localhost or http://127.0.0.1 […]

  `http://localhost` and `http://127.0.0.1` stay legal, because a self-hosted
  engine is a real setup. They are compared as literal HOSTNAMES, not as string
  prefixes: `http://localhost.evil.example` passes a prefix test and
  `http://evil.localhost` passes a suffix test, and both are somebody else's
  server. The message names the scheme but never quotes the URL — the URL is
  where `http://user:pass@host` keeps its credentials.

- **IPv6 loopback is exempt too — `http://[::1]` is accepted (#99 follow-up).**
  The guard above shipped with two literal hosts, and this file's own "Known and
  NOT fixed here" recorded the third as missing: an engine bound to `::1` was
  refused outright, and its owner had to respell the same machine as
  `localhost`. `http://[::1]:8100/api/v1` now passes, at both credential-bearing
  call sites — the tool path and the startup probe, which reads the same
  verdict. This is a BEHAVIOUR change and not a wording one: a base URL that was
  refused yesterday is sent to today, which is why it is a MINOR line and not a
  patch.

  The comparison carries the brackets, because that is what the parser hands it:
  `new URL("http://[::1]:8100").hostname` is `"[::1]"`, not `"::1"`. The long
  form `[0:0:0:0:0:0:0:1]` is compressed to that same value before the guard
  sees it, so one literal covers both spellings a user might type.

  Two addresses stay refused, deliberately, and both are pinned as refused rows
  rather than left to be rediscovered. **`host.docker.internal` is not
  loopback**: it resolves through the container's resolver to an address on the
  host network, so the key is on the wire before anything knows where it lands —
  "aimed at my own machine" is a claim about intent, and this guard is about the
  transport. **`[::ffff:127.0.0.1]` is not exempt** either: it does reach
  127.0.0.1, but it is a fourth spelling of a machine that already has three
  legal ones, and widening the exemption that stands between a live `mk_live_`
  key and cleartext is a decision, not a convenience.

  All three messages that name the legal hosts — the tool-call refusal, the
  unparseable-URL refusal, and the startup skip line — now say three. The
  tool-call one counted them out loud ("the only two plain-http hosts this
  client accepts"), which is the shape of sentence that goes quietly false the
  moment the list changes, so the test asserts the count as well as the hosts.

- **A credential-bearing request no longer follows redirects (CWE-200).**
  `fetch` defaults to `redirect: "follow"` and Node re-sends request headers to
  the redirect target — the WHATWG rules strip `Authorization`, `Cookie` and
  `Proxy-Authorization` on a cross-origin hop and say nothing about a custom
  header, so `X-Api-Key` rode along. An endpoint answering
  `302 Location: https://attacker.example` therefore received a live key, and
  the tool call SUCCEEDED, so nothing looked wrong. `apiFetch` now sends
  `redirect: "error"`, after the options spread so no call site can opt out.
  This API serves one stable base path and never redirects legitimately, so the
  only traffic this refuses is an exfiltration path.

- **A refused redirect says so, instead of being read as a dead network.**
  Undici reports it as `TypeError: fetch failed`, identical to an unreachable
  host, so without a branch of its own it would have landed in the transport
  message and told the user to debug a "connectivity or DNS problem" on a
  network that is working perfectly. `explainNetworkFailure` now recognises it
  and names the cause: the API tried to redirect the call, the key was not sent
  to the target, check `MNEMOVERSE_API_URL`. This is why the fix is three
  changes and not one line.

- **The startup key probe is covered too — it is the SECOND credential-bearing
  call site.** `probeApiKeyInBackground` (0.8.4) calls `fetch` directly rather
  than through `apiFetch`, so neither guard above reached it, and it fires on
  every server START rather than on a tool call: a user whose
  `MNEMOVERSE_API_URL` was spelled `http://` leaked the key by launching their
  editor, and the tool-call guard would then have refused to leak a key that was
  already out. Closing one call site and not the other would have made this
  entry's own security claim a half-truth. The probe now makes no request at all
  against a refused base URL, and sends `redirect: "error"` when it does run.
  A skipped probe is not silent — silence is the invisible failure the probe
  exists to end — so stderr, where MCP clients surface connection logs, gets:

  > Mnemoverse: startup key check SKIPPED, and nothing was sent —
  > MNEMOVERSE_API_URL has the scheme http:// rather than https://, and this
  > server will not put your API key on the wire in cleartext. Set it to
  > https://core.mnemoverse.com/api/v1, or to http://localhost or
  > http://127.0.0.1 if you run the engine yourself. Every memory tool will fail
  > until it is changed.

  A probe whose redirect is refused stays silent, like every other probe
  failure: it is fire-and-forget and must never take the server down, and the
  same redirect meets the first real tool call, which explains it in full.

### Who this breaks

Anyone who deliberately pointed `MNEMOVERSE_API_URL` at a plain-`http://` host
that is not `localhost`, `127.0.0.1` or `[::1]`, and anyone whose endpoint
answers a redirect. Both were sending the API key somewhere it should not go, which is
why the break is the fix — but it is a break, and that is what makes this
release MINOR.

### Known and NOT fixed here

- **No per-entry truncation, and no way to fetch one entry by id.** An entry
  larger than the whole budget still ships whole. `body_max_chars` /
  `summary: true` (suggestion 2 of #104) would strand the reader without a
  companion fetch-by-id verb, since ids are usable only for feedback today.
- **The budget is not calibrated.** 40,000 is chosen to be safely under a
  known failure at 72,648, not measured against any client's actual
  tool-result limit.
- **A large `limit` now costs round trips.** `limit: 100` over a short-entry
  feed is ten sub-requests where it used to be one, and those are sequential.
  The engine rate-limits per minute, so a caller who pages aggressively is
  closer to a 429 than before. Sizing later chunks from the average entry
  length already measured would remove most of this, and is not attempted here.

### Tests

`test/base-url-guard.test.ts` boots the server once per base URL
(`vi.resetModules()` plus a dynamic import — the seam `test/startup.test.ts`
already uses, since `API_URL` is a module-level constant) behind a recording
`fetch`, so "refused" is asserted as *no request was made and no key was seen*,
not as *the right sentence came back*. `test/redirect-refusal.test.ts`
deliberately does NOT stub `fetch`: a stub has no redirect handling, so
`redirect: "error"` is inert inside one and a test written there would pass with
the option removed. It stands up two real `node:http` servers on loopback and
asserts the redirect target is never contacted at all. With the fix reverted,
that test does not merely fail — it records the attacker's server receiving
`GET /steal` with the header `x-api-key: mk_live_…`, and the tool answering
`Stored (importance: 0.90). ID: leaked`.

The IPv6 exemption is pinned in that file from both sides: `http://[::1]:8100`
and its long form must go out with the key, while `http://[::1]@evil.example`
(where the literal is only userinfo and the host is the attacker's),
`http://[::2]`, `ftp://[::1]`, `http://[::1].evil.example` and
`http://[::ffff:127.0.0.1]` must not — and `test/startup.test.ts` asserts the
probe reaches the same verdict, so the two credential-bearing call sites cannot
drift apart.

The startup probe had no tests at all before this change — `test/startup.test.ts`
*ran* it (autostart calls it) while asserting nothing about it, which is how a
second credential-bearing call site stayed invisible through two releases. It is
now covered there, on the autostart path with `fetch` and stderr recorded: no
request against a refused URL, the skip line pinned verbatim, `redirect: "error"`
on the request it does make, and — as regression guards, so the fix cannot become
a mute button — a healthy https URL and a plain-http `localhost` still probed,
with the key, in silence.

### Post-merge review follow-ups

The bots kept reviewing after these merges landed. Four findings across #106,
#108 and #112 are folded in here rather than left sitting in closed threads.

- **The #67 paragraph at the top of this section said MINOR and meant PATCH**
  (Copilot on #106). Rewritten against the rule it was citing: choosing which
  sentence an already-existing state prints is TEXT, and "a new branch" is not
  a criterion this file states. The two MINOR paragraphs beside it — #104's
  wire change and #99's transport change — are untouched and still MINOR.
- **The two rejected-cursor tests now assert the cursor is not echoed**
  (Copilot on #106). They pinned the sentence only, so a build that printed the
  right sentence AND interpolated the value it had just refused to trust passed
  both. Checked by breaking it: with that value appended to the branch, both
  tests fail.
- **The early-stop budget test is now a boundary fixture** (CodeRabbit on
  #108). Its entries sat far enough under the budget that deleting the note's
  reservation from the fits check changed nothing it measured. Ten entries of
  3,960 characters render to 39,907 — inside the 202-character window between
  the reserved ceiling (39,798) and the budget (40,000) — and the sub-request
  failure is now keyed to the CONTINUATION request rather than to a call
  counter, so both arms reach the early-stop path instead of one of them
  surfacing a raw error. With the reservation removed the page ships at 40,109
  and the test fails on its own length assertion.
- **`memory_join_room`'s description no longer promises a scope line in every
  answer** (CodeRabbit on #112). The handler has a third branch for a response
  that carried no `scope` at all, and that branch names the write access as
  unknown rather than naming a scope (and an `already_member` answer names no
  scope at all) - so the description now describes the write guidance instead
  of promising a scope line: read_write may write, read-only has the write
  refused, and an unreported scope leaves write access unknown. Text-only.

## [0.9.1] — 2026-08-24

Text under this file's own rules: what a tool returns when it fails. No tool,
parameter, annotation or route changes; no new request is made — the one new
thing read off the wire is the `Retry-After` header of a response that had
already arrived. ONE disclosed behaviour correction rides along, because
hiding it under "text" would abuse this file's own definition: the feed's
endpoint-absent classifier now keys on the engine's error CODE being absent
(and recognises the framework router's literal defaults), where it previously
keyed on total silence — so against a deployment that does not serve
`/memory/recent`, whose real answer is `{"detail":"Not Found"}`, the feed
degrades gracefully again instead of surfacing room guidance. Same decision
the branch always intended, now made against the body production actually
sends.

### Fixed

- **A failed tool call now tells the agent what to do, instead of echoing the
  API's wire body.** Reported by Olya's assistant and confirmed with a real
  `tools/call` against production: `memory_write` with a bad key returned
  `Mnemoverse API error 401: {"code":"UNAUTHORIZED","message":"Invalid or
  revoked API key.",…}` with `isError` set. The flag and the status were right
  and the text was useless — the reader of a tool result is a MODEL, and that
  string gives it nothing to act on, so the best case was relaying "error 401"
  to the user and the common case was blaming the network. The same call now
  answers:

  > Mnemoverse: your API key was rejected (401). Tell the user their
  > `MNEMOVERSE_API_KEY` is not valid — if it still reads `"mk_live_YOUR_KEY"`
  > it is the placeholder from the docs and must be replaced with a real key
  > from https://console.mnemoverse.com/dashboard/keys. Do not retry until they
  > replace it.

  Every class of failure gets the same three-part shape — what happened, whose
  problem it is, whether to retry — and the raw body is kept underneath, still
  carrying the literal `Mnemoverse API error <status>` that existing greps and
  runbooks look for. Nothing about debugging gets worse.

- **The status codes are told apart the way the ENGINE actually uses them, not
  the way HTTP folklore does.** Read out of `mnemoverse-core/src/mnemo/api/`
  rather than assumed, because two of the distinctions invert the advice:

  - **403 is not a bad key.** Core returns it for `Room is archived`, `Not an
    active member of this room`, `Read-only membership cannot write to this
    room`, `Invalid room address` and `You do not own this room` — every one of
    them with a perfectly valid key. So the 403 message names the permission,
    points at `memory_list_rooms`, and states outright that the key is not the
    problem. Lumping 403 in with 401 would have shipped a *more confident* lie
    than the raw echo: a user sent to replace a key that had just identified
    them correctly.
  - **429 has three sources with opposite advice.** The per-minute limiter
    sends `retryable: true` with `Retry-After` (waiting works); the daily quota
    and the subscription guard send `retryable: false` (waiting does not — the
    account needs a new day or an upgrade). The message reads that field: one
    branch gives the real wait in seconds and caps the retry at one, the other
    says waiting will not help and points at the usage page. A blanket "wait
    and retry" would have been wrong for two of the three, and an agent looping
    on the first is how a one-minute limit becomes a sustained one.
  - **404 is a room or an endpoint, never a domain.** A domain holding nothing
    reads as empty and never 404s, so "your domain is missing" is the wrong
    guess an agent would otherwise make — the message rules it out by name.
    Only a 404 whose body says *nothing at all* is diagnosed as
    `MNEMOVERSE_API_URL` aimed at something that is not this API.
  - **The engine has two error styles, and only one of them has a `code`.** Its
    middleware writes the full `{code, message, retryable}` envelope, but every
    route raising a FastAPI `HTTPException` — the whole of `rooms_routes.py`,
    with no custom handler to normalise them — serialises to a bare
    `{"detail": "Room not found."}`. The obvious "is there a `code`?" test would
    therefore have told a user with a perfectly good config to go check
    `MNEMOVERSE_API_URL` whenever a room lookup 404'd. The predicate asks
    whether the body carried *either* field instead. (The pre-existing
    `bare404` check had the same flaw — it hunted for the substring `"code"` —
    but its only consumer, `/memory/recent`, is a middleware-envelope route, so
    it never fired there. It does now, on a surface where it would have.)
  - **5xx says it is ours.** Named as a Mnemoverse-side failure, with the
    user's key, config and network explicitly cleared, one retry allowed, and
    the instruction to carry on without memory rather than loop.
  - 400/422 blames the arguments and forbids resending the same body; 409
    explains a spent invite code; any other status admits it has no specific
    guidance instead of inventing one.

- **The two failures that never reached HTTP at all.** A missing
  `MNEMOVERSE_API_KEY` now names the variable, the 30-second fix and the fact
  that every tool will fail identically until it is set — kept deliberately
  distinct from the 401 sentence, because "set a variable you never set" and
  "replace a value you believe in" are different user actions. And a request
  that got no response used to surface as `TypeError: fetch failed`; it now
  says the service could not be reached, clears the key and the quota (no reply
  arrived to implicate either), and separates a timeout from an unreachable
  host by the one word where the advice differs.

- **A behavioural branch is no longer keyed to a user-facing sentence.** The
  recent-feed's "this endpoint is not deployed" degrade decided itself with
  `e.message.startsWith("Mnemoverse API error 404:")`. Rewording that sentence
  — which is this entire change — would have flipped the branch in silence, and
  every per-request 404 would have degraded into a deployment claim about an
  engine that had answered. Non-2xx responses are now an `ApiError` carrying
  `status`, `body` and the parsed envelope, and the branch asks those fields.

### Consistency with the 0.8.4 startup probe

`probeApiKeyInBackground` treats 401 and 403 alike, and stays that way: it calls
`GET /memory/stats`, which addresses no room, so a 403 there can only come from
the auth layer. On a tool call the same status usually comes from a room the
caller named. The two surfaces diverge on 403 for a reason, and agree where it
matters — same `Mnemoverse:` opener, same variable name, same console origin.

### Known and NOT fixed here

- The five specific 403 clauses are selected by matching core's English error
  messages. If core rewords one, that clause degrades to the generic 403
  sentence — which is still true and still refuses to blame the key, but is
  less useful. A machine-readable sub-code on the engine's 403s would remove
  the coupling; there isn't one today.
- `Retry-After` is parsed only in its integer-seconds form. The HTTP-date form
  is legal and is deliberately left unparsed, degrading to "wait about a
  minute" rather than risking a confidently wrong number of seconds.
- Error bodies are truncated at 800 characters, announced in the text. A
  gateway's HTML error page is not worth a model's context window.

### Tests

New cases in `test/errors.test.ts` and `test/errors-keyless.test.ts`, pinning
the wording literally, because here the wording *is* the feature — a test that
merely checked "the message mentions 401" would have passed for the raw echo
that started this. Each class also asserts the wrong cause it must NOT suggest.
Fire-tested: with the change reverted to the old raw echo, the error-class
tests go red across the board, including the pre-existing recent-feed 404
test. `httpError()` in the harness
grew an optional headers argument so the two 429 branches can both be reached.
Verified end-to-end by running the built server over real stdio against
production with a placeholder key, with no key, and with an unreachable host.
### Changed

- **The description claims are strong again, because they are true again (#95).**
  This PR started life on 2026-08-19 as a removal: the read path applied its
  feedback and recency adjustments after ordering and after truncation, so the
  advertised re-ranking never changed what came back, and the honest move was
  to stop saying it. The fork in that PR's own body — "or fix the code, and the
  wording comes back stronger" — is what actually happened: the engine now
  applies those adjustments before the cut (live in production 2026-08-23,
  verified against production with no regression). So the README says "feedback
  re-ranks recall" again, now as a statement of fact. Two claims did NOT come
  back, because they were false for a different reason: "lets the rest fade" /
  "learns and forgets" implied a time-decay or deletion that does not exist —
  unhelpful memories are out-ranked, not erased, and deletion is
  administrative-only since 0.9.0. The recency half-life magnitude also stays
  out: it is a current tuning value, not a contract, and public copy carries no
  magnitudes. Text-only — a PATCH by this file's own rule, riding the next
  release.

## [0.9.0] — 2026-08-20

A MINOR bump under this file's own rule: SHAPE changes — two tools removed —
so this cannot be a patch, and the project is pre-1.0 so a MINOR bump is
where a breaking change belongs.

### Removed

- **`memory_delete` and `memory_delete_domain`** — both tools removed
  entirely: registration, handlers, input schemas, descriptions, and their
  entries in `src/configs/source.json` (and the manifest.json/llms.txt/README
  surfaces generated or written from it). Deletion is withdrawn from this
  agent-facing surface to an administrative, REST-only operation.
  Why: a core delete path destroyed learned Hebbian associations
  tenant-wide (56,683 edges across 14 tenants in the logged incident
  window); the remote MCP connector already excludes delete by design
  (ADR-012); this npm package was the last agent-facing surface still
  exposing it. Founder decision, 2026-08-20.

### Changed

- **Every remaining surface that referenced deletion now points at a
  corrective write instead.** `memory_read`'s description no longer sends
  callers to `memory_delete`; `memory_stats`'s description no longer says
  "before a delete" (now "before writing to it"); the server instructions
  (`SERVER_INSTRUCTIONS`) no longer mention either removed tool and instead
  say: to correct a wrong or stale memory, write a fresh one — deletion is
  an administrative operation, not a tool here.

### Migration

- The REST API's `DELETE /memory/atoms/{id}` and `DELETE /memory/domain/{domain}`
  are unaffected and remain the way to delete, for administrative use.
- To correct a wrong or stale memory from an MCP client, write a fresh one
  with `memory_write` rather than deleting the old one. A non-destructive
  write primitive that marks a memory as superseding an older one is
  planned to replace the delete-for-update lifecycle; no date is promised
  here, and no such tool exists yet.
- If your integration calls `memory_delete` or `memory_delete_domain`
  directly, those calls will fail against 0.9.0 — there is no compatibility
  shim.

## [0.8.4] — 2026-08-16

A patch under this file's own rules: one read-only probe (declared below, as
the rules require), and text — the README the npm page renders.

### Fixed

- **A wrong API key now says so at startup, where the user looks.** Verified
  live on 0.8.3: with a garbage key the server completed `initialize`, listed
  all twelve tools, and wrote nothing to stderr — the 401 only surfaced
  mid-conversation, on the first real tool call. A green connection followed
  by silent failure reads as "the product does not work". Now, if a key is
  configured, one read-only `GET /memory/stats` runs in the background AFTER
  connect: 401/403 puts one human sentence on stderr naming
  `MNEMOVERSE_API_KEY`; other HTTP failures get a soft note that says nothing
  about the key; network errors stay silent (flaky wifi must not cry wolf);
  a valid key keeps startup quiet. The probe never blocks and never exits —
  keyless startup remains exactly as documented for registries. All three
  paths verified by running the built server.
- **README no longer claims a decay the ranking does not have.** "Recall
  fades by recency" was first deleted as false, then restored in precise
  form after an adversarial check proved the engine ships an always-on
  exponential recency boost (weight 0.15, ~30-day half-life): "recall favors
  recent memories". Consolidation is now described as shipping in the engine
  rather than as what keeps hosted recall dense — on the hosted service it
  is switched off.
- **`claude mcp add` snippets now carry `-s user`.** The CLI's default scope
  registers the server for the current project directory only, so memory
  installed in one repo was silently absent in the next — the opposite of
  cross-tool memory, in every install snippet we published. Fixed in the
  generator, so README and all channel snippets changed together.

### Changed

- The two console links in the README carry UTM tags
  (`utm_source=npm&utm_medium=readme&utm_campaign=mcp-memory-server`) — npm
  strips referrers, so these links are the only attribution that channel has.

## [0.8.3] — 2026-08-14

Three claims about ourselves that were not true, all found by review rather
than by us, and all shipped as text — no tool changes shape, no parameter
moves.


### Fixed — claims that stopped being true

- **A refused ROOM write no longer states the personal-domain rule.** The line
  said "so a near-duplicate is refused". As of core#482 (2026-08-13) that is
  false in a shared room: a restatement — a briefing, a status, a decision
  summary — STORES there, because a room is a message bus and the second agent's
  job is to receive what the first was told. Only a write the embedder cannot
  distinguish from one already present is refused. The client now prints the
  rule that applies to the domain it wrote to, names the ~500-token similarity
  window, and drops the "write the delta" advice in rooms, where a restatement
  is the point rather than the mistake. The personal-domain wording is
  unchanged and now pinned by its own test.

- **The novelty score carries the health warning the hosted connector already
  carries.** The number is a first-generation metric, measurably unreliable:
  identical content scored ~0.08 in Russian against ~0.55 in English against the
  same 0.1 threshold — refused in one language, stored in the other. This server
  printed the bare figure while `mnemoverse-mcp-remote` (#36) explained it, so
  the same number reached a model with two different degrees of honesty
  depending on the surface. One surface, one truth (decision 2026-08-12).

- **`memory_feedback` attributes the count instead of asserting it (#68).**
  "Recorded +1 for 3 memories" is true only while core runs
  `feedback_async = False`. Under async, `updated_count` is the number of ids
  SUBMITTED, not applied (core `schemas.py:689-695`), and nothing in the
  response says which mode ran — so a server-side config flip would silently
  turn this sentence false on every installed client. It now reads "The service
  reports N memories updated". The direction echo, which exists so a caller has
  evidence the loop did anything, is unchanged. Twin of the fix the hosted
  connector took the same week.

### Fixed — behaviour

- **The valence explanation in `memory_feedback` was inverted by a core change
  the day before (core#493).** Until 2026-08-13 the engine applied
  `sign(outcome) × |prediction error|`, so a 0 rating took the positive branch
  and pushed valence UP — which dogfooding observed and which this file's
  comment recorded. Core now uses the SIGNED error, `pe = outcome - valence`
  (`memory_engine.py:4986-4988`), so a 0 against a positive valence moves it
  DOWN, toward neutral. Comments are not stripped from `dist/`, so the stale
  explanation would have shipped inside the tarball, contradicting the README
  line this same release adds. Rewritten against the current engine.

- **The outcome-0 branch of `memory_feedback` still asserted its count.** The
  ±1 branches were corrected for #68 and the zero branch was left behind — and
  a test added in this release pinned the wrong wording. Both fixed: it now
  reads "Rating sent: 0. The service reports N memories updated."

- **Honesty probes have a deadline (#73).** The zero-result paths of
  `memory_read` and `memory_list_recent` consult `/memory/stats` and
  `/memory/rooms` so an empty answer can say what it did not cover. Those two
  GETs went through bare `fetch()` with no `AbortSignal`, inheriting undici's
  ~300s default: one hung engine endpoint turned an empty read — instant in
  0.8.0, which probed nothing — into a multi-minute stall. **All three** now
  carry a 4s deadline, chosen against measured production latency
  (`/memory/read` averaged 1,330 ms, max 10.2 s). Three, not two: the first
  pass deadlined only the pair inside `probeScope` and left the stats call on
  the UNSCOPED empty read — the commonest one there is — still able to hang,
  which review caught before the tag. A timed-out probe degrades into the
  existing "unknown" fallback, which already says so; no request changes shape
  and no tool changes its schema.

### Changed — CI

- **`engines: >=18` is now tested rather than asserted (#75).** CI ran Node 20
  only, so a published compatibility promise had never been executed once. The
  full suite cannot answer it — vitest 4 itself requires Node `^20 || ^22 ||
  >=24` and dies on 18 inside `node:util`, which is a fact about our test
  runner and not about the shipped package. So the new `smoke-node18` job tests
  what the promise is actually about: it builds and drives a real MCP
  `initialize` handshake through `dist/index.js` on Node 18. If that goes red
  the claim is false and moves to `>=20` in 0.9 — `engines` is shape, and a
  patch may not change shape.

### Fixed

> **What this release physically delivers, stated because the last one did
> not.** The tag publishes exactly two things: the npm tarball (`dist/`,
> `README.md`, `LICENSE`, `package.json`) and `server.json` to the official MCP
> registry. `manifest.json` is the MCPB extension artefact, and **no workflow
> packs or uploads it** — v0.8.2 shipped zero release assets. So the manifest
> fix below is correct and on main, and it reaches users only when someone
> builds and submits the bundle by hand. Automating that is tracked separately;
> it is NOT delivered by tagging 0.8.3.

- **The privacy policy URL in the extension manifest was a redirect.**
  `privacy_policies` pointed at `mnemoverse.com/privacy.html`, which answers
  307. Anthropic's directory review requires HTTPS privacy URLs and rejects on
  broken ones, so feeding their fetcher a redirect was a needless gamble right
  before a submission. Fixed in `src/configs/source.json` — the SSOT — as well
  as the generated `manifest.json`, because patching only the artefact would
  have been reverted by the next `generate-configs` run. (#78)

- **`vault_list` promised a tool that does not exist.** Its description told
  the agent to find an alias "before a tool that consumes it". There is no
  such tool here: `vault_list` is the only vault tool, the other eleven are
  memory tools. A reviewer following that sentence looks for the consumer,
  fails to find it, and reasonably asks what else is inaccurate. The new
  wording states that no tool on this server returns a secret value — a
  stronger privacy claim than the old one, with the advantage of being true.
  Also added to the `WITHDRAWN` list in `test/descriptions.test.ts`, which
  bans a retracted false claim corpus-wide; the guard was verified by
  restoring the banned phrase and watching the suite go red. (#82)

- **The README's privacy section heading** is now `## Privacy Policy`
  verbatim, which is what the directory review looks for. (#78)

### Added

- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1, byte-identical to the
  canonical text. An earlier draft was silently abridged: it had lost the
  clauses about avoiding contact through external channels and about the
  interaction ban during a temporary suspension. Programmes that diff this
  file against the canon would have seen a weakened enforcement ladder.
- `funding.json` — fundingjson.org v1.0.0 manifest, validated against the real
  schema. Required artefact for the FLOSS fund application.
- `funding` field in `package.json`, so `npm fund` resolves.

### Changed

- **`.mcpbignore` no longer ships repository governance inside the bundle.**
  `funding.json` and `CODE_OF_CONDUCT.md` were riding inside the `.mcpb` — a
  fundraising manifest carrying the maintainer's email is not what a directory
  reviewer expects to find in the artefact. Excluded along with `CHANGELOG.md`,
  `Dockerfile`, `.dockerignore`, `glama.json` and `tsconfig.test.json`, which
  were in there for no reason either. The bundle root is now exactly `LICENSE`,
  `README.md`, `icon.png`, `manifest.json`, `package.json`.

### Not in this release, tracked

- `.github/FUNDING.yml` is deliberately held back. It lights up the Sponsor
  button on a public repository the moment it merges, and the Sponsors tiers
  are not configured — the button would point at an unfinished page.
- `funding.json` still lacks the `wellKnown` provenance the spec wants when
  the manifest host and the URL host differ. It cannot honestly be added yet:
  `mnemoverse.com/.well-known/funding-manifest-urls` returns 404. Publishing
  that file comes first; it gates the FLOSS fund submission, not this release.
- The live server card at `mcp.mnemoverse.com` is served by a different
  repository, so the `vault_list` wording there is fixed separately
  (`mnemoverse-mcp-remote` #41) and needs a deploy, not this publish.

## [0.8.2] — 2026-08-13

Dependency security pass: clears all 32 open Dependabot alerts (7 high, 22
medium, 3 low) — 22 against `hono`, 5 `fast-uri`, 2 `ip-address`, and one each
for `@hono/node-server`, `qs`, `body-parser`. Every one is a transitive
dependency of `@modelcontextprotocol/sdk`; this package's two direct runtime
dependencies are the SDK and zod, and neither was itself vulnerable.

The one deliberate move is raising the SDK floor from `^1.12.1` to `^1.30.0`.
1.30.0 is a minor release with no breaking changes, and it is specifically the
release that widens the SDK's `@hono/node-server` range to admit 2.x — the
patched line for the path-traversal alert, unreachable under 1.29.0's
`^1.19.9` pin. Everything else floats up in the lockfile within ranges the SDK
already declared: `hono` 4.12.12 → 4.13.1, `@hono/node-server` 1.19.13 →
2.1.0, `fast-uri` 3.1.0 → 3.1.5, `ip-address` 10.1.0 → 10.4.0 (via
`express-rate-limit` 8.3.2 → 8.6.2), `qs` 6.15.1 → 6.15.3, `body-parser` 2.2.2
→ 2.3.0. No `overrides` were needed. The dev-only `nanoid` advisory
(GHSA-2v37-7h3g-55p8, vitest → vite → postcss chain, not among the 32) floated
to 3.3.18 in the same pass; `npm audit` now reports zero vulnerabilities.

Stated honestly: most of these alerts never reached running code. This is a
stdio server — the hono/express stack inside the SDK belongs to its HTTP
transports and OAuth handlers, which `server/mcp.js` and `server/stdio.js`
never import, so the vulnerable code was shipped but not loaded. The exception
is `fast-uri`, which IS loaded at runtime through the SDK's ajv schema
validator — though it only ever sees local stdio protocol messages, never
network input. The bump closes all of it regardless: unreachable today is one
transport change away from reachable.

No tool changes shape and no request changes a byte — the wire format is
pinned byte-for-byte by `test/requests.test.ts`, and all 338 tests pass
unchanged against SDK 1.30.0. The published file set is untouched.

### Fixed

- `server.json` / `src/configs/source.json`: the `MNEMOVERSE_API_URL` env
  description promised a self-host path ("unless you self-host the core
  engine") that does not exist — it had shipped to the official MCP registry
  in every version since 0.3.8, including 0.8.1, whose registry manifest
  still carries it. The description now says what the override is for:
  testing against a non-production environment. Registry text corrects
  itself on the next `mcp-publisher` run — description prose only, no shape
  change. (#72)
## [0.8.1] — 2026-08-09

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
characters handled — `trim()` does not strip those) is written down here
**and in #70**: it is not on the 0.9 issue (#64), but it now has an issue of its
own, so the return has a tracker behind it rather than a promise.

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

The suite grew from **31 tests at 0.8.0 to 338**, and the ones that mattered most
were replaced rather than added to. Every number in that sentence is reproducible
— `git archive <ref> | tar -x -C tmp && (cd tmp && npx vitest run)` — and here is
the whole curve, measured that way: `main` **31**, the commit before the gate
**60**, the gate itself **116**, then **119**, **189** after the naming fix,
**213** after the harness (which replaced 17 tests and added 41), **241** after
the probe-state fix, **279** with the assembled-answer file — and through the
third review wave: **284** with the head-selection fix, **289** with the
cursor-page head, **301** with the room-name renderer, **303** with the gloss
corrections, **315** with the unreadable-body guards, **320** with the
legend-after-cap fix, **323** when the fire-drill gaps closed, **337** with the
description pins, **338** with the truncated-room-list legend pin from the review
threads.

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
values come out of the request the handler actually sent. 87 behavioural tests
(78 + 9) live in `test/handlers.test.ts` and `test/startup.test.ts`. What stays a source
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
41 situations — the ones named in the incident and the ones only the matrix
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
  back. The member-visibility asymmetry is filed as mnemoverse-core#465.

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
- **The zero-result probes have no timeout.** They go out through bare `fetch`
  with no deadline, so a hung `/memory/rooms` or `/memory/stats` endpoint can
  stall an empty answer for minutes — on a probe the caller never asked for. The
  truthful "we could not check" arm already exists; a timeout that falls through
  to it is a behaviour change, not a wording one, so it does not belong in this
  patch. Filed as #73.
- **Domain normalisation is not scheduled.** See the trim revert at the top of this
  section: the plan is written there and tracked in #70.

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

#### In this repository

- **`engines` claims Node >=18; CI tests Node 20 only.** The package declares it
  installs on Node 18, and no workflow runs the suite there — so a breakage that
  only bites on 18 would ship green. Either the matrix grows a Node 18 leg or the
  `engines` floor rises to match what is tested. Filed as #75.

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
