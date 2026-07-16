// Behavioral tests for the optional vault-surface fold (Increment 2 of the single memory-MCP
// facade). The seam decides whether the CLOSED @mnemoverse/mcp-vault companion gets folded into
// THIS open server. We exercise every branch by INJECTING the importer, so the closed companion
// never has to be present — the open CI stays green, and the fold logic is still fully covered.
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

/** A minimal McpServer stand-in that records every tool the fold registers. */
function spyServer() {
  const registered = [];
  return {
    registered,
    registerTool: (name) => {
      registered.push(name);
    },
  };
}

/** An importer that fails the test if the seam ever calls it (used to prove the env gate). */
function importerMustNotBeCalled() {
  return () => {
    throw new Error("importer should not be called when vault-env is absent");
  };
}

test("off — no vault env: skips the companion entirely, registers nothing", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(
    server,
    {},
    importerMustNotBeCalled(),
  );
  assert.equal(status, "off");
  assert.deepEqual(server.registered, []);
});

test("off — partial vault env (missing passphrase): still gated off", async () => {
  const server = spyServer();
  const { MNEMOVERSE_VAULT_PASSPHRASE, ...partial } = FULL_ENV;
  const status = await maybeRegisterVaultSurface(
    server,
    partial,
    importerMustNotBeCalled(),
  );
  assert.equal(status, "off");
  assert.deepEqual(server.registered, []);
});

test("unavailable — full env but companion not installed: degrades to memory-only", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, async () => {
    const err = new Error("Cannot find package '@mnemoverse/mcp-vault'");
    err.code = "ERR_MODULE_NOT_FOUND";
    throw err;
  });
  assert.equal(status, "unavailable");
  assert.deepEqual(server.registered, []);
});

test("error — companion present but exports no registerVaultSurface()", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(
    server,
    FULL_ENV,
    async () => ({}),
  );
  assert.equal(status, "error");
  assert.deepEqual(server.registered, []);
});

test("error — registerVaultSurface throws: caught, server not crashed", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, async () => ({
    registerVaultSurface: () => {
      throw new Error("boom during registration");
    },
  }));
  assert.equal(status, "error");
});

test("live — companion folds its tools onto THIS server's surface", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, async () => ({
    registerVaultSurface: (s) => {
      s.registerTool("vault_use");
      s.registerTool("create_secret_capture");
      return "live";
    },
  }));
  assert.equal(status, "live");
  assert.deepEqual(server.registered, ["vault_use", "create_secret_capture"]);
});

test("scaffold — companion loads in fail-closed mode (env valid, transport not live)", async () => {
  const server = spyServer();
  const status = await maybeRegisterVaultSurface(server, FULL_ENV, async () => ({
    registerVaultSurface: (s) => {
      s.registerTool("vault_use");
      return "scaffold";
    },
  }));
  assert.equal(status, "scaffold");
  assert.deepEqual(server.registered, ["vault_use"]);
});
