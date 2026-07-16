import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Optionally fold the CLOSED Vault capability (`@mnemoverse/mcp-vault`) into THIS open
 * memory-server, so a user who connects ONE MCP also gets the "use a secret without ever
 * seeing it" surface (`vault_use` / `create_secret_capture`) — WITHOUT this open server
 * carrying any of the vault crypto itself.
 *
 * ## Why a guarded dynamic import (not a dependency)
 *
 * This package is MIT / public npm; the vault crypto and the core it talks to are CLOSED and
 * stay that way. If we `import`ed the vault package normally it would become a hard dependency,
 * and opening this server would drag the closed package (and its core coupling) into the open.
 * So the fold is a **best-effort, guarded dynamic import of an OPTIONAL companion**:
 *
 *   - vault-env absent        → skip; server stays memory + rooms + discovery only  → "off"
 *   - companion not installed  → skip gracefully; USE surface simply doesn't appear  → "unavailable"
 *   - both present            → `registerVaultSurface(server, env)` adds the tools    → "live" | "scaffold"
 *
 * Fail-OPEN for the *server* (a missing or broken companion must never block memory), fail-CLOSED
 * for the *secret* (the vault package itself decides live-vs-scaffold from the env; no env → no USE
 * surface at all). Diagnostics go to **stderr** — stdout is the MCP stdio transport and must stay
 * protocol-only.
 *
 * The module specifier is held in a `const` (not an inline literal) on purpose: TypeScript only
 * resolves string-literal import specifiers, so this keeps the optional companion out of
 * compile-time module resolution — there is deliberately no `@mnemoverse/mcp-vault` entry in this
 * package's dependencies.
 */
export type VaultFoldStatus =
  | "off"
  | "unavailable"
  | "live"
  | "scaffold"
  | "error";

/**
 * The three env vars the vault companion needs to run LIVE. All three gate whether we even probe
 * for the companion — an operator enabling USE sets all of them (server URL + bearer token +
 * on-device passphrase); anything less means the user has not opted into secret use.
 */
const VAULT_ENV_KEYS = [
  "MNEMOVERSE_VAULT_SERVER_URL",
  "MNEMOVERSE_VAULT_TOKEN",
  "MNEMOVERSE_VAULT_PASSPHRASE",
] as const;

// Held in a const so tsc does not statically resolve it (see module doc): the companion is an
// optional runtime dependency, never a package.json one.
const VAULT_REGISTER_SPECIFIER = "@mnemoverse/mcp-vault/register";

interface VaultRegisterModule {
  registerVaultSurface?: (
    server: McpServer,
    env: NodeJS.ProcessEnv,
  ) => "live" | "scaffold";
}

/**
 * How the companion module is loaded. Production uses the guarded dynamic import; tests inject a
 * fake (or throwing) importer to exercise every branch deterministically WITHOUT the closed
 * companion present. Kept as the last parameter with a real default so callers never pass it.
 */
export type VaultRegisterImporter = () => Promise<VaultRegisterModule>;

const defaultImporter: VaultRegisterImporter = () =>
  import(VAULT_REGISTER_SPECIFIER) as Promise<VaultRegisterModule>;

/**
 * Attempt to fold the vault surface into `server`. Returns a status describing what happened;
 * never throws — a failure here degrades the server to memory-only, it does not crash it.
 */
export async function maybeRegisterVaultSurface(
  server: McpServer,
  env: NodeJS.ProcessEnv = process.env,
  importRegister: VaultRegisterImporter = defaultImporter,
): Promise<VaultFoldStatus> {
  // Gate on env FIRST — if the user hasn't opted into USE, don't even probe for the companion.
  const missing = VAULT_ENV_KEYS.filter((k) => !env[k]);
  if (missing.length > 0) {
    return "off";
  }

  let mod: VaultRegisterModule;
  try {
    mod = await importRegister();
  } catch (err) {
    console.error(
      "[mnemoverse-memory] Vault env is set but the @mnemoverse/mcp-vault companion is not " +
        "installed — the vault_use surface is unavailable. Install it alongside this server to " +
        `enable using secrets without seeing them. (${asMessage(err)})`,
    );
    return "unavailable";
  }

  if (typeof mod.registerVaultSurface !== "function") {
    console.error(
      "[mnemoverse-memory] @mnemoverse/mcp-vault/register did not export registerVaultSurface(); " +
        "vault surface not folded.",
    );
    return "error";
  }

  try {
    const mode = mod.registerVaultSurface(server, env);
    console.error(`[mnemoverse-memory] Vault surface folded in (${mode}).`);
    return mode;
  } catch (err) {
    console.error(
      `[mnemoverse-memory] Failed to register the vault surface: ${asMessage(err)}`,
    );
    return "error";
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
