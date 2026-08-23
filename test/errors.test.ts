/**
 * What a failed tool call SAYS — pinned literally, because here the wording is
 * the feature.
 *
 * The defect these tests exist against was not a crash. `isError` was set and
 * the status code was right; the text was the API's own wire body, verbatim, so
 * the model reading it had nothing to act on. The two things it did with that
 * were relay "error 401" to the user, or guess — and the popular guess is "the
 * network", which sends a user to debug working wifi while a placeholder key
 * sits in their config.
 *
 * So these assertions are literal, and deliberately so. A test that only checked
 * "the message mentions 401" would pass for the raw echo that started all this.
 * The 401 sentence is pinned WORD FOR WORD because it was reviewed and endorsed
 * as a whole; the rest are pinned by the clauses that carry the instruction —
 * whose problem it is, and whether to retry.
 *
 * Every case also asserts what the message must NOT say. Half the value of an
 * error message is the wrong cause it refuses to suggest: a 403 that blames the
 * API key, or a 5xx that sends the user to check their key, is a more confident
 * lie than the raw echo ever was.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { httpError, networkDown, startMemoryServer, type Harness } from "./harness.js";
import {
  parseErrorEnvelope,
  retryAfterSeconds,
  explainApiFailure,
  explainNetworkFailure,
} from "../src/errors.js";

let mcp: Harness;

beforeAll(async () => {
  mcp = await startMemoryServer();
});
afterAll(async () => {
  await mcp.close();
});
beforeEach(() => {
  mcp.reset();
});

const READ = "POST /memory/read";
const RECENT = "POST /memory/recent";
const WRITE = "POST /memory/write";
const VAULT = "GET /vault/secrets";

/** The exact body production returns for a bad key, copied from the live
 *  `tools/call` that started this change (2026-08-16). */
const REAL_401_BODY =
  '{"code":"UNAUTHORIZED","message":"Invalid or revoked API key.","requestId":null,"retryable":false,"details":null}';

/** The engine's envelope, in the shape its middleware writes. */
const envelope = (
  code: string,
  message: string,
  retryable: boolean,
): string =>
  JSON.stringify({ code, message, requestId: "req_01", retryable, details: null });

// ---------------------------------------------------------------------------

describe("a rejected API key tells the agent what to do about it", () => {
  it("says the endorsed sentence, word for word", async () => {
    mcp.on(WRITE, httpError(401, REAL_401_BODY));

    const res = await mcp.call("memory_write", { content: "x" });

    expect(res.isError).toBe(true);
    // Pinned as one string, not as fragments: this wording was reviewed and
    // signed off whole, and a fragment check would let half of it rot.
    expect(res.text).toContain(
      "Mnemoverse: your API key was rejected (401). Tell the user their " +
        'MNEMOVERSE_API_KEY is not valid — if it still reads "mk_live_YOUR_KEY" ' +
        "it is the placeholder from the docs and must be replaced with a real " +
        "key from https://console.mnemoverse.com/dashboard/keys. Do not retry " +
        "until they replace it.",
    );
  });

  it("puts the instruction FIRST — an agent that reads one line reads the fix", async () => {
    mcp.on(WRITE, httpError(401, REAL_401_BODY));

    const res = await mcp.call("memory_write", { content: "x" });

    expect(res.text.startsWith("Mnemoverse: your API key was rejected (401).")).toBe(
      true,
    );
    // The raw body is still there — after the sentence, not instead of it.
    expect(res.text).toContain(REAL_401_BODY);
    expect(res.text.indexOf("Mnemoverse: your API key")).toBeLessThan(
      res.text.indexOf(REAL_401_BODY),
    );
  });

  it("does not let the agent blame the network, and does not invite a retry", async () => {
    mcp.on(READ, httpError(401, REAL_401_BODY));

    const res = await mcp.call("memory_read", { query: "anything" });

    expect(res.text).toContain("Do not retry");
    expect(res.text.toLowerCase()).not.toContain("network");
    expect(res.text.toLowerCase()).not.toContain("try again");
  });

  it("reaches every tool, not just the one that was reported", async () => {
    for (const [tool, route, args] of [
      ["memory_write", WRITE, { content: "x" }],
      ["memory_read", READ, { query: "x" }],
      ["vault_list", VAULT, {}],
    ] as const) {
      mcp.reset().on(route, httpError(401, REAL_401_BODY));
      const res = await mcp.call(tool, args);
      expect(res.isError, tool).toBe(true);
      expect(res.text, tool).toContain("your API key was rejected (401)");
      expect(res.text, tool).toContain("console.mnemoverse.com/dashboard/keys");
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * 403 is where a lazy "401/403 = bad key" rule would have shipped a new lie.
 *
 * The engine returns 403 for archived rooms, non-members, read-only members,
 * malformed room addresses and non-owners (mnemoverse-core `src/mnemo/api/`) —
 * every one of them with a perfectly valid key. Telling a user to replace a
 * working key over any of those would be worse than the raw echo, because it is
 * confident.
 */
describe("a 403 names the permission, and clears the API key by name", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["Room is archived", "archived", "has no operation that reopens one"],
    [
      "Not an active member of this room",
      "not an active member of the room",
      "memory_list_rooms",
    ],
    ["Read-only membership cannot write to this room", "read-only", "write access"],
    ["Invalid room address", "not in the form the engine accepts", "memory_list_rooms"],
    ["You do not own this room.", "belongs to another account", "memory_list_rooms"],
  ];

  it.each(cases)(
    "core's %o becomes an instruction about the room",
    async (engineMessage, clause, pointer) => {
      mcp.reset().on(READ, httpError(403, envelope("FORBIDDEN", engineMessage, false)));

      const res = await mcp.call("memory_read", {
        query: "x",
        domain: "xroom:room_01ABC",
      });

      expect(res.isError).toBe(true);
      expect(res.text).toContain("The API key is NOT the problem");
      expect(res.text).toContain(clause);
      expect(res.text).toContain(pointer);
      // The 401 advice must not leak here: nobody should be sent to replace a
      // key that just successfully identified them.
      expect(res.text).not.toContain("mk_live_YOUR_KEY");
      expect(res.text).not.toContain("your API key was rejected");
    },
  );

  it("an unrecognised 403 names no culprit at all — not the key, not permissions", async () => {
    // A body this client cannot parse — a proxy's HTML, say. The engine may
    // never have seen this request, so the one thing this branch must NOT do
    // is assert that the key "identified the account fine": that is a
    // confident cause for a refusal whose author is unknown, the exact
    // failure mode this module exists to avoid (CodeRabbit caught the first
    // version of this branch doing it).
    mcp.on(READ, httpError(403, "<html>Forbidden</html>"));

    const res = await mcp.call("memory_read", { query: "x" });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("did not speak this API's error language");
    expect(res.text).toContain("cannot tell WHO refused it");
    expect(res.text).not.toContain("The API key is NOT the problem");
    expect(res.text).not.toContain("permission decision");
    expect(res.text).not.toContain("your API key was rejected");
  });

  it("an engine 403 whose message matches no clause keeps the confident half", async () => {
    // The engine DID speak (envelope present) — the key really did identify
    // the account, so the confident sentence stays even when no specific
    // room clause matches.
    mcp.on(READ, httpError(403, envelope("FORBIDDEN", "Operation not allowed for this plan", false)));

    const res = await mcp.call("memory_read", { query: "x" });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("The API key is NOT the problem");
    expect(res.text).toContain("tell the user exactly what was refused");
    expect(res.text).toContain("Do not retry the same call");
    expect(res.text).not.toContain("your API key was rejected");
  });
});

// ---------------------------------------------------------------------------

describe("a 404 names the room — and rules out the domain, which is the wrong guess", () => {
  it("an engine 404 points at memory_list_rooms and denies the domain theory", async () => {
    mcp.on(READ, httpError(404, envelope("NOT_FOUND", "Room not found", false)));

    const res = await mcp.call("memory_read", {
      query: "x",
      domain: "xroom:room_TYPO",
    });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("does not exist for this key (404)");
    expect(res.text).toContain("room address that is mistyped");
    expect(res.text).toContain("memory_list_rooms");
    // The clause that matters most: a domain holding nothing reads as empty and
    // never 404s, so "your domain is missing" is a diagnosis this client
    // explicitly forbids rather than merely omits.
    expect(res.text).toContain("a DOMAIN never causes this");
    expect(res.text).toContain("do not tell the user their domain is missing");
  });

  it("a SILENT 404 is diagnosed as the endpoint, and names MNEMOVERSE_API_URL", async () => {
    // A body carrying neither a code nor a message — not the engine answering.
    // A proxy, a tunnel, or a base URL pointing somewhere else.
    mcp.on(READ, httpError(404, "Not Found"));

    const res = await mcp.call("memory_read", { query: "x" });

    expect(res.text).toContain("no error information at all");
    expect(res.text).toContain("ENDPOINT rather than at a missing memory");
    expect(res.text).toContain("MNEMOVERSE_API_URL");
    expect(res.text).toContain("POST /memory/read");
    expect(res.text).not.toContain("memory_list_rooms");
  });

  it("core's OTHER error style — a bare `detail` string — is still the engine talking", async () => {
    // The room routes raise FastAPI HTTPExceptions, which serialise to
    // {"detail": "..."} with no code and no custom handler to normalise them
    // (mnemoverse-core rooms_routes.py). Judging "is this the engine?" by the
    // presence of a `code` would call this a wrong MNEMOVERSE_API_URL — a
    // confident, checkable falsehood about a config that is fine.
    mcp.on("POST /memory/rooms/room_01ABC/invites", httpError(404, '{"detail":"Room not found."}'));

    const res = await mcp.call("memory_invite_to_room", { room_id: "room_01ABC" });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("does not exist for this key (404)");
    expect(res.text).toContain("memory_list_rooms");
    expect(res.text).not.toContain("MNEMOVERSE_API_URL");
  });

  it("the feed's own silent-404 degrade still wins — the rewording did not flip it", async () => {
    // This branch used to be decided by `message.startsWith("Mnemoverse API
    // error 404:")`, i.e. by the exact prefix of a user-facing sentence. Every
    // word of that sentence has now changed. If the branch had stayed keyed to
    // the prose, this degrade would be gone and the endpoint message would be
    // here instead.
    mcp.on(RECENT, httpError(404, "Not Found"));

    const text = await mcp.callText("memory_list_recent", {});

    expect(text).toContain(
      "The memory service does not support the recent-entries feed yet.",
    );
    expect(text).not.toContain("MNEMOVERSE_API_URL");
  });

  it("and a coded 404 on the feed is still the error it is, now stated usefully", async () => {
    mcp.on(RECENT, httpError(404, envelope("NOT_FOUND", "Room not found", false)));

    const res = await mcp.call("memory_list_recent", { domain: "xroom:room_NOPE" });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("does not exist for this key (404)");
    expect(res.text).not.toContain("does not support the recent-entries feed");
  });
});

// ---------------------------------------------------------------------------

/**
 * The 429 that waiting fixes and the 429 that waiting cannot fix are opposite
 * instructions, and the engine has three sources of them: the per-minute rate
 * limiter (`retryable: true`, with `Retry-After`), the daily quota, and the
 * subscription guard (both `retryable: false`). One blanket "wait and retry"
 * would be wrong for two of the three, and an agent that loops on the first is
 * how a one-minute limit becomes a sustained one.
 */
describe("a 429 says whether waiting helps — because sometimes it does not", () => {
  it("the per-minute limit gives the real wait and caps the retry at one", async () => {
    mcp.on(
      WRITE,
      httpError(429, envelope("RATE_LIMITED", "Rate limit exceeded (60/min)", true), {
        "Retry-After": "30",
      }),
    );

    const res = await mcp.call("memory_write", { content: "x" });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("Wait 30 seconds");
    expect(res.text).toContain("AT MOST ONE more attempt");
    expect(res.text).toContain("do not retry in a loop");
    // Not a quota — do not send anyone to the billing page over a burst.
    expect(res.text).not.toContain("dashboard/usage");
  });

  it("without a Retry-After header it says 'about a minute' rather than a made-up number", async () => {
    mcp.on(
      WRITE,
      httpError(429, envelope("RATE_LIMITED", "Rate limit exceeded (60/min)", true)),
    );

    const res = await mcp.call("memory_write", { content: "x" });

    expect(res.text).toContain("Wait about a minute");
    expect(res.text).not.toMatch(/Wait \d+ seconds/);
  });

  it("a quota refusal says waiting will NOT help, and points at the upgrade page", async () => {
    mcp.on(
      WRITE,
      httpError(
        429,
        envelope(
          "RATE_LIMITED",
          "Daily limit reached (1000/1000). Upgrade at https://console.mnemoverse.com/dashboard/usage",
          false,
        ),
      ),
    );

    const res = await mcp.call("memory_write", { content: "x" });

    expect(res.text).toContain("refused for quota, not for speed (429)");
    expect(res.text).toContain("Waiting will NOT clear this one");
    expect(res.text).toContain("Do not retry");
    expect(res.text).toContain("https://console.mnemoverse.com/dashboard/usage");
    expect(res.text).not.toContain("AT MOST ONE more attempt");
  });

  it("a 429 whose body says nothing admits it does not know, and still forbids the loop", async () => {
    mcp.on(WRITE, httpError(429, "Too Many Requests"));

    const res = await mcp.call("memory_write", { content: "x" });

    expect(res.text).toContain("the body does not say whether waiting helps");
    expect(res.text).toContain("Do not retry in a loop");
    expect(res.text).not.toContain("Waiting will NOT clear this one");
  });
});

// ---------------------------------------------------------------------------

describe("a 5xx says it is ours, not theirs", () => {
  it.each([500, 502, 503, 504])("HTTP %i takes the blame and allows one retry", async (status) => {
    mcp.reset().on(VAULT, httpError(status, envelope("INTERNAL", "Service unavailable", true)));

    const res = await mcp.call("vault_list");

    expect(res.isError).toBe(true);
    expect(res.text).toContain(`the memory service failed (${status})`);
    expect(res.text).toContain("This is OUR side, not the user's");
    expect(res.text).toContain("One retry after a few seconds is reasonable");
    expect(res.text).toContain("continue without memory rather than retrying");
    // The whole point: do not send the user to inspect things that are fine.
    expect(res.text).toContain("do not send them to check any of those");
    expect(res.text).not.toContain("mk_live_YOUR_KEY");
  });
});

// ---------------------------------------------------------------------------

describe("the argument errors and the leftovers", () => {
  it("a 400 blames the arguments, by name, and forbids resending the same body", async () => {
    mcp.on(
      WRITE,
      httpError(400, envelope("VALIDATION_ERROR", "content exceeds 10000 characters", false)),
    );

    const res = await mcp.call("memory_write", { content: "x" });

    expect(res.text).toContain("rejected the CONTENTS of this request (400)");
    expect(res.text).toContain("not the API key");
    expect(res.text).toContain("do not resend the same body");
    expect(res.text).toContain("content exceeds 10000 characters");
  });

  it("a 409 on an invite explains the code, not the key", async () => {
    mcp.on(
      "POST /memory/rooms/join",
      httpError(409, envelope("CONFLICT", "Invite already used", false)),
    );

    const res = await mcp.call("memory_join_room", { code: "mnvr_used" });

    expect(res.text).toContain("conflicts with the current state (409)");
    expect(res.text).toContain("already been used, has expired, or was revoked");
    expect(res.text).not.toContain("your API key was rejected");
  });

  it("an unhandled status refuses to invent a cause", async () => {
    mcp.on(READ, httpError(418, "I'm a teapot"));

    const res = await mcp.call("memory_read", { query: "x" });

    expect(res.text).toContain("the API returned HTTP 418");
    expect(res.text).toContain("no specific guidance for that status");
    expect(res.text).toContain("Do not invent a cause for the user");
  });
});

// ---------------------------------------------------------------------------

/**
 * The other half of the same defect. The 401 message tells an agent not to
 * blame the network; this is the case where the network really is the answer,
 * and what a model used to read for it was `TypeError: fetch failed`.
 */
describe("a request that never got an answer says so, and clears the key", () => {
  it("names connectivity and MNEMOVERSE_API_URL, and rules the key out", async () => {
    mcp.on(WRITE, networkDown());

    const res = await mcp.call("memory_write", { content: "x" });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("could not be reached at all");
    expect(res.text).toContain("POST /memory/write failed before any HTTP response");
    expect(res.text).toContain("connectivity or DNS problem");
    expect(res.text).toContain("MNEMOVERSE_API_URL");
    expect(res.text).toContain("NOT a rejected API key");
    expect(res.text).toContain("do not send the user to check their key");
    expect(res.text).toContain("carry on without it rather than retrying");
    // The transport error is still there for whoever has to debug it.
    expect(res.text).toContain("fetch failed");
  });

  it("a timeout gets the one word that differs — it may just be slow", () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const text = explainNetworkFailure("POST", "/memory/read", timeout);

    expect(text).toContain("did not answer POST /memory/read in time");
    expect(text).toContain("may just be slow right now");
    expect(text).not.toContain("connectivity or DNS problem");
    expect(text).toContain("One retry is reasonable");
  });

  it("wrapping did not break the probes that deliberately swallow a failure", async () => {
    // The scope probes catch without inspecting the error type, and turn a
    // failure into the honest "we could not check" answer. If wrapping had
    // changed what they see, this zero-result read would surface an error
    // instead of its diagnosis.
    mcp
      .on(READ, { items: [] })
      .on("GET /memory/stats", { total_atoms: 42, domains: ["general"] })
      .on("GET /memory/rooms", networkDown());

    const text = await mcp.callText("memory_read", { query: "x" });

    expect(text).toContain("could not be fetched just now");
    expect(text).not.toContain("could not be reached at all");
  });
});

// ---------------------------------------------------------------------------

/**
 * Properties that must hold for EVERY error class. A per-status test proves one
 * sentence; these prove the shape of all of them, which is what a future status
 * added by a hurried hand will actually be checked against.
 */
describe("what every error message owes the reader", () => {
  const everyClass: ReadonlyArray<readonly [string, number, string]> = [
    ["bad key", 401, REAL_401_BODY],
    ["forbidden", 403, envelope("FORBIDDEN", "Room is archived", false)],
    ["missing", 404, envelope("NOT_FOUND", "Room not found", false)],
    ["silent 404", 404, "Not Found"],
    ["detail-only 404", 404, '{"detail":"Room not found."}'],
    ["rate limit", 429, envelope("RATE_LIMITED", "Rate limit exceeded", true)],
    ["quota", 429, envelope("RATE_LIMITED", "Daily limit reached", false)],
    ["ours", 500, envelope("INTERNAL", "Service unavailable", true)],
    ["arguments", 400, envelope("VALIDATION_ERROR", "bad field", false)],
    ["unknown", 418, "I'm a teapot"],
  ];

  it.each(everyClass)(
    "%s: names itself, keeps the raw body, and stays greppable",
    async (_label, status, body) => {
      mcp.reset().on(READ, httpError(status, body));

      const res = await mcp.call("memory_read", { query: "x" });

      expect(res.isError).toBe(true);
      // Attributable: an agent relaying this must be able to say WHOSE error it
      // is, and the first two words do that.
      expect(res.text.startsWith("Mnemoverse: ")).toBe(true);
      // The raw body survives verbatim — debugging must not get worse.
      expect(res.text).toContain(body);
      // And the string every existing grep, test and runbook already looks for
      // is still in there, so nothing downstream is broken by the rewrite.
      expect(res.text).toContain(`Mnemoverse API error ${status}`);
      expect(res.text).toContain("POST /memory/read");
    },
  );

  it("a giant error body is truncated, and says that it was", async () => {
    // A gateway can answer with a megabyte of HTML. An error message is not a
    // place to spend a model's context window.
    mcp.on(READ, httpError(502, "<html>" + "x".repeat(50_000) + "</html>"));

    const res = await mcp.call("memory_read", { query: "x" });

    expect(res.text.length).toBeLessThan(3000);
    expect(res.text).toContain("[body truncated at 800 chars]");
    expect(res.text).toContain("the memory service failed (502)");
  });
});

// ---------------------------------------------------------------------------

/**
 * The two pure helpers, tested directly. They decide which sentence a caller
 * gets, and both of them can be wrong in ways no single end-to-end case would
 * reveal — the envelope arrives in two shapes because the engine produces two,
 * and `Retry-After` has a legal form this client deliberately does not parse.
 */
describe("parseErrorEnvelope reads both shapes the engine produces", () => {
  it("reads the middleware's top-level envelope", () => {
    expect(parseErrorEnvelope(REAL_401_BODY)).toEqual({
      code: "UNAUTHORIZED",
      message: "Invalid or revoked API key.",
      retryable: false,
    });
  });

  it("reads a FastAPI HTTPException's nested detail", () => {
    expect(
      parseErrorEnvelope('{"detail":{"code":"room_not_found","message":"Room not found"}}'),
    ).toEqual({ code: "room_not_found", message: "Room not found" });
  });

  it("reads a bare string detail as a message with no code", () => {
    expect(parseErrorEnvelope('{"detail":"Room not found."}')).toEqual({
      message: "Room not found.",
    });
  });

  it.each(["", "Not Found", "<html>502 Bad Gateway</html>", "null", "[1,2]"])(
    "returns an EMPTY envelope for %o — never an invented default",
    (body) => {
      // The distinction the whole 404 branch rests on: no `code` means the
      // engine did not answer. Defaulting `retryable` here would put a retry
      // decision on evidence that does not exist.
      expect(parseErrorEnvelope(body)).toEqual({});
    },
  );
});

describe("retryAfterSeconds parses the numeric form and refuses the rest", () => {
  it.each([
    ["30", 30],
    [" 30 ", 30],
    ["0", 0],
  ])("reads %o as %i seconds", (header, expected) => {
    expect(retryAfterSeconds(header)).toBe(expected);
  });

  const refused: ReadonlyArray<readonly [string | null | undefined, string]> = [
    ["Wed, 21 Oct 2026 07:28:00 GMT", "the HTTP-date form, deliberately unparsed"],
    ["-5", "a negative delay"],
    ["1.5", "a fractional second"],
    ["soon", "prose"],
    [null, "an absent header"],
    [undefined, "no header at all"],
  ];

  it.each(refused)("refuses %o (%s) rather than printing a wrong number", (header) => {
    expect(retryAfterSeconds(header)).toBeUndefined();
  });

  it("an unparsed Retry-After degrades to the vague wait, not to a wrong one", () => {
    const text = explainApiFailure({
      status: 429,
      body: envelope("RATE_LIMITED", "Rate limit exceeded", true),
      method: "POST",
      path: "/memory/write",
      retryAfter: "Wed, 21 Oct 2026 07:28:00 GMT",
    });
    expect(text).toContain("Wait about a minute");
    expect(text).not.toMatch(/Wait \d+ seconds/);
  });
});
