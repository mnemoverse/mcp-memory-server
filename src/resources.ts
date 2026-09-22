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
import { unreadableAnswerText, type MemoryToolDeps } from "./tools.js";

/** MCP's code for a resource that does not exist (spec, "Resources: Error Handling"). */
const RESOURCE_NOT_FOUND = -32002;

/**
 * The URI segment as the template hands it over is still percent-encoded.
 * Decode it once, so the request path encodes the id itself rather than its
 * encoding; a malformed escape is kept as sent (and then encoded, so it can
 * never become a path separator).
 */
function decodeOnce(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

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
      const id = decodeOnce(String(variables.memory_id));
      let answer: unknown;
      try {
        answer = await apiFetch<unknown>(`/memory/atoms/${encodeURIComponent(id)}`);
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
      // A success whose body is not a memory (an empty 204, which apiFetch
      // returns as {}, or any other shape) is not passed off as one: without
      // this check it became {"memory_id": "<the id asked for>"}, a resource
      // made up from the request (Copilot on #149). Content and domain must be
      // strings, as the engine's AtomDetailSchema requires.
      const atom = answer as { id?: unknown; content?: unknown; domain?: unknown } | null;
      if (
        typeof atom !== "object" ||
        atom === null ||
        typeof atom.content !== "string" ||
        typeof atom.domain !== "string"
      ) {
        throw new McpError(
          ErrorCode.InternalError,
          unreadableAnswerText("The memory", "the memory", "it is empty or gone"),
        );
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              memory_id: typeof atom.id === "string" ? atom.id : id,
              content: atom.content,
              domain: atom.domain,
            }),
          },
        ],
      };
    },
  );
}
