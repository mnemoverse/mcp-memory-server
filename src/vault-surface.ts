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
 *   - companion load times out → skip; server still comes up memory-only            → "timeout"
 *   - companion errors mid-fold → roll back its partial tools; memory-only          → "error" / "timeout"
 *   - both present, healthy    → `registerVaultSurface(server, env)` adds the tools  → "live" | "scaffold"
 *
 * Fail-OPEN for the *server* (a missing, broken, SLOW, or partially-registering companion must
 * never crash or stall memory — see the bounded import, the awaited/validated return, and the
 * registration rollback below), fail-CLOSED for the *secret* (the vault package itself decides
 * live-vs-scaffold from the env; no env → no USE surface at all). Diagnostics go to **stderr** —
 * stdout is the MCP stdio transport and must stay protocol-only.
 *
 * The module specifier is held in a `const` (not an inline literal) on purpose: TypeScript only
 * resolves string-literal import specifiers, so this keeps the optional companion out of
 * compile-time module resolution — there is deliberately no `@mnemoverse/mcp-vault` entry in this
 * package's dependencies.
 *
 * NOTE ON TRUST: the companion is loaded into the SAME tool surface, so a HOSTILE companion could
 * in principle register a tool that shadows a core memory tool. The companion is our own closed
 * package (trusted); this seam defends against a BROKEN/SLOW companion (crash/hang/partial fold),
 * not a malicious one. Loading untrusted vault code is out of scope by design.
 */
export type VaultFoldStatus =
  | "off"
  | "unavailable"
  | "timeout"
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

// The companion pulls a native addon (@napi-rs/keyring) at load and, in a version-skewed or
// broken build, could return a non-settling promise. Both the import AND the registration call
// are bounded by this deadline: a companion phase that never settles must not stall the server,
// because the fold is awaited BEFORE the transport connects. On timeout the server comes up
// memory-only.
const DEFAULT_COMPANION_TIMEOUT_MS = 10_000;

interface VaultRegisterModule {
  registerVaultSurface?: (
    server: McpServer,
    env: NodeJS.ProcessEnv,
  ) => "live" | "scaffold";
}

/**
 * How the companion module is loaded. Production uses the guarded dynamic import; tests inject a
 * fake (or throwing / never-resolving) importer to exercise every branch deterministically
 * WITHOUT the closed companion present.
 */
export type VaultRegisterImporter = () => Promise<VaultRegisterModule>;

export interface VaultFoldOptions {
  /** Override how the companion is loaded (default: guarded dynamic import). Tests inject fakes. */
  importRegister?: VaultRegisterImporter;
  /** Upper bound on EACH companion phase — import and registration (default {@link DEFAULT_COMPANION_TIMEOUT_MS}). */
  companionTimeoutMs?: number;
}

const defaultImporter: VaultRegisterImporter = () =>
  import(VAULT_REGISTER_SPECIFIER) as Promise<VaultRegisterModule>;

/**
 * Attempt to fold the vault surface into `server`. Returns a status describing what happened;
 * never throws and never hangs the caller — a failure, a slow/hung companion, OR a companion that
 * registers some tools then fails all degrade the server to memory-only (rolling back any
 * partial surface), they do not crash or stall startup.
 */
export async function maybeRegisterVaultSurface(
  server: McpServer,
  env: NodeJS.ProcessEnv = process.env,
  opts: VaultFoldOptions = {},
): Promise<VaultFoldStatus> {
  const importRegister = opts.importRegister ?? defaultImporter;
  const timeoutMs = opts.companionTimeoutMs ?? DEFAULT_COMPANION_TIMEOUT_MS;

  // Gate on env FIRST — if the user hasn't opted into USE, don't even probe for the companion.
  // Trim for the PRESENCE check so a whitespace-only value counts as absent (an env-templating
  // accident like "  " must NOT probe the native-dep companion or register a surprise surface);
  // the untrimmed value is still what we hand the companion, so a real passphrase that contains
  // spaces is unaffected — only an entirely-blank value is treated as missing.
  const missing = VAULT_ENV_KEYS.filter((k) => {
    const v = env[k];
    return v == null || v.trim() === "";
  });
  if (missing.length > 0) {
    return "off";
  }

  let mod: VaultRegisterModule;
  try {
    mod = await withTimeout(importRegister(), timeoutMs, "vault companion import");
  } catch (err) {
    const timedOut = err instanceof TimeoutError;
    console.error(
      timedOut
        ? "[mnemoverse-memory] Vault env is set but the @mnemoverse/mcp-vault companion did not " +
            `load within ${timeoutMs}ms — starting memory-only; the vault_use surface is ` +
            "unavailable this run."
        : "[mnemoverse-memory] Vault env is set but the @mnemoverse/mcp-vault companion is not " +
            "installed — the vault_use surface is unavailable. Install it alongside this server " +
            `to enable using secrets without seeing them. (${asMessage(err)})`,
    );
    return timedOut ? "timeout" : "unavailable";
  }

  // Register through a rollback-recording proxy. If the companion registers some tools and THEN
  // fails (throws, times out, or returns a bad value), we remove the tools it already added so the
  // client never sees a half-folded surface — the "degrade to memory-only" guarantee holds even
  // for a mid-registration failure. `Promise.resolve(...)` normalizes a sync return AND an
  // (unexpected, version-skewed) thenable return into one awaited value, so a rejecting or
  // never-settling companion is caught/timed-out here instead of escaping into main()'s unguarded
  // await (which would crash via process.exit or hang before connect). The property read + call
  // are BOTH inside the try so even a throwing getter on `registerVaultSurface` degrades cleanly.
  const { server: recordingServer, rollback } = withRegistrationRollback(server);
  try {
    const register = mod.registerVaultSurface;
    if (typeof register !== "function") {
      console.error(
        "[mnemoverse-memory] @mnemoverse/mcp-vault/register did not export a registerVaultSurface() " +
          "function; vault surface not folded.",
      );
      return "error";
    }
    const mode = await withTimeout(
      Promise.resolve(register(recordingServer, env)),
      timeoutMs,
      "vault surface registration",
    );
    if (mode !== "live" && mode !== "scaffold") {
      console.error(
        `[mnemoverse-memory] @mnemoverse/mcp-vault/register returned an unexpected mode ` +
          `(${String(mode)}); rolling back the partial vault surface.`,
      );
      rollback();
      return "error";
    }
    console.error(`[mnemoverse-memory] Vault surface folded in (${mode}).`);
    return mode;
  } catch (err) {
    rollback();
    const timedOut = err instanceof TimeoutError;
    console.error(
      timedOut
        ? `[mnemoverse-memory] Vault surface registration did not settle within ${timeoutMs}ms — ` +
            "rolled back to memory-only."
        : `[mnemoverse-memory] Failed to register the vault surface: ${asMessage(err)} — rolled ` +
            "back to memory-only.",
    );
    return timedOut ? "timeout" : "error";
  }
}

/**
 * Wrap `server` so every tool the companion registers is recorded, and can be removed as a group
 * if the fold fails partway. The companion uses only `registerTool` (verified), but the proxy
 * forwards ALL other access to the real server — methods are bound to the real target so internal
 * private-field access uses the true `this`, not the proxy.
 */
function withRegistrationRollback(server: McpServer): {
  server: McpServer;
  rollback: () => void;
} {
  const handles: Array<{ remove: () => void }> = [];
  const proxy = new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (...args: unknown[]): unknown => {
          const handle = (
            target.registerTool as unknown as (
              ...a: unknown[]
            ) => { remove?: () => void }
          )(...args);
          if (handle && typeof handle.remove === "function") {
            handles.push(handle as { remove: () => void });
          }
          return handle;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    server: proxy as McpServer,
    // Remove in REVERSE registration order; best-effort — a remove() that throws must not mask the
    // original failure or stop the rest of the rollback.
    rollback: () => {
      for (const handle of handles.splice(0).reverse()) {
        try {
          handle.remove();
        } catch {
          /* best-effort rollback */
        }
      }
    },
  };
}

class TimeoutError extends Error {}

/**
 * Resolve `p`, but reject with a {@link TimeoutError} if it has not settled within `ms`. The timer
 * is `unref`ed so a still-pending `p` (e.g. a hung import) cannot by itself keep the process alive.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${ms}ms`));
    }, ms);
    // Node's setTimeout returns a Timeout object with unref(); guard for non-Node shims.
    (timer as { unref?: () => void }).unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
