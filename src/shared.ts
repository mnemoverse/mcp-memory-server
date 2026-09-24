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
 * not yet done as of this release. `capResult` truncates on a UTF-16
 * code-point boundary and appends the truncation notice, so a consumer does
 * not have to re-implement a `slice` that can cut a surrogate pair.
 */

export { registerMemoryTools, MAX_RESULT_CHARS, capResult, type ApiFetch, type MemoryToolDeps } from "./tools.js";
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
} from "./errors.js";
