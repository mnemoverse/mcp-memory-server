# `@mnemoverse/mcp-memory-server/shared`: building a second MCP server

This is the consumer guide for `/shared`, the entry point ADR-025
(mnemoverse-core) designates as the single source of the Mnemoverse MCP
surface. A server that wants to expose the same ten memory tools does not
keep its own copy: it imports this entry point, supplies its own credential
and wording, and registers.

The first consumer is the hosted connector, `mnemoverse-mcp-remote`, adopting
this package in step 4 of the ADR-025 plan. This file is also that step's S0
delta: what the connector's adapter needs from the package, stated once here
instead of scattered across commit messages.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerMemoryPrompts,
  registerMemoryResources,
  registerMemoryTools,
  SERVER_INSTRUCTIONS,
  MAX_RESULT_CHARS,
  capResult,
  ApiError,
  NetworkError,
  UnreadableBodyError,
} from "@mnemoverse/mcp-memory-server/shared";

const server = new McpServer({ name, version }, { instructions: SERVER_INSTRUCTIONS });
registerMemoryTools(server, { apiFetch, wording, writeAuthor });
registerMemoryPrompts(server);
registerMemoryResources(server, { apiFetch });
```

Importing `/shared` starts nothing. It never pulls in the package's own
stdio entry point (`src/index.ts`), which opens a stdio transport as a side
effect of being imported. A second server can import `/shared` inside its
own process without inheriting that behaviour.

## What `/shared` exports

- `registerMemoryTools(server, deps)`, `registerMemoryPrompts(server)`,
  `registerMemoryResources(server, deps)`. Three separate calls, because a
  consumer that only wants the tools (no prompts, no resources) should not
  have to register the other two.
- `SERVER_INSTRUCTIONS`: the string this package's own stdio server passes
  as `instructions` when constructing `McpServer`. Reusing it keeps the
  model-facing instructions identical across every server that registers
  this surface; a consumer that wants its own instructions can ignore it
  and pass something else.
- `MAX_RESULT_CHARS` and `capResult(text, moreHint?)`: the tool-result text
  cap (96,000 characters, 24,000 tokens) and the helper that applies it. See
  below.
- `ApiError`, `NetworkError`, `UnreadableBodyError` and their supporting
  types `ApiFailure`, `ErrorEnvelope`, `UnreadableBody`: the three error
  shapes `apiFetch` must throw. See below.
- `Wording` and `WriteAuthor`: the two dependency types described in this
  file.
- The types `ApiFetch` and `MemoryToolDeps`.

## The `apiFetch` contract

Every tool reaches the API through exactly one function, supplied as
`deps.apiFetch`:

```ts
type ApiFetch = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
```

- `path` is relative to the API base, for example `/memory/read`. This
  package never constructs a full URL; the base, the credential, and the
  transport are entirely the consumer's own.
- `options.signal` must be honoured. Several tools set a deadline on a
  probe request (`AbortSignal.timeout(...)`); an `apiFetch` that ignores
  the signal turns a bounded probe into an unbounded one.
- A non-2xx response must reject with `ApiError`, constructed from an
  `ApiFailure`: `{ status, body, method, path, retryAfter? }`. `body` is
  the response body verbatim and unparsed; the raw wire body is preserved
  because the agent-facing message quotes it back (see `rawDetail` below).
- A request that never got an HTTP answer at all (DNS, connectivity, a
  timeout, a refused redirect) must reject with `NetworkError`, constructed
  from `(method, path, cause)`.
- A 2xx response whose body cannot be parsed as this API's JSON must reject
  with `UnreadableBodyError`, constructed from an `UnreadableBody`:
  `{ status, method, path, bodyPreview?, cause }`. This is a DIFFERENT
  failure from `NetworkError`: a reply arrived, so telling the caller
  "nothing answered" would be false. `bodyPreview` is absent only when the
  body read itself failed partway through.

The tools branch on these three types (`instanceof`), not on message text,
so `apiFetch` must throw exactly these classes and not, say, a plain
`Error` carrying a similar message. One example: `memory_list_recent`
checks `e instanceof ApiError && e.isBare404` to degrade gracefully when the
feed endpoint is not yet deployed, and that check only fires for the real
class.

## `wording`: how this registration speaks

`MemoryToolDeps.wording` is an optional, typed object. Every field is
optional, and every field's absence reproduces this package's own existing
behaviour exactly, so a consumer supplying no `wording` at all gets
byte-identical descriptions, error text, and request bodies to every release
before this dependency existed.

```ts
interface Wording {
  serverNoun?: "this server" | "this connector";
  auth?: "api-key" | "oauth";
  keysUrl?: string;
  rawDetail?: boolean;
}
```

### `serverNoun`

Three tool descriptions name the server they run on: `memory_read`'s
`top_k` parameter, `memory_feedback`'s `coactivation_edges` output field,
and `vault_list`'s own description. The default is `"this server"`, what
this package's stdio server has always said. Passing `"this connector"`
substitutes the noun in exactly those three descriptions and nowhere else
on `tools/list`; every other description is untouched.

### `auth`

Which credential the CALLER holds, not which one core issued. This is the
switch that stops the error text from telling an OAuth user to edit an
environment variable they do not have.

- `"api-key"` (the default) keeps every existing `MNEMOVERSE_API_KEY`
  sentence: the docs-placeholder wording, the five `details.reason`
  branches (`placeholder_key`, `revoked_key`, `invalid_key`,
  `malformed_key`, `missing_key`), and the "The API key is NOT the
  problem" opener on a 403.
- `"oauth"` is for a server whose user never sees an API key at all, for
  example a hosted connector that mints one on their behalf. No 401 or 403
  explanation under this mode names `MNEMOVERSE_API_KEY`, an environment
  variable, an MCP client config file, or the keys console. Each says what
  an OAuth user can actually do instead.

The exact sentences `auth` switches, api-key default on the left and
`"oauth"` on the right:

**401, no named tenant problem.** Every 401 that is not "caller org not
identified" (every `details.reason` value, an unrecognised reason, the raw
API-key substring guess, a bare envelope, or silence) collapses under
`"oauth"` to one sentence, in place of five separate reason-flavoured
sentences and the founder-endorsed generic one:

> api-key (one of several, e.g. the generic form): "Mnemoverse: your API
> key was rejected (401). Tell the user their MNEMOVERSE_API_KEY is not
> valid ... it must be replaced with a real key from
> https://console.mnemoverse.com/dashboard/keys. Do not retry until they
> replace it."
>
> oauth: "Mnemoverse: the user's sign-in was rejected (401). This is not
> something they fix by editing a key — tell them to disconnect and
> reconnect the app, or sign in again, to refresh their session. Do not
> retry until they do."

**401, "caller org not identified".** This branch is about tenant
identification, not about a key, so it fires under either mode, worded for
whichever credential the caller actually holds:

> api-key: "...The API key itself was not rejected — do NOT tell the user
> to replace it..."
>
> oauth: "...The caller's sign-in itself was not rejected — do NOT tell
> the user to reconnect over this..."

**403, a named cause.** Only the one clause naming the credential as
innocent changes; the room-permission cause itself (archived, not a
member, read-only, invalid address, not the owner) does not mention a key
either way and is unchanged:

> api-key: "Mnemoverse: this request was refused (403). The API key is NOT
> the problem — it identified the account fine, and this was a permission
> decision. [cause] Do not retry the same call: it will be refused again."
>
> oauth: "Mnemoverse: this request was refused (403). Your sign-in is NOT
> the problem — it identified the account fine, and this was a permission
> decision. [cause] Do not retry the same call: it will be refused again."

**403, the engine said nothing parseable (a proxy, a WAF, a wrong base
URL).** Unchanged by `auth`: this branch already names no credential,
because the module cannot tell who refused the request.

**429, all three branches (per-minute limit, daily quota, unknown).**
Unchanged by `auth`. None of the three 429 sentences ever named
`MNEMOVERSE_API_KEY`, an environment variable, an MCP config file, or the
keys console; "wait for the retry window" and "check the account's plan"
(the quota branch already points at the usage console) already read
correctly for an OAuth user with no changes.

`auth` has no effect on 404, 409, 422/400, 5xx, or the network- and
unreadable-body-failure explanations: none of those sentences name the
credential type one way or the other.

### `keysUrl`

Replaces the console URL wherever the api-key vocabulary prints one
(`https://console.mnemoverse.com/dashboard/keys` by default), for a
deployment whose key-management page lives somewhere else. The engine's own
validated `details.keys_url` on a live 401, when present, still wins over
this fallback: it is the more specific, more current source for that one
failure. `keysUrl` has no effect under `auth: "oauth"`, which prints no
console URL at all.

### `rawDetail`

Whether the wire body's raw tail (the `Raw detail — Mnemoverse API error
<status> on <method> <path>: ...` line, or its network- and
unreadable-body-failure equivalents) is appended after the guidance.
Defaults to `true`, unchanged from every release before this field existed.

This is held in reserve, per the owner's STEP4-3 decision: ship the flag,
default it on, and set it to `false` only once a specific deployment's
core-side error envelopes are checked and found to echo request content
back in `details`. Until that check happens, there is no reason to drop
diagnostic detail a human debugging at 3am relies on.

## `writeAuthor`: vouching for the end user behind a write

```ts
writeAuthor?: () => WriteAuthor | undefined;

interface WriteAuthor {
  principal?: string;
  agent?: string;
  agent_name?: string;
  client_env?: string;
  is_external?: boolean;
}
```

Called once per `memory_write`, with no arguments. A returned value is sent
as the request body's `author` field exactly as returned, with no
field-level normalisation beyond a `typeof` guard confirming it is an
object (core re-normalises every field server-side). Returning `undefined`,
or omitting the dependency entirely, produces the exact write body this
package has always sent; the stdio server supplies no `writeAuthor` at all,
and its requests do not change.

`WriteAuthor` mirrors core's `ProvenanceWriteSchema`
(`mnemoverse-core src/mnemo/api/schemas.py:123-150`) field for field, all
five fields optional.

**Core's supplier rule**, verified against `_get_provenance`
(`mnemoverse-core src/mnemo/api/routes.py:211-276`) on 2026-09-24: the body
`author` is honoured ONLY for a SERVICE/supplier caller vouching for a
participant, and is IGNORED entirely for an OIDC end-user, whose
provenance is stamped solely from their own verified token. An end-user
can never set authorship this way; that is the anti-spoof boundary the
schema exists to hold. Practically, this dependency is useful only to a
server that authenticates to core as a supplier (a hosted connector minting
its own service token) and wants to vouch for the human behind the
request, such as attributing a shared-room memory to its actual author
instead of to the connector's own service identity.

## `MAX_RESULT_CHARS` and `capResult`

`MAX_RESULT_CHARS` is `96_000` (24,000 tokens), the hard cap this package
applies to a tool result's TEXT, required by the Claude Connectors
Directory submission policy. `capResult(text, moreHint?)` truncates a
string to that cap on a code-point boundary (never inside a UTF-16
surrogate pair) and appends a truncation notice; the default `moreHint`
points at narrowing a query, and a caller with a no-argument tool (a
discovery list) can pass its own hint instead.

`structuredContent` is NOT capped (OD-11): the cap is text-only, because a
client reading `structuredContent` already receives a typed, bounded shape
and does not need the same defensive truncation a raw text blob does.

## Prompts and resources

`registerMemoryPrompts(server)` registers three named shortcuts (`recall`,
`save_insight`, `what_do_you_know`) that call nothing themselves; each
renders one message asking the model to use `memory_read` or
`memory_write`. It takes no dependencies.

`registerMemoryResources(server, deps)` registers one resource template,
`memory://item/{memory_id}`, that opens a single saved memory by id through
`deps.apiFetch`. It reads the caller's own store only; a memory from a
shared room cannot be opened by id here. It takes the same `MemoryToolDeps`
shape as `registerMemoryTools`, though today it reads only `apiFetch`.

## Versioning

This package is pre-1.0, and its own CHANGELOG states the PATCH/MINOR
rules for its tool surface (see the README's "Tool surface stability"
section). A consumer depending on `/shared`:

- Keeps its OWN semver line. A consumer's release and this package's
  release are different events; bumping this dependency is not, by
  itself, a reason to bump the consumer's own version, and a consumer
  fixing its own bug is not a reason to touch this package's pin.
- Pins an exact version (or a narrow range plus a committed lockfile),
  the same way `mnemoverse-mcp-remote` pins every other production
  dependency, rather than floating on a caret range against a package
  whose MINOR releases can add tools and output-schema fields.
- Reports the PACKAGE's version as the surface version, alongside its own.
  A client asking "what memory surface am I actually talking to" needs
  the package version (what `tools/list` shape to expect), not just the
  consumer's own release number, which tracks the consumer's unrelated
  changes (auth, deployment, observability) as much as the surface.

## The currency guard pattern

A consumer that depends on this package should run a scheduled and
per-PR check comparing the version it has LOCKED against the version
CURRENTLY PUBLISHED on npm, and fail loudly when it falls behind. The
connector's own guard (`mnemoverse-mcp-remote scripts/check-package-currency.mjs`)
is the reference implementation: it reads the declared range from
`package.json` and the installed version from `package-lock.json`,
fetches `https://registry.npmjs.org/@mnemoverse/mcp-memory-server/latest`,
and compares the two as `[major, minor, patch]` tuples, reporting
`current`, `ahead` (a prerelease, or npm has not caught up), `behind`
(fails the check), or `unreadable` (fails the check). Paired with
Dependabot opening the version-bump PR, this is the alarm for a bump that
was proposed but never merged: the drift this whole `/shared` entry point
exists to end is exactly a consumer's copy of the surface falling behind
the package's, and an unmerged dependency bump is that same drift in a
different shape.
