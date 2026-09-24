/**
 * `@mnemoverse/mcp-memory-server/shared`: the MCP surface, for any server.
 *
 * ADR-025 (mnemoverse-core): this package defines the Mnemoverse MCP surface,
 * and a server that exposes Mnemoverse memory over MCP registers these tools
 * instead of keeping its own copy. Importing this entry point starts nothing:
 * the stdio server lives in the package's main entry, which this file does not
 * import.
 *
 *     import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
 *     import {
 *       registerMemoryPrompts,
 *       registerMemoryResources,
 *       registerMemoryTools,
 *       SERVER_INSTRUCTIONS,
 *     } from "@mnemoverse/mcp-memory-server/shared";
 *
 *     const server = new McpServer({ name, version }, { instructions: SERVER_INSTRUCTIONS });
 *     registerMemoryTools(server, { apiFetch });
 *     registerMemoryPrompts(server);
 *     registerMemoryResources(server, { apiFetch });
 *
 * `apiFetch` is the server's own way to reach the API (credential, base URL,
 * transport). Its contract is on the `ApiFetch` type: reject with `ApiError`,
 * `NetworkError` or `UnreadableBodyError`, because the tools branch on which.
 *
 * `MAX_RESULT_CHARS` and `capResult` are the tool-result size cap and the
 * helper that applies it: 96,000 characters (24,000 tokens), the one bound
 * both servers use for a tool result's text (`structuredContent` is not
 * capped, OD-11). ADR-025 makes this the single source of truth for the
 * number; the hosted connector still keeps its own 25,000-character literal
 * (`src/constants.ts`) and adopts this export in its place at a later step,
 * not yet done as of this release. `capResult` truncates on a code-point
 * boundary (never inside a UTF-16 surrogate pair) and appends the truncation notice, so a consumer does
 * not have to re-implement a `slice` that can cut a surrogate pair.
 *
 * `MemoryToolDeps.wording` and `.writeAuthor` (STEP4-2/3/5, owner
 * 2026-09-24) are how a SECOND server registering these tools — the hosted
 * connector is the first consumer — speaks in its own voice: `wording`
 * swaps "this server" for "this connector" in the three descriptions that
 * name it and, under `auth: "oauth"`, rewords every 401/403 explanation for
 * a user who never sees an API key; `writeAuthor` lets a supplier vouch for
 * the end user behind a write (core: `_get_provenance`, honoured only for a
 * SERVICE/supplier caller). Both are optional, and absent, reproduce this
 * package's existing behaviour exactly. Full contract: docs/shared.md.
 */

export {
  registerMemoryTools,
  MAX_RESULT_CHARS,
  capResult,
  type ApiFetch,
  type MemoryToolDeps,
} from "./tools.js";
export { registerMemoryPrompts } from "./prompts.js";
export { registerMemoryResources } from "./resources.js";
export { SERVER_INSTRUCTIONS } from "./teaching.js";
export {
  ApiError,
  NetworkError,
  UnreadableBodyError,
  type ApiFailure,
  type ErrorEnvelope,
  type UnreadableBody,
  type Wording,
} from "./errors.js";
export { type WriteAuthor } from "./requests.js";
