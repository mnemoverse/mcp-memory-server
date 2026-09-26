/**
 * `registerMemoryTools(server, deps)` on a FRESH McpServer, with an arbitrary
 * `deps` object: the seam test/harness.ts does not have.
 *
 * WHY THIS EXISTS. test/harness.ts boots exactly one server per test FILE
 * (memoised), and it is always the package's own stdio server from
 * src/index.ts, which always builds its own `apiFetch` and never supplies
 * `wording` or `writeAuthor` (STEP4-2/3/5). Every test that needs to see what
 * a SECOND server (one that injects a custom `wording` or `writeAuthor`)
 * gets from these tools needs its own server instance with its own `deps`.
 *
 * Pattern borrowed from test/shared-entry.test.ts's local `connect()` helper
 * and test/structured-output.test.ts's `connectProbe()`, generalised to take
 * the whole `MemoryToolDeps` object instead of just `apiFetch`, and moved
 * here so more than one new test file can share it without each hand-rolling
 * its own copy.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerMemoryResources, registerMemoryTools, type MemoryToolDeps } from "../src/shared.js";

export interface DirectServer {
  client: Client;
  server: McpServer;
}

/**
 * Connects a fresh client/server pair with the memory tools registered
 * via the given `deps`, nothing else (no prompts, no resources): the tests
 * this helper serves read tools/list and call tools, not either of those.
 */
export async function connectMemoryTools(deps: MemoryToolDeps): Promise<DirectServer> {
  return connect((server) => registerMemoryTools(server, deps));
}

/** The same, with only the memory resource registered via `deps`, for the
 *  tests that read a resource and look at how its failure is worded. */
export async function connectMemoryResources(deps: MemoryToolDeps): Promise<DirectServer> {
  return connect((server) => registerMemoryResources(server, deps));
}

async function connect(register: (server: McpServer) => void): Promise<DirectServer> {
  const server = new McpServer({ name: "direct-register-test", version: "0.0.0" });
  register(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "direct-register-test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}
