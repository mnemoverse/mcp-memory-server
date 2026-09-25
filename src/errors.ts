/**
 * What a failed API call TELLS THE AGENT TO DO.
 *
 * WHY THIS MODULE EXISTS. Until now every non-2xx became one sentence:
 *
 *     Mnemoverse API error 401: {"code":"UNAUTHORIZED","message":"Invalid or
 *     revoked API key.","requestId":null,"retryable":false,"details":null}
 *
 * The `isError` flag and the status code were right; the TEXT was a raw echo of
 * a wire body. Verified against production with a real `tools/call`
 * (2026-08-16): with a bad key, `memory_write` returns exactly that. The reader
 * of a tool result is a MODEL, and that string gives a model nothing to act on,
 * so the two things it actually does are relay "error 401" to the user or guess
 * — and the cheapest guess is "the network is down", which sends the user to
 * debug a working network while a placeholder key sits in their config.
 *
 * Every message here therefore answers three questions in order: what happened,
 * WHOSE problem it is, and what to do next — including, explicitly, whether to
 * retry. "Do not retry" is not decoration: an agent that loops on a 429 turns
 * one rate-limit into a sustained one, and an agent that loops on a 401 burns a
 * conversation on a key that will never start working.
 *
 * THE RAW BODY IS NEVER DROPPED. It is appended after the guidance, still
 * carrying the literal `Mnemoverse API error <status>` that this repo's tests
 * and anyone's grep already look for. Making the text kind to an agent must not
 * make it useless to a human debugging at 3am.
 *
 * WHAT THE STATUS CODES ACTUALLY MEAN HERE, verified by reading the engine
 * (mnemoverse-core `src/mnemo/api/`, 2026-08-16) rather than assumed from HTTP
 * folklore. The distinctions below are the entire point of this file:
 *
 *   401  auth.py — "Invalid or revoked API key." / "Missing API key." The key.
 *        (Read on 2026-08-16. Since 2026-09-20 the engine answers a sentence
 *        per cause and adds `details.reason` and `details.keys_url`; the old
 *        sentence is what an engine without that change still sends, which is
 *        why explain401 keeps the substring branch as its fallback.)
 *   403  routes.py, rooms_routes.py, auth.py — "Room is archived", "Not an
 *        active member of this room", "Read-only membership cannot write to
 *        this room", "Invalid room address", "You do not own this room", plus
 *        the OIDC scope rules. NOT a bad key: the caller was identified and
 *        then refused. Telling the user to replace a working key over a 403
 *        would be a new, more confident lie than the raw echo was.
 *   404  A room that does not exist for this key — or, when the body says
 *        nothing at all, a path the deployment does not serve. A DOMAIN never
 *        404s: an empty domain reads as empty, so "your domain is missing" is
 *        the wrong guess and is named as wrong below.
 *   429  THREE different causes with opposite advice. rate_limit.py returns
 *        `retryable: true` with a `Retry-After` header (waiting works);
 *        usage.py (daily quota) and subscription_guard.py (atom limit, payment
 *        past due) return `retryable: false` (waiting does NOT work — the
 *        account needs an upgrade or a new day). A blanket "wait and retry"
 *        would be wrong for two of the three.
 *   5xx  auth.py returns 503 `retryable: true` when its DB pool is gone. Ours,
 *        not theirs.
 *
 * A 2xx CAN FAIL TOO, and gets the same treatment for the same reason. A reply
 * whose body this client cannot parse is not a status at all, so none of the
 * sentences above fit it — and it used to borrow the TRANSPORT sentence, which
 * asserts that nothing answered. `explainUnreadableBody` at the bottom of this
 * file owns that case now; the distinction it protects is "a reply arrived and
 * was unreadable" versus "no reply arrived", which have opposite fixes.
 *
 * RELATION TO THE STARTUP PROBE (src/index.ts, `probeApiKeyInBackground`, added
 * in 0.8.4). That probe treats 401 and 403 alike, and is right to: it calls
 * `GET /memory/stats`, which addresses no room, so a 403 there can only come
 * from the auth layer. On a TOOL CALL the same status usually comes from a room
 * the caller named, which is why the two surfaces diverge on 403 and must not be
 * "unified" by a later reader. They agree where it matters: same `Mnemoverse:`
 * opener, same `MNEMOVERSE_API_KEY` variable name, same console origin.
 */

/** Where the raw detail stops. A gateway can answer with a megabyte of HTML,
 *  and an error message is not a place to spend a model's context — but the
 *  first few hundred characters are where the useful part of any real error
 *  body lives. Truncation is announced, never silent. */
const MAX_BODY_CHARS = 800;

/** The console page that issues keys — the one place a user fixes a 401.
 *  Exported so src/requests.ts can point at the same URL from
 *  `refusePlaceholderKey` instead of repeating the literal (the engine is
 *  becoming a second producer of this same URL, `details.keys_url` on a 401
 *  body, which is validated against an allow-list rather than trusted
 *  outright, see `validatedKeysUrl` below, but this constant stays the
 *  fallback for both). */
export const KEYS_URL = "https://console.mnemoverse.com/dashboard/keys";

/** The console page that shows quota and upgrades — where a 429 that waiting
 *  cannot fix is resolved. Same URL the engine puts in its own 429 bodies. */
const USAGE_URL = "https://console.mnemoverse.com/dashboard/usage";

/** The base URL a user is sent back to when theirs is aimed somewhere wrong.
 *  Mirrors `DEFAULT_API_URL` in src/index.ts and is duplicated on purpose: this
 *  module is imported BY index.ts, so reading the value from there would be a
 *  cycle. Change one, grep for the other. */
const DEFAULT_API_URL = "https://core.mnemoverse.com/api/v1";

/**
 * How a server that registers these tools wants its failures worded (STEP4-2,
 * STEP4-3, owner decisions 2026-09-24). Every field is optional, and every
 * field's absence means exactly what this file already does today: the
 * whole point is that a consumer supplying no `wording` at all gets
 * byte-identical text to before this type existed.
 *
 *  - `serverNoun`: what the three tool descriptions that name themselves
 *    call this deployment ("this server" vs "this connector"). Read by
 *    src/tools.ts at registration time; ignored by this module.
 *  - `auth`: which credential the CALLER holds, not which one core issued.
 *    "api-key" (default) keeps every existing MNEMOVERSE_API_KEY-flavoured
 *    sentence. "oauth" is for a server whose user never sees an API key at
 *    all (a hosted connector minting a key on their behalf): no 401/403
 *    explanation under this mode names MNEMOVERSE_API_KEY, an env var, an
 *    MCP config file, or the keys console; each says what an OAuth user can
 *    actually do instead (reconnect, sign in again, check the plan, wait
 *    for the retry window).
 *  - `keysUrl`: replaces {@link KEYS_URL} wherever the api-key vocabulary
 *    prints a console URL, for a deployment whose key-management page is
 *    not console.mnemoverse.com. Has no effect under `auth: "oauth"`, which
 *    prints no console URL at all.
 *  - `rawDetail`: whether the wire body's raw tail (STEP4-3; e.g. `Raw
 *    detail — Mnemoverse API error 401 on …`) is appended after the
 *    guidance. Defaults to `true`, unchanged from every release before this
 *    one. Held in reserve for a deployment whose core-side error envelopes
 *    are found to echo request content back in `details`: set to `false`
 *    only once that check finds something to hide.
 */
export interface Wording {
  serverNoun?: "this server" | "this connector";
  auth?: "api-key" | "oauth";
  keysUrl?: string;
  rawDetail?: boolean;
}

interface ResolvedWording {
  serverNoun: "this server" | "this connector";
  auth: "api-key" | "oauth";
  keysUrl: string;
  rawDetail: boolean;
}

/** Defaults applied field-by-field, with a `typeof`/literal guard on each:
 *  `wording` crosses a public package boundary a caller controls only at
 *  compile time, so a malformed value at runtime degrades to the default
 *  instead of propagating (e.g. into a template literal, or a `Wording`
 *  field silently taking a fifth value no branch here checks for). */
function resolveWording(w: Wording | undefined): ResolvedWording {
  return {
    serverNoun: w?.serverNoun === "this connector" ? "this connector" : "this server",
    auth: w?.auth === "oauth" ? "oauth" : "api-key",
    keysUrl: typeof w?.keysUrl === "string" && w.keysUrl !== "" ? w.keysUrl : KEYS_URL,
    rawDetail: typeof w?.rawDetail === "boolean" ? w.rawDetail : true,
  };
}

/** Everything known about one failed call, at the moment it failed. */
export interface ApiFailure {
  /** HTTP status. */
  status: number;
  /** Response body, verbatim and unparsed. */
  body: string;
  /** Uppercase HTTP verb. */
  method: string;
  /** Path below the API base, e.g. "/memory/write". Deliberately NOT the full
   *  URL: the base can carry credentials, and the path alone is what identifies
   *  the operation. */
  path: string;
  /** `Retry-After` header when the response carried one. */
  retryAfter?: string | null;
}

/**
 * The engine's error envelope, as much of it as survived parsing.
 *
 * Every field is optional because a non-2xx does not have to come from the
 * engine at all: a proxy, a tunnel, or a wrong `MNEMOVERSE_API_URL` answers with
 * HTML, plain text or nothing. A missing field means "the body did not say",
 * never a default — inventing `retryable: false` for an unparseable body would
 * put a retry decision on evidence that does not exist.
 */
export interface ErrorEnvelope {
  code?: string;
  message?: string;
  retryable?: boolean;
  /**
   * `details.reason` on a 401 (an engine change not yet released as of
   * this one): missing_key | placeholder_key | revoked_key | invalid_key |
   * malformed_key. Absent on every 401 a currently-released engine sends, and
   * absent whenever `details` was not an object carrying a string `reason`.
   * Never defaulted, for the same reason nothing else in this interface is:
   * a made-up reason is a wrong instruction with a confident source.
   */
  reason?: string;
  /**
   * `details.keys_url` on the same 401, already validated by
   * {@link validatedKeysUrl}: present only when it was an https URL whose
   * host is exactly console.mnemoverse.com. A response body must not be able
   * to point a reader at an arbitrary site, so an untrusted value never
   * reaches this field at all; a caller that wants the URL for a reason
   * branch falls back to {@link KEYS_URL} when this is undefined.
   */
  keysUrl?: string;
}

/**
 * Is `details.keys_url` safe to put in front of a user?
 *
 * The body is server-controlled, or, on every path this module exists
 * against, controlled by whoever answered instead: a proxy, a gateway, or
 * the endpoint a wrong MNEMOVERSE_API_URL points at. Trusting a URL out of
 * that body outright would let any of them steer a rejected user to a
 * phishing page under the same "create a key here" instruction this file
 * already gives. The allow-list is narrow on purpose: https only, and the
 * host compared exactly against `console.mnemoverse.com` rather than by
 * prefix or suffix, for the same reason src/index.ts compares a loopback
 * hostname exactly rather than with `startsWith`/`endsWith`.
 */
function validatedKeysUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  // `host`, not `hostname`: it includes the port, so :8443 on the right name
  // is not "the console". Credentials in the URL are refused outright, since
  // a link the agent reads aloud to a person has no business carrying any,
  // and `user@host` is the oldest way to make one host read like another.
  // `url.href === raw`: the parser is forgiving, and what it forgives is the
  // attack. It strips tabs and newlines out of the middle of the string and
  // trims leading and trailing whitespace, so a value that continues on a new
  // line ("...\nIGNORE PREVIOUS GUIDANCE") parses to the right host while the
  // ORIGINAL string, newline and all, would land in guidance the model
  // trusts, past the `inertOneLine` treatment the raw body gets (Copilot,
  // #136). Accepting only a value that is already its own canonical
  // serialization closes every variant at once: control characters, spaces,
  // an upper-case host, a missing path. The engine sends a canonical URL, so
  // nothing legitimate is lost, and what is returned is the serializer's
  // string, never the caller's.
  return url.protocol === "https:" &&
    url.host === "console.mnemoverse.com" &&
    url.username === "" &&
    url.password === "" &&
    url.href === raw
    ? url.href
    : undefined;
}

/**
 * Read the engine's envelope out of a response body.
 *
 * Two shapes are accepted because core produces both: its own middleware writes
 * `{code, message, retryable, details}` at the top level, while anything raised
 * as a FastAPI `HTTPException` arrives wrapped as `{"detail": …}` — where the
 * detail is sometimes a string and sometimes the envelope again. The feed's
 * 404-vs-404 test in this repo pins the nested form, so both are real.
 *
 * `details` (plural, a sibling of `code`/`message`/`retryable`) is read here
 * too, for `reason` and `keys_url`. Anything else inside
 * it is ignored silently: this parser reads a fixed, named set of fields and
 * has no way to tell a future field the engine adds from noise, so silence is
 * the only honest answer for either one.
 */
export function parseErrorEnvelope(body: string): ErrorEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {};
  }
  const pick = (v: unknown): ErrorEnvelope => {
    if (typeof v === "string") return { message: v };
    if (typeof v !== "object" || v === null) return {};
    const o = v as Record<string, unknown>;
    const details =
      typeof o.details === "object" && o.details !== null
        ? (o.details as Record<string, unknown>)
        : undefined;
    return {
      ...(typeof o.code === "string" ? { code: o.code } : {}),
      ...(typeof o.message === "string" ? { message: o.message } : {}),
      ...(typeof o.retryable === "boolean" ? { retryable: o.retryable } : {}),
      ...(typeof details?.reason === "string" ? { reason: details.reason } : {}),
      ...(() => {
        const keysUrl = validatedKeysUrl(details?.keys_url);
        return keysUrl !== undefined ? { keysUrl } : {};
      })(),
    };
  };
  const top = pick(parsed);
  if (top.code !== undefined || top.retryable !== undefined) return top;
  const detail =
    typeof parsed === "object" && parsed !== null
      ? pick((parsed as Record<string, unknown>).detail)
      : {};
  // A top-level `message` with no code still beats nothing; the nested envelope
  // wins when it carries the machine-readable half.
  return detail.code !== undefined || detail.retryable !== undefined
    ? detail
    : { ...detail, ...top };
}

/** `Retry-After` as whole seconds, when it is a plain number. The HTTP-date
 *  form is legal too, and is deliberately NOT parsed: an unparsed header
 *  degrades into "wait a moment", which is honest, whereas a misparsed date
 *  would print a confident and wrong number of seconds. */
export function retryAfterSeconds(header: string | null | undefined): number | undefined {
  if (typeof header !== "string") return undefined;
  // Digits only, because bare Number() answers confidently for inputs that are
  // not delta-seconds at all: Number("") and Number("   ") are 0 ("Wait 0
  // seconds"), Number("0x10") is 16, Number("3e1") is 30, and Number("1e21")
  // prints as scientific notation in the wait text (Copilot + panel, #93).
  // Six digits caps the printable wait at ~11 days; anything longer degrades
  // to the honest vague form.
  const s = header.trim();
  if (!/^\d{1,6}$/.test(s)) return undefined;
  return Number(s);
}

function has(message: string | undefined, needle: string): boolean {
  return (message ?? "").toLowerCase().includes(needle);
}

/**
 * 401: which 401? The engine has more than one (panel, #93).
 *
 * The key-flavored bodies this client's data plane actually sends ("Missing
 * API key. Send X-Api-Key header.", "Invalid or revoked API key." — both
 * probed live against core.mnemoverse.com) get the founder-endorsed
 * replace-the-key instruction. But core's routes.py also raises "Caller org
 * not identified — a tenant API key is required to …" (401) when the
 * deployment has no tenant identity for the caller — a static-auth
 * self-host hitting a room tool is the everyday case — and there the key is
 * VALID, so "replace it" would be a confident wrong cause. That clause runs
 * FIRST because its sentence itself contains "API key": a naive key-mention
 * test would misroute it. A message naming neither gets the honest generic
 * form; silence is the same unknown-refuser case the 403 branch handles.
 *
 * A fourth source arrived after the above was written: `details.reason`
 * on the engine's 401, which names the key problem outright instead of
 * leaving this file to guess from prose. It is checked second, still after
 * "caller org not identified" for the same reason that clause runs first at
 * all (a valid key must never be told to replace itself), and still before
 * the substring guess, since a named reason needs no guessing.
 *
 * UNDER `wording.auth === "oauth"` (STEP4-2, owner, 2026-09-24) none of the
 * above applies: the caller never held an API key at all, so `reason` (a
 * diagnosis of WHICH key problem this is) and every key-flavoured branch
 * below would be a wrong cause stated confidently. "Caller org not
 * identified" is the one exception: it is about tenant identification, not
 * about a key, and can fire under either credential type, so it is checked
 * first regardless of `auth`, worded for whichever credential the caller
 * actually holds. Every other 401 collapses to one OAuth-flavoured sentence:
 * reconnect or sign in again, because that is the one thing an OAuth user
 * can actually do about a 401, and naming a wrong one of five key reasons
 * would be worse than naming none.
 */
function explain401(env: ErrorEnvelope, wording: ResolvedWording): string {
  const m = env.message;
  if (has(m, "caller org not identified")) {
    return wording.auth === "oauth"
      ? "Mnemoverse: this deployment could not identify a tenant account for " +
          "this request (401). The caller's sign-in itself was not rejected " +
          "— do NOT tell the user to reconnect over this. Room and " +
          "shared-memory operations need the multi-tenant backend, which a " +
          "self-hosted or static-auth deployment does not have. Quote the " +
          "detail below, and do not retry the same call against this " +
          "deployment."
      : "Mnemoverse: this deployment could not identify a tenant account for " +
          "this request (401). The API key itself was not rejected — do NOT " +
          "tell the user to replace it. Room and shared-memory operations need " +
          "the multi-tenant backend, which a self-hosted or static-auth " +
          "deployment does not have. Quote the detail below, and do not retry " +
          "the same call against this deployment.";
  }
  if (wording.auth === "oauth") {
    return (
      "Mnemoverse: the user's sign-in was rejected (401). There is no " +
      "credential for them to edit — tell them to disconnect and " +
      "reconnect the app, or sign in again, to refresh their session. Do " +
      "not retry until they do."
    );
  }
  // `details.reason` (an engine change not yet released as of this
  // one): the engine's own diagnosis of WHICH key problem this is, five
  // named values. Checked here, after "caller org not identified" and before
  // the substring guess right below, because a named reason is a strictly
  // better source than sniffing the message text for "api key": this branch
  // makes that guess unnecessary for every engine new enough to send one.
  // AN UNKNOWN REASON, OR NO REASON AT ALL, every engine released today,
  // falls straight through the switch below to the existing clauses, byte
  // for byte: `reason` is additive, never a replacement for a message this
  // parser cannot yet interpret.
  if (env.reason !== undefined) {
    const keysUrl = env.keysUrl ?? wording.keysUrl;
    switch (env.reason) {
      case "placeholder_key":
        return (
          "Mnemoverse: your API key was rejected (401). The engine itself " +
          "recognises the configured value as the example key from the " +
          "documentation, not one anyone created. Tell the user to replace " +
          `MNEMOVERSE_API_KEY with a real key from ${keysUrl}. Do not retry ` +
          "until they replace it."
        );
      case "revoked_key":
        return (
          "Mnemoverse: your API key was rejected (401). This key was " +
          "revoked and will never work again, no matter how many times the " +
          `call is retried. Tell the user to create a new one at ${keysUrl} ` +
          "and put it in their MCP client config in place of this one. Do " +
          "not retry with the same key."
        );
      case "invalid_key":
        return (
          "Mnemoverse: your API key was rejected (401). The engine does " +
          "not recognise this key at all, most often because it was pasted " +
          "incompletely. Tell the user to check that the whole key was " +
          `copied from ${keysUrl}, with nothing missing from either end, or ` +
          "to create a new one there. Do not retry until it is fixed."
        );
      case "malformed_key":
        return (
          "Mnemoverse: your API key was rejected (401). The configured " +
          "value does not have the shape of a Mnemoverse key at all " +
          "(mk_live_ followed by 32 lower-case hex characters). Common " +
          "causes are pasting something else entirely, such as an OAuth " +
          "token, a key cut short in the paste, or a key wrapped in " +
          // Not "surrounding spaces": `fetch` trims whitespace around a header
          // value (and so does HTTP), so a padded key reaches the engine
          // intact and is judged on its own. Probed live on 2026-09-20: a
          // quoted key is malformed_key, a key with a trailing space is not.
          `quotes. Tell the user to check MNEMOVERSE_API_KEY against a real ` +
          `key from ${keysUrl}. Do not retry until it is fixed.`
        );
      case "missing_key":
        return (
          "Mnemoverse: your API key was rejected (401). The X-Api-Key " +
          "header did not arrive at all, so the engine never saw a key to " +
          "check. Tell the user to set MNEMOVERSE_API_KEY in their MCP " +
          `client config to a real key from ${keysUrl}, then restart the ` +
          "MCP server. Do not retry until it is set."
        );
      default:
        // Not one of the five named values. Fall through: an engine that
        // adds a sixth reason before this client learns it must not get a
        // worse answer than the one it would have gotten with no reason at
        // all.
        break;
    }
  }
  if (has(m, "api key") || has(m, "x-api-key")) {
    // Wording endorsed by the founder, kept verbatim — this is the sentence
    // the whole change was commissioned for. One widening, grounded in the
    // docs: the setup pages ship more than one placeholder spelling
    // (agent-setup.md uses mk_live_USER_KEY).
    return (
      "Mnemoverse: your API key was rejected (401). Tell the user their " +
      "MNEMOVERSE_API_KEY is not valid — if it still reads a docs " +
      'placeholder such as "mk_live_YOUR_KEY" or "mk_live_USER_KEY" (any ' +
      "value they did not create at the console themselves) it must be " +
      `replaced with a real key from ${wording.keysUrl}. Do not retry until they ` +
      "replace it."
    );
  }
  if (m !== undefined || env.code !== undefined) {
    return (
      "Mnemoverse: the request was refused as unauthorized (401), and the " +
      "engine's own explanation is in the detail below — quote it to the " +
      "user rather than guessing. Do not assume the API key is wrong: the " +
      "message did not say that. Do not retry the same call unchanged."
    );
  }
  return (
    "Mnemoverse: something answered 401 without speaking this API's error " +
    "language — the body carries neither of the shapes the engine " +
    "produces, so the refuser may be a proxy, a gateway, or a " +
    "MNEMOVERSE_API_URL aimed somewhere unexpected, and the engine may never " +
    "have seen the request. Do not tell the user their key is wrong — this " +
    "client cannot tell WHO refused. Quote the detail below and check the " +
    "path to the API first."
  );
}

/** 403: when the ENGINE refused, the credential was accepted and then the
 *  request was refused — name WHICH refusal, from the engine's own message,
 *  and never blame the credential. But that first clause is only known when
 *  the engine actually spoke: a proxy, a WAF or a tunnel also answers 403, in
 *  HTML, and asserting "the credential identified the account fine" about a
 *  response the engine may never have seen is exactly the confident wrong
 *  cause this module exists to avoid.
 *
 *  Under `wording.auth === "oauth"` every noun for the credential changes
 *  and nothing else does: the clause naming it as innocent ("The API key" /
 *  "Your sign-in"), the holder the room-permission causes speak about ("This
 *  key" / "This account", since an OAuth user holds no key and membership is
 *  the account's), and the one word the opaque-403 branch declines to blame
 *  ("the key" / "the sign-in"). Review round 2 on the wording slice: the
 *  first cut changed only the innocent clause and left "This key is not an
 *  active member" in the same sentence that had just told an OAuth user
 *  their sign-in was fine. */
function explain403(env: ErrorEnvelope, wording: ResolvedWording): string {
  const oauth = wording.auth === "oauth";
  if (saidNothing(env)) {
    const blamed = oauth ? "the sign-in" : "the key";
    return (
      "Mnemoverse: this request was refused (403) by something that did not " +
      "speak this API's error language — the body carries neither of the two " +
      "shapes the engine produces. That points at a proxy, a gateway, or a " +
      "MNEMOVERSE_API_URL aimed somewhere unexpected, and the engine may never " +
      `have seen the request — so do not blame ${blamed} and do not blame room ` +
      "permissions: this client cannot tell WHO refused it. Quote the detail " +
      "below to the user, and do not retry until the path to the API is explained."
    );
  }
  const holder = oauth ? "This account" : "This key";
  const holderLc = oauth ? "this account" : "this key";
  const m = env.message;
  // A SCOPE refusal: the credential identified the account and lacks a
  // permission the call needs (a write with a read-only token). Two producers
  // today, both name the scope: core's middleware ("Token lacks memory:write
  // scope") and the hosted connector's own gate ("the token lacks the
  // memory:write scope"). It is not about a room, so it must not fall
  // through to the generic sentence that guesses "most often the room it
  // addressed" (the connector's refusal did exactly that, step 4 review).
  // The check is keyed on that vocabulary (a scope NAME or "lacks"), not on
  // the bare word "scope", and it is tried AFTER the room causes: room
  // membership is itself called a scope elsewhere on this surface, so a room
  // refusal that happens to say "scope" keeps its room diagnosis (Sigma on
  // #175).
  const scopeRefusal = has(m, "scope") && (has(m, "memory:") || has(m, "lacks"));
  // Core's other scope sentence, "Route has no scope policy; denied by
  // default", is NOT about the credential: the route itself has no policy
  // registered, and the middleware denies it by default. No re-authorization
  // and no other credential changes that, so it gets its own diagnosis
  // (CodeRabbit and Copilot on #175). Keyed on core's exact clause ("no
  // scope policy"), so a message that names a lacking scope and merely
  // mentions a scope policy stays a scope refusal; core's sentence itself
  // names no scope and does not say "lacks", so it never matches
  // `scopeRefusal` either.
  const routePolicy = has(m, "no scope policy");
  // Reads are said to be unaffected only when the missing scope is the write
  // scope and the read scope is not named too (Copilot and Sigma on #175);
  // and "unaffected by this refusal" is all the refusal supports: whether
  // reads work depends on the read scope, which it says nothing about.
  const writeScope =
    (has(m, "memory:write") || has(m, "write scope")) && !(has(m, "memory:read") || has(m, "read scope"));
  // Under oauth the remedy is real: the connector's consent flow grants
  // scopes. Under api-key it is credential-neutral: an API key carries no
  // scope selection this package knows of (the scope rules are OIDC-only, and
  // no producer sends a scope refusal to an API-key caller today), so the
  // reply names no fix a key swap cannot deliver; the user is told which
  // scope was refused and grants it on their side (Copilot and the internal
  // refuter on #175).
  // The scope NAMES come from the engine's message itself, matched as
  // `memory:<word>` and nothing else, so the api-key advice can name what to
  // grant even when `rawDetail: false` withholds the message (Copilot on
  // #175). Only the clause that states the lack is read: from "lacks",
  // "missing", "without", "requires" or "needs" up to the end of the
  // sentence, an opening parenthesis, or a word that introduces what IS held
  // ("granted", "has", "holds", "carries"), so a scope the message lists as
  // held is never presented as refused (CodeRabbit on #175); a refusal that
  // names no scope there gets the generic sentence.
  const lackClause =
    (m ?? "").match(
      /\b(?:lacks?|lacking|missing|without|requires?|required|needs?)\b((?:(?!\b(?:granted|held|has|holds|carries)\b)[^.;(])*)/i,
    )?.[1] ?? "";
  const named = [...new Set((lackClause.match(/\bmemory:[a-z_]+/gi) ?? []).map((x) => x.toLowerCase()))];
  const refused =
    named.length === 0
      ? "this call was refused for a missing scope so they can grant it on their side"
      : named.length === 1
        ? `the ${named[0]} scope was refused so they can grant it on their side`
        : `the ${named.join(" and ")} scopes were refused so they can grant them on their side`;
  const remedy = oauth
    ? `tell the user to re-authorize this connector with ${writeScope ? "write access" : "the access it needs"}`
    : `tell the user ${refused}`;
  // The remedy either follows the reads clause mid-sentence or opens its own
  // sentence, capitalised.
  const advice = writeScope ? `Reads are not affected by this refusal, since they need only the read scope; ${remedy}.` : `${remedy[0].toUpperCase()}${remedy.slice(1)}.`;
  // The opening clause of the reply (below) already says what is missing, so
  // the cause carries the pointer to the engine's words, the advice, and the
  // one prohibition. The pointer exists only when the raw-detail paragraph
  // will be there: under `rawDetail: false` the consumer withholds the body,
  // and a pointer to withheld content is a lie (Copilot on #175).
  const pointer = wording.rawDetail ? "The engine's own words are in the detail below. " : "";
  const scopeCause = `${pointer}${advice} ` + "Do not work around it by trying another tool.";
  const routePolicyCause =
    "The engine denies this route by default because no scope policy is " +
    "registered for it: a gap in the server's own configuration, not anything " +
    `about ${holderLc}, so no re-authorization and no other credential changes ` +
    "it. Tell the user exactly what was refused so it can be reported, and do " +
    "not work around it by trying another tool.";
  const cause = has(m, "archiv")
    ? "The room you addressed is archived. An archived room refuses every read " +
      "and every write, for its owner as much as for a member, and this client " +
      "has no operation that reopens one."
    : has(m, "not an active member") || has(m, "member of this room")
      ? `${holder} is not an active member of the room you addressed. Ask the ` +
        "room's owner for an invite; memory_list_rooms shows the rooms it can " +
        "already reach."
      : has(m, "read-only") && (has(m, "membership") || has(m, "room"))
        ? `${holder}'s membership in that room is read-only — it can read the ` +
          "room but not write to it. Ask the room's owner for write access."
        : has(m, "invalid room address")
          ? 'The room address was not in the form the engine accepts ' +
            '("xroom:room_..."). Take the exact address from memory_list_rooms ' +
            "rather than composing one."
          : has(m, "own this room")
            ? "That room belongs to another account, and only its owner can do " +
              `this. memory_list_rooms shows which rooms ${holderLc} owns.`
            : routePolicy
              ? routePolicyCause
              : scopeRefusal
                ? scopeCause
                : `Something about this request is not permitted for ${holderLc} — ` +
                "most often the room it addressed. Check memory_list_rooms, and " +
                "if nothing there explains it, tell the user exactly what was " +
                "refused instead of guessing.";
  const subject = oauth ? "Your sign-in" : "The API key";
  // The innocent clause ("NOT the problem") would contradict the scope cause
  // that follows it: for that one refusal the credential did identify the
  // account, and the decision was about a scope it does not carry, so the
  // clause says exactly that (CodeRabbit on #175). Every other 403, the room
  // causes and the route-policy denial included, keeps the clause byte for
  // byte.
  const opening =
    cause === scopeCause
      ? `${subject} identified the account fine, but it does not carry a scope this call needs. `
      : `${subject} is NOT the problem — it identified the account fine, and this was a permission decision. `;
  return `Mnemoverse: this request was refused (403). ${opening}${cause} Do not retry the same call: it will be refused again.`;
}

/**
 * Did this response say ANYTHING an engine would have said?
 *
 * Not "does it have a `code`" — that was the old test, and it is wrong, because
 * the engine has TWO error styles. Its own middleware writes the full
 * `{code, message, retryable}` envelope, but every route that raises a FastAPI
 * `HTTPException` — the whole of `rooms_routes.py`, and there is no custom
 * handler to normalise them — serialises to a bare `{"detail": "Room not
 * found."}` with no code at all. Under a code-only test, a real 404 from the
 * room routes would be diagnosed as "your MNEMOVERSE_API_URL is wrong": a
 * confident, checkable falsehood about the user's config.
 *
 * A message with no code is still the engine speaking. Silence — an unparseable
 * body, or JSON carrying neither field — is what a proxy, a tunnel or a base URL
 * pointing elsewhere produces.
 */
function saidNothing(env: ErrorEnvelope): boolean {
  return env.code === undefined && env.message === undefined;
}

/**
 * Did the ENGINE answer this 404 — or just the framework's router?
 *
 * Core registers no HTTPException handler, so an unmatched route is answered
 * by Starlette's literal default `{"detail":"Not Found"}` (verified live
 * against production) — a body with a message but no code, which
 * `saidNothing` alone would mistake for an engine answer (Copilot + panel,
 * #93). Every 404 the data plane actually sends is a MnemoError carrying a
 * code. Match the router defaults case-sensitively so engine prose that
 * merely contains "not found" cannot collide.
 */
function engineSilentOn404(env: ErrorEnvelope): boolean {
  return (
    saidNothing(env) ||
    (env.code === undefined &&
      (env.message === "Not Found" || env.message === "Method Not Allowed"))
  );
}

/**
 * 404: three producers with three different honest answers (panel, #93).
 *
 * (1) POST /memory/rooms/join — the engine's "Invite code not found." No
 *     room address was involved and memory_list_rooms cannot help a
 *     non-member, so the room story would be a confident wrong cause.
 * (2) An engine 404 carrying a code — every 404 the data plane sends is a
 *     MnemoError with one — is about something the request addressed,
 *     usually a room.
 * (3) No code — the router default, a foreign API, a proxy, or silence: the
 *     ENGINE did not answer this, so point at the endpoint and the base URL,
 *     not at rooms.
 */
function explain404(f: ApiFailure, env: ErrorEnvelope): string {
  if (f.path === "/memory/rooms/join") {
    return (
      "Mnemoverse: this invite code was not recognized (404). Most often it " +
      "was copied with a typo or was never issued — have the user re-check " +
      'the exact code (it starts with "mnvr_"), and if it is right, ask ' +
      "whoever sent it for a fresh one. memory_list_rooms will not help " +
      "here: the user is not a member yet. Do not retry the same code."
    );
  }
  if (env.code === undefined) {
    return (
      `Mnemoverse: the API answered 404 for ${f.method} ${f.path} without ` +
      "the engine's error envelope — which is what a route the deployment " +
      "does not serve looks like, not what a missing memory looks like. " +
      "Either MNEMOVERSE_API_URL is aimed at something that is not the " +
      "Mnemoverse API, or this server is newer than the deployment it is " +
      "talking to. If the user's MCP client config sets MNEMOVERSE_API_URL, " +
      "have them check it; if it sets none (the desktop extension exposes " +
      "only the API key), the deployment likely needs updating. Do not retry."
    );
  }
  return (
    "Mnemoverse: what this call addressed does not exist for this key (404). " +
    "The usual cause is a room address that is mistyped, or a room that was " +
    "deleted — call memory_list_rooms for the addresses this key can actually " +
    "reach. Note that a DOMAIN never causes this: a domain holding nothing " +
    "simply reads as empty, so do not tell the user their domain is missing. " +
    "Do not retry this call unchanged."
  );
}

/** 429: three causes, opposite advice. The envelope's `retryable` is the
 *  discriminator, because it is the only thing the engine states outright. */
function explain429(f: ApiFailure, env: ErrorEnvelope, wording: ResolvedWording): string {
  const secs = retryAfterSeconds(f.retryAfter);
  const wait = secs === undefined ? "about a minute" : `${secs} seconds`;
  if (env.retryable === true) {
    // The one 429 sentence that names the credential holder (Sigma, review
    // round 2 on the wording slice): "this key" for an API-key caller, "this
    // account" for an OAuth user who holds no key. The other two branches
    // speak about the account and the plan already.
    const holder = wording.auth === "oauth" ? "this account" : "this key";
    return (
      "Mnemoverse: rate-limited (429). This is the per-minute request limit and " +
      `it clears by itself. Wait ${wait}, then make AT MOST ONE more attempt — ` +
      "do not retry in a loop and do not fan out into more calls, which is what " +
      "turns a one-minute limit into a sustained one. If the retry also fails, " +
      `stop and tell the user ${holder} is hitting its rate limit.`
    );
  }
  if (env.retryable === false) {
    return (
      "Mnemoverse: refused for quota, not for speed (429). Waiting will NOT " +
      "clear this one — the account is at its daily limit, at its stored-memory " +
      "limit, or its subscription is blocking writes. Do not retry. Tell the " +
      `user what the detail below says and point them at ${USAGE_URL}.`
    );
  }
  return (
    "Mnemoverse: refused as too many requests (429), and the body does not say " +
    "whether waiting helps. Do not retry in a loop. Wait a moment, make at most " +
    "one more attempt, and if that fails tell the user rather than continuing — " +
    `if this is a quota rather than a rate, ${USAGE_URL} is where they resolve it.`
  );
}

/**
 * The agent-facing explanation for one failed call, with the raw body kept
 * after it (unless `wording.rawDetail === false`, STEP4-3).
 *
 * Total by construction: every status reaches a sentence, and the fallback says
 * that it has no specific guidance instead of inventing some.
 *
 * `wording` (STEP4-2/3, owner 2026-09-24) is optional and, absent, resolves
 * to exactly today's behaviour: every call site before this release passes
 * none, so every existing pin stays byte-identical.
 */
export function explainApiFailure(f: ApiFailure, wording?: Wording): string {
  const resolved = resolveWording(wording);
  const env = parseErrorEnvelope(f.body);
  let guidance: string;

  if (f.status === 401) {
    guidance = explain401(env, resolved);
  } else if (f.status === 403) {
    guidance = explain403(env, resolved);
  } else if (f.status === 404) {
    guidance = explain404(f, env);
  } else if (f.status === 429) {
    guidance = explain429(f, env, resolved);
  } else if (f.status === 400 || f.status === 422) {
    guidance =
      "Mnemoverse: the engine rejected the CONTENTS of this request " +
      `(${f.status}). This is about the arguments you sent — not the API key, ` +
      "not the network, and not the user's setup. Read the detail below, fix " +
      "the argument it names, and do not resend the same body.";
  } else if (f.status === 409) {
    guidance = explain409(f);
  } else if (f.status >= 500) {
    guidance =
      `Mnemoverse: the memory service failed (${f.status}). This is OUR side, ` +
      "not the user's — their API key, their config and their network are all " +
      "fine, so do not send them to check any of those. One retry after a few " +
      "seconds is reasonable. If it fails again, say plainly that Mnemoverse is " +
      "having a problem and continue without memory rather than retrying.";
  } else {
    guidance =
      `Mnemoverse: the API returned HTTP ${f.status}, and this client has no ` +
      "specific guidance for that status. Do not invent a cause for the user — " +
      "quote the detail below. One retry is acceptable; a loop is not.";
  }

  return resolved.rawDetail ? `${guidance}\n\n${rawDetail(f)}` : guidance;
}

/**
 * A server-controlled string, made safe to quote inside model-facing text.
 *
 * The body is server-controlled — or, on the misconfigured-URL and proxy paths
 * this module itself names, controlled by whoever answered instead. Spliced raw
 * into model-facing text, a body with newlines could open its own paragraph and
 * speak in this module's instruction voice (panel, #93). Strip control,
 * format/bidi and line/paragraph separators so the quoted body stays one inert
 * line; the guidance above it is the only voice here.
 *
 * Shared with {@link explainUnreadableBody}, whose preview is quoted from
 * exactly the same kind of source — a body written by whoever answered.
 */
function inertOneLine(s: string): string {
  return s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ");
}

/** The debugging half: what the wire actually said, still carrying the literal
 *  `Mnemoverse API error <status>` that predates this module. */
function rawDetail(f: ApiFailure): string {
  const body =
    f.body.length > MAX_BODY_CHARS
      ? `${f.body.slice(0, MAX_BODY_CHARS)}… [body truncated at ${MAX_BODY_CHARS} chars]`
      : f.body;
  return `Raw detail — Mnemoverse API error ${f.status} on ${f.method} ${f.path}: ${inertOneLine(body)}`;
}

/**
 * Was this transport failure a REDIRECT this client refused to follow?
 *
 * `redirect: "error"` (src/index.ts, apiFetch) makes undici reject with
 * `TypeError: fetch failed` whose `cause` is `Error: unexpected redirect` —
 * verified by executing the case against a real local 302
 * (test/redirect-refusal.test.ts, which uses a real server precisely because a
 * stubbed fetch has no redirect handling to exercise). The literal string is
 * `makeNetworkError('unexpected redirect')` and is identical in undici 5
 * (Node 18), 6 (Node 20 / 22) and 7 (Node 24) — read in all three, because the
 * CI matrix and this package's `engines` span them.
 *
 * WITHOUT THIS BRANCH the failure is indistinguishable from a dead host: same
 * `TypeError: fetch failed`, and the message below would tell the user to debug
 * a "connectivity or DNS problem" on a network that is working perfectly, while
 * the actual cause — a base URL aimed at something that bounces — sat in their
 * config. That is the confident wrong cause this whole module exists against.
 *
 * The cause chain is WALKED rather than read at one depth, since the nesting is
 * undici's to change; the match is the exact sentinel rather than the word
 * "redirect", because a DNS failure against a host whose NAME contains
 * "redirect" would otherwise be diagnosed as one. If a future runtime renames
 * the sentinel this stops firing and the honest generic sentence takes over —
 * a degradation, not a lie — and the real-server test goes red, which is where
 * the rename gets noticed.
 */
function refusedRedirect(cause: unknown): boolean {
  let e: unknown = cause;
  for (let depth = 0; depth < 5; depth++) {
    if (!(e instanceof Error)) return false;
    if (e.message.toLowerCase().includes("unexpected redirect")) return true;
    e = e.cause;
  }
  return false;
}

/**
 * The request never got an answer at all: DNS, connectivity, a host that does
 * not listen, or this client's own probe deadline firing.
 *
 * Included even though the brief was about HTTP statuses, because it is the
 * OTHER half of the same defect and the two are easy to confuse. The 401
 * message above tells an agent not to blame the network; this is the case where
 * the network genuinely IS the answer, and `TypeError: fetch failed` — which is
 * all a model saw before — is no more actionable than the raw 401 body was.
 *
 * A timeout is named separately because the advice differs in one word: an
 * unreachable host is unlikely to become reachable in three seconds, whereas a
 * request that ran out of time may well succeed on a second try.
 *
 * NARROWED to `fetch()` itself rejecting. Reading the BODY of a response that
 * did arrive used to land here too, so a 200 carrying a sign-in page printed
 * "no HTTP response came back" — see {@link explainUnreadableBody}, which owns
 * that case now. Every sentence below asserts that nothing answered, so it may
 * only be reached when nothing did.
 */
export function explainNetworkFailure(
  method: string,
  path: string,
  cause: unknown,
  wording?: Wording,
): string {
  const resolved = resolveWording(wording);
  const name = cause instanceof Error ? cause.name : "";
  const timedOut = name === "TimeoutError" || name === "AbortError";
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  if (refusedRedirect(cause)) {
    const head =
      `Mnemoverse: ${method} ${path} was answered with a REDIRECT, and this ` +
      "client refused to follow it — so the API key was never sent to whatever " +
      "the redirect pointed at. That refusal is the whole point: following a " +
      "redirect re-sends the request headers to the new host, which hands a " +
      "live key to whoever answered. This API serves one stable base path and " +
      "never redirects legitimately, so this means MNEMOVERSE_API_URL is aimed " +
      "at something else — a proxy, a tunnel, a captive portal, or an address " +
      "that has been tampered with. It is NOT a rejected key and NOT a broken " +
      "network: the request arrived somewhere and was answered. Tell the user " +
      "to check MNEMOVERSE_API_URL and point it straight at the API (the " +
      `default is ${DEFAULT_API_URL}). Do not retry: the same address will ` +
      "redirect again.";
    return resolved.rawDetail
      ? `${head}\n\n${rawTransportDetail(method, path, detail)}`
      : head;
  }
  const head = timedOut
    ? `Mnemoverse: the memory service did not answer ${method} ${path} in time.`
    : `Mnemoverse: the memory service could not be reached at all — ${method} ` +
      `${path} failed before any HTTP response came back.`;
  const cause_ = timedOut
    ? "The service may just be slow right now."
    : "That is a connectivity or DNS problem, or MNEMOVERSE_API_URL pointing at " +
      "a host that does not answer.";
  const body =
    `${head} ${cause_} This is NOT a rejected API key and NOT a quota — no ` +
    "reply arrived to say anything about either, so do not send the user to " +
    "check their key. One retry is reasonable. If that also fails, tell the " +
    "user memory is unreachable and carry on without it rather than retrying.";
  return resolved.rawDetail ? `${body}\n\n${rawTransportDetail(method, path, detail)}` : body;
}

/** The debugging half of a transport failure, in one place so the redirect
 *  branch and the generic one cannot drift into two spellings of it. */
function rawTransportDetail(method: string, path: string, detail: string): string {
  return `Raw detail — request to ${method} ${path} failed: ${detail}`;
}

/** How much of an unreadable body is worth quoting. A sign-in page, an SPA
 *  shell or a proxy notice announces itself in its first line; the rest is
 *  markup, and an error message is not a place to spend a model's context. */
const MAX_PREVIEW_CHARS = 200;

/** A 2xx-or-not response whose BODY this client could not turn into the JSON
 *  this API speaks. The status is known — a reply arrived — which is the whole
 *  difference between this and {@link ApiFailure} or a transport failure. */
export interface UnreadableBody {
  /** HTTP status, as it actually arrived. */
  status: number;
  /** Uppercase HTTP verb. */
  method: string;
  /** Path below the API base. Never the full URL — the base can carry
   *  credentials, and the path alone identifies the operation. */
  path: string;
  /** The bytes that failed to parse, when they were read at all. Absent when
   *  the body READ itself failed, which is a different sentence below. */
  bodyPreview?: string;
  /** The SyntaxError, TypeError or abort that stopped the read. */
  cause: unknown;
}

/**
 * A reply ARRIVED and could not be read — which is not a dead network.
 *
 * WHY THIS IS SEPARATE FROM {@link explainNetworkFailure}. Both failures used
 * to throw the same NetworkError, so `JSON.parse` choking on a 200 printed
 * "the memory service could not be reached at all — POST /memory/read failed
 * before any HTTP response came back… That is a connectivity or DNS problem".
 * Against a captive portal, a MITM proxy, an SPA that serves its shell with a
 * 200, or a body that stops mid-stream, every clause of that is false: a reply
 * came, with a status, and the Raw detail underneath it quoted a SyntaxError
 * out of the body it had just called nonexistent.
 *
 * The cost is the same one this module exists to remove — a confident wrong
 * cause. "Connectivity or DNS" sends the user to debug working wifi while a
 * portal or a mis-set MNEMOVERSE_API_URL answers every request with a page.
 *
 * WHAT THIS MESSAGE MAY CLAIM. Only what the status proves: something answered,
 * and its answer is not this API's JSON. It does NOT name who answered — this
 * client cannot tell the engine from a gateway in front of it — and it does NOT
 * say whether the operation ran, because a body it cannot read is no evidence
 * either way. That last clause matters most for a write.
 */
export function explainUnreadableBody(f: UnreadableBody, wording?: Wording): string {
  const resolved = resolveWording(wording);
  // TWO ARMS, because the two failures have different causes and the wrong one
  // is a wrong instruction. A body that PARSED WRONG is a foreign answer — a
  // portal, a proxy, a base URL aimed elsewhere. A body that stopped ARRIVING
  // is a dropped connection, where "check MNEMOVERSE_API_URL" would be the
  // same kind of confident wrong cause this module removes everywhere else.
  const body =
    typeof f.bodyPreview === "string"
      ? `the body is not JSON this API produces — this client could not read ` +
        `the result. A reply DID arrive, so this is neither a dead network ` +
        `nor a rejected key: nothing here failed to connect, and nothing here ` +
        `refused anything. Do not send the user to debug their connection, ` +
        `and do not tell them their key is the problem. A 2xx in a foreign ` +
        `shape comes from something in FRONT of the API — a captive portal or ` +
        `sign-in page, a proxy or gateway, or MNEMOVERSE_API_URL aimed at ` +
        `something that is not the Mnemoverse API. One retry is reasonable; ` +
        `if it repeats, quote the detail below and have the user check ` +
        `MNEMOVERSE_API_URL and whatever sits between them and the API.`
      : `the body could not be read to the end — it stopped part-way, after ` +
        `that status had already arrived. That is a dropped connection ` +
        `or a deadline firing mid-body; it is NOT a refusal and it says ` +
        `nothing about the user's key. One retry is reasonable; if it ` +
        `repeats, tell the user the reply is arriving incomplete and quote ` +
        `the detail below, status included.`;
  const head =
    `Mnemoverse: something answered HTTP ${f.status} for ${f.method} ` +
    `${f.path}, but ${body} Whether the operation itself ran is unknown ` +
    `either way — if this was a write, treat it as neither saved nor ` +
    "refused.";
  return resolved.rawDetail ? `${head}\n\n${rawUnreadableDetail(f)}` : head;
}

/** The debugging half for an unreadable body: what stopped the read, and the
 *  first bytes of what arrived — through the same inert filter as
 *  {@link rawDetail}, because the preview has exactly the same provenance. */
function rawUnreadableDetail(f: UnreadableBody): string {
  const detail =
    f.cause instanceof Error ? `${f.cause.name}: ${f.cause.message}` : String(f.cause);
  const head =
    `Raw detail — HTTP ${f.status} on ${f.method} ${f.path}, body this client ` +
    `could not read: ${inertOneLine(detail)}`;
  if (typeof f.bodyPreview !== "string" || f.bodyPreview === "") return head;
  const note =
    f.bodyPreview.length > MAX_PREVIEW_CHARS
      ? ` … [preview truncated at ${MAX_PREVIEW_CHARS} chars]`
      : "";
  return `${head} First bytes: ${inertOneLine(f.bodyPreview.slice(0, MAX_PREVIEW_CHARS))}${note}`;
}

/**
 * {@link explainUnreadableBody} as an error, so a caller can tell "a reply
 * arrived and was unreadable" from "no reply arrived" by TYPE rather than by
 * matching a sentence — the same reason {@link ApiError} carries fields.
 */
export class UnreadableBodyError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  /** The bytes that failed to parse, when they were read at all. Kept so
   *  {@link withWording} re-renders the same arm of the explanation. */
  readonly bodyPreview: string | undefined;

  /** `wording` (STEP4-2/3): optional, and absent (every call site before this
   *  release) reproduces today's message exactly: see {@link explainUnreadableBody}. */
  constructor(f: UnreadableBody, wording?: Wording) {
    super(explainUnreadableBody(f, wording), { cause: f.cause });
    this.name = "UnreadableBodyError";
    this.status = f.status;
    this.method = f.method;
    this.path = f.path;
    this.bodyPreview = f.bodyPreview;
  }

  /** The same failure, explained under `wording`: see {@link ApiError.withWording}. */
  withWording(wording: Wording | undefined): UnreadableBodyError {
    const f: UnreadableBody = { status: this.status, method: this.method, path: this.path, cause: this.cause };
    if (this.bodyPreview !== undefined) f.bodyPreview = this.bodyPreview;
    return new UnreadableBodyError(f, wording);
  }
}

/**
 * 409: name the conflict this tool actually produced (panel, #93). The two
 * real producers on this server are the join tool (used/expired/revoked
 * invite) and memory_create_room (core: "A room with this name already
 * exists.", 409). The old single sentence gave the invite advice to a
 * duplicate-name conflict, misdirecting the agent to a nonexistent inviter.
 */
function explain409(f: ApiFailure): string {
  if (f.path === "/memory/rooms/join") {
    return (
      "Mnemoverse: this invite code cannot be used (409) — it has already " +
      "been used, has expired, or was revoked. Ask whoever invited the user " +
      "for a fresh one. Retrying the same code will conflict again."
    );
  }
  if (f.path === "/memory/rooms" && f.method === "POST") {
    return (
      "Mnemoverse: a room with this name already exists for this account " +
      "(409). Pick a different name, or reuse the existing room — " +
      "memory_list_rooms shows its address. Retrying the same name will " +
      "conflict again."
    );
  }
  return (
    "Mnemoverse: this request conflicts with the current state (409). The " +
    "engine's own explanation is in the detail below — quote it to the " +
    "user. Retrying the same request will conflict again."
  );
}

/** {@link explainNetworkFailure} as an error, so `instanceof` can tell a
 *  transport failure from an HTTP one without reading either message. */
export class NetworkError extends Error {
  readonly method: string;
  readonly path: string;

  /** `wording` (STEP4-2/3): optional, and absent (every call site before this
   *  release) reproduces today's message exactly: see {@link explainNetworkFailure}. */
  constructor(method: string, path: string, cause: unknown, wording?: Wording) {
    super(explainNetworkFailure(method, path, cause, wording), { cause });
    this.name = "NetworkError";
    this.method = method;
    this.path = path;
  }

  /** The same failure, explained under `wording`: see {@link ApiError.withWording}. */
  withWording(wording: Wording | undefined): NetworkError {
    return new NetworkError(this.method, this.path, this.cause, wording);
  }
}

/**
 * A failed API call, as an ERROR OBJECT rather than a parsed string.
 *
 * The status and the body are fields because a caller that needs to branch on
 * them must not do it by matching the message. `memory_list_recent` used to
 * decide between "the endpoint is not deployed" and "this room does not exist"
 * with `message.startsWith("Mnemoverse API error 404:")`, which coupled a
 * behavioural branch to the exact prefix of a user-facing sentence — so
 * improving the sentence, which is this change, would have silently flipped
 * that branch. Structured fields make the wording free to change.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly method: string;
  readonly path: string;
  /** The engine's envelope, already parsed — so a caller never re-parses. */
  readonly envelope: ErrorEnvelope;
  /** The `Retry-After` header as it arrived, when the response carried one.
   *  Kept so {@link withWording} re-renders a 429 with its retry sentence. */
  readonly retryAfter: string | null | undefined;

  /** `wording` (STEP4-2/3): optional, and absent (every call site before this
   *  release) reproduces today's message exactly: see {@link explainApiFailure}. */
  constructor(f: ApiFailure, wording?: Wording) {
    super(explainApiFailure(f, wording));
    this.name = "ApiError";
    this.status = f.status;
    this.body = f.body;
    this.method = f.method;
    this.path = f.path;
    this.retryAfter = f.retryAfter;
    this.envelope = parseErrorEnvelope(f.body);
  }

  /**
   * The same failure, explained under `wording`: a new instance of this
   * class whose message is what the constructor would have produced with
   * that `wording`, every field and {@link isBare404} unchanged. The message
   * is a pure function of the failure and the wording, so re-rendering an
   * instance under the wording it was built with gives the same text back.
   * This is how `MemoryToolDeps.wording` reaches an error the consumer's
   * `apiFetch` built without it: see {@link rewordFailure}.
   */
  withWording(wording: Wording | undefined): ApiError {
    const f: ApiFailure = { status: this.status, body: this.body, method: this.method, path: this.path };
    if (this.retryAfter !== undefined) f.retryAfter = this.retryAfter;
    return new ApiError(f, wording);
  }

  /**
   * A 404 the ENGINE did not answer: silence, or the router's literal
   * defaults. This is what a path the deployment does not serve looks like
   * — the first version of this predicate tested silence alone, mistook the
   * real framework body `{"detail":"Not Found"}` for an engine answer, and
   * un-fired the feed's degrade branch for the exact rollout case it exists
   * for (panel, #93).
   *
   * NAMED FOR WHAT IT TESTS, not for what it implies: a gateway, a proxy or a
   * wrong MNEMOVERSE_API_URL can produce the same shapes and is
   * indistinguishable from here. Known, accepted edge: a foreign API whose
   * 404 nests its error under a key this parser does not read
   * (`{"error":{…}}`) also reads as bare, so the feed degrades to its
   * not-supported notice instead of surfacing the foreign body — bounded
   * harm, since against a wrong base URL the very next call fails with the
   * instructive no-envelope wording.
   */
  get isBare404(): boolean {
    return this.status === 404 && engineSilentOn404(this.envelope);
  }
}

/**
 * Re-explain one of this module's three errors under `wording`; hand
 * anything else back untouched.
 *
 * This is how `MemoryToolDeps.wording` reaches the error text (STEP4-2): a
 * consumer's `apiFetch` constructs `ApiError`, `NetworkError` and
 * `UnreadableBodyError` however it likes, and `registerMemoryTools` passes
 * every rejection through here with the `wording` it was given, so the
 * consumer states its wording once, on `deps`, and the constructors need no
 * second copy. Re-rendering is idempotent (see {@link ApiError.withWording}),
 * so an `apiFetch` that does pass the same `wording` to the constructors
 * gets the same text either way; one that passed a different wording gets
 * `deps.wording`, the one source of truth for this registration. A
 * rejection that is none of the three classes (a plain `Error`, an
 * `McpError`) is returned as is: it carries no wording to apply, and its
 * identity may matter to whoever threw it.
 */
export function rewordFailure(e: unknown, wording: Wording | undefined): unknown {
  if (e instanceof ApiError || e instanceof NetworkError || e instanceof UnreadableBodyError) {
    return e.withWording(wording);
  }
  return e;
}
