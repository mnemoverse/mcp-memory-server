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
 *       registerMemoryTools,
 *       SERVER_INSTRUCTIONS,
 *     } from "@mnemoverse/mcp-memory-server/shared";
 *
 *     const server = new McpServer({ name, version }, { instructions: SERVER_INSTRUCTIONS });
 *     registerMemoryTools(server, { apiFetch });
 *     registerMemoryPrompts(server);
 *
 * `apiFetch` is the server's own way to reach the API (credential, base URL,
 * transport). Its contract is on the `ApiFetch` type: reject with `ApiError`,
 * `NetworkError` or `UnreadableBodyError`, because the tools branch on which.
 */

export { registerMemoryTools, type ApiFetch, type MemoryToolDeps } from "./tools.js";
export { registerMemoryPrompts } from "./prompts.js";
export { SERVER_INSTRUCTIONS } from "./teaching.js";
export {
  ApiError,
  NetworkError,
  UnreadableBodyError,
  type ApiFailure,
  type ErrorEnvelope,
  type UnreadableBody,
} from "./errors.js";
