// Behavioral tests for the optional vault-surface fold (Increment 2 of the single memory-MCP
// facade). The seam decides whether the CLOSED @mnemoverse/mcp-vault companion gets folded into
// THIS open server. We exercise every branch by INJECTING the importer, so the closed companion
// never has to be present — the open CI stays green, and the fold logic is fully covered,
// including the robustness paths (hang, async reject, mid-registration failure) found in review.
//
// Run: npm test  (builds, then `node --test`). No test runner dependency — node:test is built in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { maybeRegisterVaultSurface } from "../dist/vault-surface.js";

const FULL_ENV = {
  MNEMOVERSE_VAULT_SERVER_URL: "https://core.mnemoverse.com/api/v1",
  MNEMOVERSE_VAULT_TOKEN: "tok_test",
  MNEMOVERSE_VAULT_PASSPHRASE: "correct horse battery staple",
};

/**
 * A minimal McpServer stand-in that records the tools the fold registers and honors remove() so
 * rollback is observable. `registered` reflects the CURRENT surface; `removed` is the rollback log.
 */
function spyServer() {
  const registered = [];
  const removed = [];
  return {
    registered,
    removed,
    registerTool(name) {
      registered.push(name);
      return {
        remove() {
          removed.push(name);
          const i = registered.indexOf(name);
          if (i >= 0) registered.splice(i, 1);
        },
      };
    },
  };
}

/** An importer that fails the test if the seam ever calls it (used to prove the env gate). */
function importerMustNotBeCalled() {
  return () => {
    throw new Error("importer should not be called when vault-env is absent");
  };
}

// --- env gate (fail-closed on opt-in) ------------------------------------------------------------

test("off — no vault env: skips the companion entirely, registers nothing", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, {}, {
    importRegister: importerMustNotBeCalled(),
  });
  assert.equal(status, "off");
  assert.deepEqual(server.registered, []);
});

test("off — partial vault env (missing passphrase): still gated off", async () => {
  const server = spyServer();
  const { MNEMOVERSE_VAULT_PASSPHRASE, ...partial } = FULL_ENV;
  const status = await maybeRegisterVaultSurface(server, partial, {
    importRegister: importerMustNotBeCalled(),
  });
  assert.equal(status, "off");
  assert.deepEqual(server.registered, []);
});

test("off — whitespace-only env values count as absent (env-templating accident)", async () => {
  const server = spyServer();
  const blank = {
    MNEMOVERSE_VAULT_SERVER_URL: "   ",
    MNEMOVERSE_VAULT_TOKEN: "\t",
    MNEMOVERSE_VAULT_PASSPHRASE: "  ",
  };
  const status = await maybeRegisterVaultSurface(server, blank, {
    importRegister: importerMustNotBeCalled(),
  });
  assert.equal(status, "off");
  assert.deepEqual(server.registered, []);
});

// --- load failures (fail-open for the server) ----------------------------------------------------

test("unavailable — full env but companion not installed: degrades to memory-only", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, {
    importRegister: async () => {
      const err = new Error("Cannot find package '@mnemoverse/mcp-vault'");
      err.code = "ERR_MODULE_NOT_FOUND";
      throw err;
    },
  });
  assert.equal(status, "unavailable");
  assert.deepEqual(server.registered, []);
});

test("timeout — a never-settling import does not hang startup", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, {
    importRegister: () => new Promise(() => {}), // never settles
    companionTimeoutMs: 20,
  });
  assert.equal(status, "timeout");
  assert.deepEqual(server.registered, []);
});

// --- bad companion shape (never throws out) ------------------------------------------------------

test("error — companion present but exports no registerVaultSurface()", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, {
    importRegister: async () => ({}),
  });
  assert.equal(status, "error");
  assert.deepEqual(server.registered, []);
});

test("error — registerVaultSurface is a throwing getter: caught, server not crashed", async () => {
  const server = spyServer();
  const mod = {};
  Object.defineProperty(mod, "registerVaultSurface", {
    get() {
      throw new Error("hostile getter");
    },
  });
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, {
    importRegister: async () => mod,
  });
  assert.equal(status, "error");
  assert.deepEqual(server.registered, []);
});

test("error — unexpected mode return: rolls back the partial surface", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, {
    importRegister: async () => ({
      registerVaultSurface: (s) => {
        s.registerTool("vault_use");
        return "partial"; // not "live" | "scaffold"
      },
    }),
  });
  assert.equal(status, "error");
  assert.deepEqual(server.registered, []); // vault_use rolled back
  assert.deepEqual(server.removed, ["vault_use"]);
});

// --- mid-registration failure rollback (degrade to memory-only) -----------------------------------

test("error — sync throw AFTER registering a tool: rolled back", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, {
    importRegister: async () => ({
      registerVaultSurface: (s) => {
        s.registerTool("vault_use");
        throw new Error("boom after first tool");
      },
    }),
  });
  assert.equal(status, "error");
  assert.deepEqual(server.registered, []);
  assert.deepEqual(server.removed, ["vault_use"]);
});

test("error — ASYNC reject AFTER registering a tool: caught + rolled back (no crash)", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, {
    importRegister: async () => ({
      registerVaultSurface: async (s) => {
        s.registerTool("vault_use");
        throw new Error("async boom");
      },
    }),
  });
  assert.equal(status, "error");
  assert.deepEqual(server.registered, []);
  assert.deepEqual(server.removed, ["vault_use"]);
});

test("timeout — a never-settling registration is bounded + rolled back", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, {
    importRegister: async () => ({
      registerVaultSurface: (s) => {
        s.registerTool("vault_use");
        return new Promise(() => {}); // never settles
      },
    }),
    companionTimeoutMs: 20,
  });
  assert.equal(status, "timeout");
  assert.deepEqual(server.registered, []);
  assert.deepEqual(server.removed, ["vault_use"]);
});

// --- happy paths ---------------------------------------------------------------------------------

test("live — companion folds its tools onto THIS server's surface", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, {
    importRegister: async () => ({
      registerVaultSurface: (s) => {
        s.registerTool("vault_use");
        s.registerTool("create_secret_capture");
        return "live";
      },
    }),
  });
  assert.equal(status, "live");
  assert.deepEqual(server.registered, ["vault_use", "create_secret_capture"]);
  assert.deepEqual(server.removed, []); // nothing rolled back on success
});

test("scaffold — companion loads in fail-closed mode (env valid, transport not live)", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, {
    importRegister: async () => ({
      registerVaultSurface: (s) => {
        s.registerTool("vault_use");
        return "scaffold";
      },
    }),
  });
  assert.equal(status, "scaffold");
  assert.deepEqual(server.registered, ["vault_use"]);
  assert.deepEqual(server.removed, []);
});
