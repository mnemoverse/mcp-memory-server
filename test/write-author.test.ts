/**
 * `MemoryToolDeps.writeAuthor` (STEP4-5, owner 2026-09-24): an optional
 * dependency called once per `memory_write`, whose return value — when it
 * returns one — is sent as the write body's `author` field.
 *
 * test/requests.test.ts already pins `writeRequestBody`'s own contract (the
 * pure function). This file pins the WIRING: that `registerMemoryTools`
 * actually calls `writeAuthor()` on a write and not on any other tool, that
 * a returned value reaches the request body sent to `apiFetch`, and that a
 * dependency returning `undefined` — or not supplied at all, the stdio
 * server's own case — produces the exact body this package has always sent.
 */

import { describe, expect, it } from "vitest";
import { connectMemoryTools } from "./direct-register.js";
import type { ApiFetch } from "../src/shared.js";

interface Recorded {
  path: string;
  body: unknown;
}

function recordingApiFetch(reply: unknown = { stored: true, atom_id: "m1" }) {
  const calls: Recorded[] = [];
  const apiFetch: ApiFetch = async (path, options) => {
    calls.push({ path, body: options?.body ? JSON.parse(options.body as string) : undefined });
    return reply as never;
  };
  return { apiFetch, calls };
}

describe("MemoryToolDeps.writeAuthor", () => {
  it("absent entirely: the write body carries no author key — byte-identical to every release before this one", async () => {
    const { apiFetch, calls } = recordingApiFetch();
    const { client, server } = await connectMemoryTools({ apiFetch });

    await client.callTool({ name: "memory_write", arguments: { content: "hello" } });

    expect(calls).toHaveLength(1);
    const body = calls[0]!.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["content", "concepts", "domain"]);
    expect(body.author).toBeUndefined();
    await server.close();
  });

  it("present, returning undefined on this call: no author key either", async () => {
    const { apiFetch, calls } = recordingApiFetch();
    const { client, server } = await connectMemoryTools({
      apiFetch,
      writeAuthor: () => undefined,
    });

    await client.callTool({ name: "memory_write", arguments: { content: "hello" } });

    const body = calls[0]!.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["content", "concepts", "domain"]);
    await server.close();
  });

  it("returns a value: it reaches the wire body's author field exactly as returned", async () => {
    const { apiFetch, calls } = recordingApiFetch();
    const author = {
      principal: "user_abc123",
      agent: "chatgpt",
      agent_name: "ChatGPT",
      client_env: "chatgpt",
      is_external: true,
    };
    const { client, server } = await connectMemoryTools({
      apiFetch,
      writeAuthor: () => author,
    });

    await client.callTool({ name: "memory_write", arguments: { content: "hello" } });

    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.author).toEqual(author);
    await server.close();
  });

  it("is called once per write, with no arguments", async () => {
    const { apiFetch } = recordingApiFetch();
    let calls = 0;
    let sawArgs = false;
    const { client, server } = await connectMemoryTools({
      apiFetch,
      writeAuthor: (...args: unknown[]) => {
        calls++;
        if (args.length > 0) sawArgs = true;
        return { principal: "p" };
      },
    });

    await client.callTool({ name: "memory_write", arguments: { content: "hello" } });
    await client.callTool({ name: "memory_write", arguments: { content: "world" } });

    expect(calls).toBe(2);
    expect(sawArgs).toBe(false);
    await server.close();
  });

  it("is NOT called for memory_read — a read has no author to vouch for", async () => {
    const { apiFetch } = recordingApiFetch();
    let calls = 0;
    const { client, server } = await connectMemoryTools({
      apiFetch: async (path) => {
        if (path === "/memory/read") return { results: [] } as never;
        return apiFetch(path);
      },
      writeAuthor: () => {
        calls++;
        return { principal: "p" };
      },
    });

    await client.callTool({ name: "memory_read", arguments: { query: "x" } });

    expect(calls).toBe(0);
    await server.close();
  });

  it("a non-object return (typeof guard, not a shape check) is treated as no author", async () => {
    const { apiFetch, calls } = recordingApiFetch();
    const { client, server } = await connectMemoryTools({
      apiFetch,
      // Not assignable under the real type — this is exactly the "a caller
      // controls the type only at compile time" case the typeof guard exists
      // for (a JS caller, or a stale build, can return anything at runtime).
      writeAuthor: () => "not an object" as never,
    });

    await client.callTool({ name: "memory_write", arguments: { content: "hello" } });

    const body = calls[0]!.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["content", "concepts", "domain"]);
    await server.close();
  });

  it("a null return is treated as no author (typeof null === \"object\" is the classic JS trap)", async () => {
    const { apiFetch, calls } = recordingApiFetch();
    const { client, server } = await connectMemoryTools({
      apiFetch,
      writeAuthor: () => null as never,
    });

    await client.callTool({ name: "memory_write", arguments: { content: "hello" } });

    const body = calls[0]!.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["content", "concepts", "domain"]);
    await server.close();
  });
});
