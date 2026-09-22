/**
 * MCP resource: one saved memory by id, as `memory://item/{memory_id}`.
 *
 * Clients that support resources (Claude.ai connectors attach them through an
 * @-mention) can pull one specific memory into context. The ids are the `id:`
 * lines of memory_read and memory_list_recent results, so this is the "open
 * this memory" companion to the recall tools. There is no listing: the
 * template is advertised, and reading needs a known id.
 *
 * Moved here from the hosted connector (mnemoverse-mcp-remote,
 * src/resources/index.ts) in step 3c of the ADR-025 plan, with the same URI
 * template, name and output, so the connector can register this instead of
 * its copy. It returns only `memory_id`, `content` and `domain`: the engine's
 * point read also carries importance, valence, access counts and metadata,
 * which a model opening a memory does not need.
 *
 * Two limits, both the engine's. The point read looks only in the caller's
 * own store (GET /memory/atoms/{id} takes no domain), so a memory read from a
 * shared room cannot be opened here; the description says so. And a Vault
 * secret is safe to open: its value lives in a column no read returns.
 */

import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { ApiError } from "./errors.js";
import type { MemoryToolDeps } from "./tools.js";

/** MCP's code for a resource that does not exist (spec, "Resources: Error Handling"). */
const RESOURCE_NOT_FOUND = -32002;

/**
 * Register the `memory://item/{memory_id}` resource on `server`. It reaches the
 * API only through `deps.apiFetch`, like the tools.
 */
export function registerMemoryResources(server: McpServer, deps: MemoryToolDeps): void {
  const { apiFetch } = deps;

  server.registerResource(
    "memory-item",
    new ResourceTemplate("memory://item/{memory_id}", { list: undefined }),
    {
      title: "Saved memory",
      description:
        "Read one saved memory by its memory ID. IDs come from memory_read results. Opens memories in your own store; a memory read from a shared room cannot be opened by ID.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      // The template hands over the segment as it appears in the URI, still
      // percent-encoded. Decode it once, so the path below encodes the id
      // itself rather than its encoding; a malformed escape is kept as sent.
      const raw = String(variables.memory_id);
      let id = raw;
      try {
        id = decodeURIComponent(raw);
      } catch {
        id = raw;
      }
      try {
        const atom = await apiFetch<{ id?: string; content?: string; domain?: string }>(
          `/memory/atoms/${encodeURIComponent(id)}`,
        );
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({
                memory_id: atom?.id ?? id,
                content: atom?.content,
                domain: atom?.domain,
              }),
            },
          ],
        };
      } catch (err) {
        // The message is the package's own explanation of the failure
        // (src/errors.ts), so a 429 keeps the engine's quota sentence and a
        // 404 says what was not found. A 404 also gets MCP's resource-not-found
        // code, so a client can tell "no such memory" from a failure.
        const message = err instanceof Error ? err.message : String(err);
        const code =
          err instanceof ApiError && err.status === 404 ? RESOURCE_NOT_FOUND : ErrorCode.InternalError;
        throw new McpError(code, message);
      }
    },
  );
}
