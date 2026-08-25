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

## [Unreleased]

A MINOR change under this file's own rule: a new branch, not just reworded
text — see "A patch may NOT change SHAPE or ROUTING" above. `formatRecentPage`
now decides its tail on three states instead of two, so this is a behaviour
change even though every touched line is prose.

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
