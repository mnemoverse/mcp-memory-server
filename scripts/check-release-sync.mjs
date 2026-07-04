#!/usr/bin/env node
/**
 * release-sync check (issue #31).
 *
 * Confirms every FIRST-PARTY public surface we publish to is tracking the
 * current release — i.e. matches `package.json#version` (the source of truth the
 * release pipeline fans out from). A silent drift here means a release half-
 * landed (e.g. npm published but the registry publish failed), which is exactly
 * the failure mode that makes a directory mark us "unmaintained".
 *
 * First-party surfaces (we publish; gated → a mismatch FAILS the check):
 *   - npm                     registry.npmjs.org  → dist-tags.latest
 *   - Official MCP Registry   registry.modelcontextprotocol.io → latest version
 *                             (+ the hosted `remotes` endpoint must be present)
 *   - GitHub release          api.github.com → releases/latest tag
 *
 * Downstream surfaces (PulseMCP / Glama / VS Code gallery) AUTO-INGEST from the
 * registry on their own schedule, so they're reported FOR INFO ONLY — never gated
 * (a lag there is expected, not a drift we caused).
 *
 * Usage: `node scripts/check-release-sync.mjs` (no deps; needs Node 18+ fetch).
 * Exit 0 = all first-party surfaces in sync; exit 1 = drift or unreachable.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PKG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);
const EXPECTED = PKG.version;
const NPM_NAME = "@mnemoverse/mcp-memory-server";
const REGISTRY_NAME = "io.github.mnemoverse/mcp-memory-server";
const GH_REPO = "mnemoverse/mcp-memory-server";

const TIMEOUT_MS = 20_000;

async function getJson(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "mnemoverse-release-sync-check", ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const norm = (v) => (v ?? "").toString().replace(/^v/, "").trim();

async function checkNpm() {
  const j = await getJson(`https://registry.npmjs.org/${NPM_NAME}/latest`);
  return { version: norm(j.version) };
}

async function checkRegistry() {
  // limit=100 keeps every version snapshot of our (single) server on one page —
  // we have <20 versions, so this sidesteps cursor pagination for any realistic
  // count without a follow-the-cursor loop.
  const j = await getJson(
    "https://registry.modelcontextprotocol.io/v0/servers?search=mnemoverse&limit=100",
  );
  // The API returns every version snapshot as a separate entry; each carries a
  // server doc + a _meta with the registry's isLatest flag.
  const isLatest = (entry) =>
    entry?._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest ??
    entry?._meta?.isLatest ??
    false;
  const mine = (j.servers ?? j).filter((e) => (e.server ?? e).name === REGISTRY_NAME);
  if (mine.length === 0) throw new Error(`server ${REGISTRY_NAME} not found in registry`);
  const chosen =
    mine.find(isLatest) ??
    [...mine].sort((a, b) =>
      norm((b.server ?? b).version).localeCompare(norm((a.server ?? a).version), undefined, {
        numeric: true,
      }),
    )[0];
  const srv = chosen.server ?? chosen;
  const hasRemote = Array.isArray(srv.remotes) && srv.remotes.length > 0;
  return { version: norm(srv.version), extra: hasRemote ? "remote ✓" : "remote MISSING" };
}

async function checkGithubRelease() {
  const headers = process.env.GITHUB_TOKEN
    ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {};
  const j = await getJson(`https://api.github.com/repos/${GH_REPO}/releases/latest`, headers);
  return { version: norm(j.tag_name) };
}

function line(name, status, version, extra = "") {
  const v = version ? `v${version}`.padEnd(10) : "—".padEnd(10);
  return `  ${name.padEnd(24)} ${v} ${status}${extra ? `  (${extra})` : ""}`;
}

async function main() {
  console.log(`release-sync check — expected v${EXPECTED} (package.json)\n`);
  const firstParty = [
    ["npm", checkNpm],
    ["Official MCP Registry", checkRegistry],
    ["GitHub release", checkGithubRelease],
  ];

  let drift = false;
  for (const [name, fn] of firstParty) {
    try {
      const { version, extra } = await fn();
      const ok = version === EXPECTED && extra !== "remote MISSING";
      if (!ok) drift = true;
      const status = version === EXPECTED ? (extra === "remote MISSING" ? "✗ remote missing" : "✓") : `✗ DRIFT (have v${version || "?"})`;
      console.log(line(name, status, version, extra && extra !== "remote MISSING" ? extra : ""));
    } catch (err) {
      drift = true;
      console.log(line(name, `✗ unreachable: ${err.message}`, null));
    }
  }

  console.log(
    "\n  (note) downstream surfaces — PulseMCP / Glama / VS Code gallery — auto-ingest from the registry on their own schedule; not gated here.",
  );

  if (drift) {
    console.error(`\nDRIFT: at least one first-party surface is not tracking v${EXPECTED}. Investigate the release pipeline (release.yml).`);
    process.exit(1);
  }
  console.log(`\nAll first-party surfaces in sync at v${EXPECTED}.`);
}

main().catch((err) => {
  console.error("check-release-sync failed:", err);
  process.exit(1);
});
