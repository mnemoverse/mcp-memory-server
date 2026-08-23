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

/** The console page that issues keys — the one place a user fixes a 401. */
const KEYS_URL = "https://console.mnemoverse.com/dashboard/keys";

/** The console page that shows quota and upgrades — where a 429 that waiting
 *  cannot fix is resolved. Same URL the engine puts in its own 429 bodies. */
const USAGE_URL = "https://console.mnemoverse.com/dashboard/usage";

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
}

/**
 * Read the engine's envelope out of a response body.
 *
 * Two shapes are accepted because core produces both: its own middleware writes
 * `{code, message, retryable, details}` at the top level, while anything raised
 * as a FastAPI `HTTPException` arrives wrapped as `{"detail": …}` — where the
 * detail is sometimes a string and sometimes the envelope again. The feed's
 * 404-vs-404 test in this repo pins the nested form, so both are real.
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
    return {
      ...(typeof o.code === "string" ? { code: o.code } : {}),
      ...(typeof o.message === "string" ? { message: o.message } : {}),
      ...(typeof o.retryable === "boolean" ? { retryable: o.retryable } : {}),
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
  const n = Number(header.trim());
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n) ? n : undefined;
}

function has(message: string | undefined, needle: string): boolean {
  return (message ?? "").toLowerCase().includes(needle);
}

/** 403: when the ENGINE refused, the key was accepted and then the request
 *  was refused — name WHICH refusal, from the engine's own message, and never
 *  blame the key. But that first clause is only known when the engine actually
 *  spoke: a proxy, a WAF or a tunnel also answers 403, in HTML, and asserting
 *  "the key identified the account fine" about a response the engine may never
 *  have seen is exactly the confident wrong cause this module exists to avoid. */
function explain403(env: ErrorEnvelope): string {
  if (saidNothing(env)) {
    return (
      "Mnemoverse: this request was refused (403) by something that did not " +
      "speak this API's error language — the body carries neither of the two " +
      "shapes the engine produces. That points at a proxy, a gateway, or a " +
      "MNEMOVERSE_API_URL aimed somewhere unexpected, and the engine may never " +
      "have seen the request — so do not blame the key and do not blame room " +
      "permissions: this client cannot tell WHO refused it. Quote the detail " +
      "below to the user, and do not retry until the path to the API is explained."
    );
  }
  const m = env.message;
  const cause = has(m, "archiv")
    ? "The room you addressed is archived. An archived room refuses every read " +
      "and every write, for its owner as much as for a member, and this client " +
      "has no operation that reopens one."
    : has(m, "not an active member") || has(m, "member of this room")
      ? "This key is not an active member of the room you addressed. Ask the " +
        "room's owner for an invite; memory_list_rooms shows the rooms it can " +
        "already reach."
      : has(m, "read-only")
        ? "This key's membership in that room is read-only — it can read the " +
          "room but not write to it. Ask the room's owner for write access."
        : has(m, "invalid room address")
          ? 'The room address was not in the form the engine accepts ' +
            '("xroom:room_..."). Take the exact address from memory_list_rooms ' +
            "rather than composing one."
          : has(m, "own this room")
            ? "That room belongs to another account, and only its owner can do " +
              "this. memory_list_rooms shows which rooms this key owns."
            : "Something about this request is not permitted for this key — " +
              "most often the room it addressed. Check memory_list_rooms, and " +
              "if nothing there explains it, tell the user exactly what was " +
              "refused instead of guessing.";
  return (
    "Mnemoverse: this request was refused (403). The API key is NOT the problem " +
    "— it identified the account fine, and this was a permission decision. " +
    `${cause} Do not retry the same call: it will be refused again.`
  );
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

/** 404: a room that is not there, or a path the deployment does not serve. */
function explain404(f: ApiFailure, env: ErrorEnvelope): string {
  if (saidNothing(env)) {
    return (
      `Mnemoverse: the API answered 404 for ${f.method} ${f.path} with a body ` +
      "that carries no error information at all — neither of the two shapes this " +
      "API produces. That points at the ENDPOINT rather than at a missing " +
      "memory: MNEMOVERSE_API_URL is aimed at something that is not the " +
      "Mnemoverse API, or this server is newer than the deployment it is talking " +
      "to. Tell the user to check MNEMOVERSE_API_URL in their MCP client config. " +
      "Do not retry."
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
function explain429(f: ApiFailure, env: ErrorEnvelope): string {
  const secs = retryAfterSeconds(f.retryAfter);
  const wait = secs === undefined ? "about a minute" : `${secs} seconds`;
  if (env.retryable === true) {
    return (
      "Mnemoverse: rate-limited (429). This is the per-minute request limit and " +
      `it clears by itself. Wait ${wait}, then make AT MOST ONE more attempt — ` +
      "do not retry in a loop and do not fan out into more calls, which is what " +
      "turns a one-minute limit into a sustained one. If the retry also fails, " +
      "stop and tell the user this key is hitting its rate limit."
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
 * after it.
 *
 * Total by construction: every status reaches a sentence, and the fallback says
 * that it has no specific guidance instead of inventing some.
 */
export function explainApiFailure(f: ApiFailure): string {
  const env = parseErrorEnvelope(f.body);
  let guidance: string;

  if (f.status === 401) {
    // Wording endorsed by the founder, kept verbatim — this is the sentence the
    // whole change was commissioned for.
    guidance =
      "Mnemoverse: your API key was rejected (401). Tell the user their " +
      'MNEMOVERSE_API_KEY is not valid — if it still reads "mk_live_YOUR_KEY" ' +
      "it is the placeholder from the docs and must be replaced with a real key " +
      `from ${KEYS_URL}. Do not retry until they replace it.`;
  } else if (f.status === 403) {
    guidance = explain403(env);
  } else if (f.status === 404) {
    guidance = explain404(f, env);
  } else if (f.status === 429) {
    guidance = explain429(f, env);
  } else if (f.status === 400 || f.status === 422) {
    guidance =
      "Mnemoverse: the engine rejected the CONTENTS of this request " +
      `(${f.status}). This is about the arguments you sent — not the API key, ` +
      "not the network, and not the user's setup. Read the detail below, fix " +
      "the argument it names, and do not resend the same body.";
  } else if (f.status === 409) {
    guidance =
      "Mnemoverse: this request conflicts with the current state (409). On an " +
      "invite code that means the code has already been used, has expired, or " +
      "was revoked — ask whoever invited the user for a fresh one. Retrying the " +
      "same request will conflict again.";
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

  return `${guidance}\n\n${rawDetail(f)}`;
}

/** The debugging half: what the wire actually said, still carrying the literal
 *  `Mnemoverse API error <status>` that predates this module. */
function rawDetail(f: ApiFailure): string {
  const body =
    f.body.length > MAX_BODY_CHARS
      ? `${f.body.slice(0, MAX_BODY_CHARS)}… [body truncated at ${MAX_BODY_CHARS} chars]`
      : f.body;
  return `Raw detail — Mnemoverse API error ${f.status} on ${f.method} ${f.path}: ${body}`;
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
 */
export function explainNetworkFailure(
  method: string,
  path: string,
  cause: unknown,
): string {
  const name = cause instanceof Error ? cause.name : "";
  const timedOut = name === "TimeoutError" || name === "AbortError";
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  const head = timedOut
    ? `Mnemoverse: the memory service did not answer ${method} ${path} in time.`
    : `Mnemoverse: the memory service could not be reached at all — ${method} ` +
      `${path} failed before any HTTP response came back.`;
  const cause_ = timedOut
    ? "The service may just be slow right now."
    : "That is a connectivity or DNS problem, or MNEMOVERSE_API_URL pointing at " +
      "a host that does not answer.";
  return (
    `${head} ${cause_} This is NOT a rejected API key and NOT a quota — no ` +
    "reply arrived to say anything about either, so do not send the user to " +
    "check their key. One retry is reasonable. If that also fails, tell the " +
    "user memory is unreachable and carry on without it rather than retrying.\n\n" +
    `Raw detail — request to ${method} ${path} failed: ${detail}`
  );
}

/** {@link explainNetworkFailure} as an error, so `instanceof` can tell a
 *  transport failure from an HTTP one without reading either message. */
export class NetworkError extends Error {
  readonly method: string;
  readonly path: string;

  constructor(method: string, path: string, cause: unknown) {
    super(explainNetworkFailure(method, path, cause), { cause });
    this.name = "NetworkError";
    this.method = method;
    this.path = path;
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

  constructor(f: ApiFailure) {
    super(explainApiFailure(f));
    this.name = "ApiError";
    this.status = f.status;
    this.body = f.body;
    this.method = f.method;
    this.path = f.path;
    this.envelope = parseErrorEnvelope(f.body);
  }

  /**
   * A 404 whose body says NOTHING — no code, no message — which is what a path
   * the deployment does not serve looks like, as opposed to a room that does
   * not exist.
   *
   * NAMED FOR WHAT IT TESTS, not for what it implies: a gateway, a proxy or a
   * wrong MNEMOVERSE_API_URL produces the same silent 404 and is
   * indistinguishable from here.
   *
   * Stricter than the check it replaces, on purpose. That one asked whether the
   * substring `"code"` appeared anywhere in the message, which also called a
   * `rooms_routes.py` 404 — `{"detail":"Room not found."}`, no code — a missing
   * endpoint. `/memory/recent`, the only consumer, is a middleware-envelope
   * route, so the old flaw never fired there; the same predicate now serves the
   * user-facing 404 text, where it would have.
   */
  get isBare404(): boolean {
    return this.status === 404 && saidNothing(this.envelope);
  }
}
