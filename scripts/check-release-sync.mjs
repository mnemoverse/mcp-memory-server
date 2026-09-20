#!/usr/bin/env node
/**
 * release-sync check (issue #31).
 *
 * Confirms every public surface we publish to is tracking the current release
 * — i.e. matches `package.json#version` (the source of truth the release
 * pipeline fans out from). A silent gap here means one of two different
 * problems, and this check tells them apart: a FIRST-PARTY release half-
 * landed (e.g. npm published but the registry publish failed), or a
 * FOLLOW-UP surface in another repository is simply waiting on a human to
 * merge a small bump PR. Both make a directory, a docs reader, or a
 * marketing visitor see a version we no longer ship — but only the first one
 * means the release pipeline is broken.
 *
 * First-party surfaces (we publish these ourselves; a mismatch is DRIFT):
 *   - npm                     registry.npmjs.org  → dist-tags.latest
 *   - Official MCP Registry   registry.modelcontextprotocol.io → latest version
 *                             (+ the hosted `remotes` endpoint must be present)
 *   - GitHub release          api.github.com → releases/latest tag
 *
 * Follow-up surfaces (a human merges a small bump PR in ANOTHER repository
 * after each release; an old version there is FOLLOW-UP LAG, never drift):
 *   - docs (llms-full.txt)    mnemoverse.com/docs/llms-full.txt → the
 *                             `Current release: **vX.Y.Z**` line, rendered by
 *                             mnemoverse-docs from its data/facts.json
 *   - marketing (server-card) mnemoverse.com/.well-known/mcp/server-card.json
 *                             → `serverInfo.version`, set by mnemoverse-marketing
 *
 * Downstream surfaces (PulseMCP / Glama / VS Code gallery) AUTO-INGEST from the
 * registry on their own schedule, so they're reported FOR INFO ONLY — never gated
 * (a lag there is expected, not a drift or a follow-up we're waiting on).
 *
 * Usage: `node scripts/check-release-sync.mjs` (no deps; needs Node 18+ fetch).
 *
 * Testing hook: set RELEASE_SYNC_EXPECTED to the version you want this run to
 * compare surfaces against, instead of package.json#version. It exists to
 * rehearse the DRIFT / FOLLOW-UP LAG branches against the real, live surfaces
 * without touching any network code path. Leaving it unset changes nothing —
 * EXPECTED falls back to package.json#version exactly as before this existed.
 *
 * Exit 0 = every first-party surface answered AND matched, AND both follow-up
 *          surfaces answered AND matched.
 * Exit 1 = at least one surface DRIFTED (first-party, answered with the wrong
 *          version — a release half-landed), or LAGGED (follow-up, answered
 *          with an older version — a bump PR elsewhere hasn't merged yet), or
 *          COULD NOT BE CHECKED (didn't answer at all, or its body couldn't
 *          be parsed for a version).
 *
 * These three outcomes are counted and reported separately, and they must
 * stay separate. A timeout against npm is not evidence that a release half-
 * landed; it is evidence that nothing is known about npm this run. An old
 * version on the docs site is likewise not evidence that npm or the registry
 * are broken — it's evidence that a docs PR is sitting unmerged in a
 * different repository. Folding either into "drift" sends a responder into
 * release-pipeline recovery for a problem that lives elsewhere (or does not
 * exist at all) — that exact confusion sent a responder into release
 * recovery for a network blip before this file grew the distinction. All
 * three outcomes are still red, because a surface nobody could read, or a
 * surface still lagging, is a surface nobody has confirmed matches the
 * release, and a green run that verified nothing is the malfunction this
 * check exists to prevent. What changed is what the red run CLAIMS.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PKG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);
const EXPECTED = process.env.RELEASE_SYNC_EXPECTED || PKG.version;
const NPM_NAME = "@mnemoverse/mcp-memory-server";
const REGISTRY_NAME = "io.github.mnemoverse/mcp-memory-server";
const GH_REPO = "mnemoverse/mcp-memory-server";
const DOCS_LLMS_FULL_URL = "https://mnemoverse.com/docs/llms-full.txt";
const MARKETING_SERVER_CARD_URL = "https://mnemoverse.com/.well-known/mcp/server-card.json";

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

async function getText(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "mnemoverse-release-sync-check", ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
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

async function checkDocsLlmsFull() {
  const text = await getText(DOCS_LLMS_FULL_URL);
  const m = text.match(/Current release: \*\*v([^*]+)\*\*/);
  if (!m) throw new Error('no "Current release: **v...**" line found in llms-full.txt');
  return { version: norm(m[1]) };
}

async function checkMarketingServerCard() {
  const j = await getJson(MARKETING_SERVER_CARD_URL);
  const v = j?.serverInfo?.version;
  if (!v) throw new Error("serverInfo.version missing from server-card.json");
  return { version: norm(v) };
}

// Follow-up surfaces carry their own remediation text because "merge a PR"
// means a different PR, in a different repository, for each of them — a
// responder reading only the failure output should not have to go find that
// out on their own.
const FOLLOW_UP = [
  {
    name: "docs (llms-full.txt)",
    check: checkDocsLlmsFull,
    fix: `merge the bump PR that mcp-version-watch.yml (in mnemoverse-docs) opens from branch bot/mcp-version-${EXPECTED} — or, if the bot could not open it, open one by hand from that branch.`,
  },
  {
    name: "marketing (server-card)",
    check: checkMarketingServerCard,
    fix: `merge a "chore(mcp): version stamps" PR (in mnemoverse-marketing) that sets serverInfo.version to ${EXPECTED} in public/.well-known/mcp/server-card.json.`,
  },
];

function line(name, status, version, extra = "") {
  const v = version ? `v${version}`.padEnd(10) : "—".padEnd(10);
  return `  ${name.padEnd(24)} ${v} ${status}${extra ? `  (${extra})` : ""}`;
}

async function main() {
  const expectedSource = process.env.RELEASE_SYNC_EXPECTED
    ? "RELEASE_SYNC_EXPECTED override"
    : "package.json";
  console.log(`release-sync check — expected v${EXPECTED} (${expectedSource})\n`);
  const firstParty = [
    ["npm", checkNpm],
    ["Official MCP Registry", checkRegistry],
    ["GitHub release", checkGithubRelease],
  ];

  // Three distinct outcomes, never merged into one boolean. See the header.
  const drifted = [];
  const lagging = [];
  const unchecked = [];

  for (const [name, fn] of firstParty) {
    try {
      const { version, extra } = await fn();
      const ok = version === EXPECTED && extra !== "remote MISSING";
      if (!ok) drifted.push(name);
      const status = version === EXPECTED ? (extra === "remote MISSING" ? "✗ remote missing" : "✓") : `✗ DRIFT (have v${version || "?"})`;
      console.log(line(name, status, version, extra && extra !== "remote MISSING" ? extra : ""));
    } catch (err) {
      // NOT drift. A timeout, a 5xx or a rate limit means this surface did not
      // answer, so the version it serves is UNKNOWN. Recording that as drift
      // asserted a half-landed release the run had no evidence for.
      unchecked.push(name);
      console.log(line(name, `? could not be checked: ${err.message}`, null));
    }
  }

  for (const { name, check, fix } of FOLLOW_UP) {
    try {
      const { version } = await check();
      if (version === EXPECTED) {
        console.log(line(name, "✓", version));
      } else {
        // NOT drift either. This surface is updated by a human merging a PR
        // in a different repository, so an old version here means that PR
        // hasn't merged yet — the release pipeline itself already succeeded.
        lagging.push({ name, version, fix });
        console.log(line(name, `✗ FOLLOW-UP LAG (have v${version || "?"})`, version));
      }
    } catch (err) {
      unchecked.push(name);
      console.log(line(name, `? could not be checked: ${err.message}`, null));
    }
  }

  console.log(
    "\n  (note) downstream surfaces — PulseMCP / Glama / VS Code gallery — auto-ingest from the registry on their own schedule; not gated here. The two follow-up surfaces above are different: they're gated, but a lag there is a pending PR in another repository, not a drift we caused.",
  );

  if (drifted.length > 0) {
    console.error(`\nDRIFT: ${drifted.join(", ")} answered, but not with v${EXPECTED} (or the registry entry has no remote). A release half-landed. Investigate the release pipeline (release.yml).`);
  }
  if (lagging.length > 0) {
    console.error(`\nFOLLOW-UP LAG: ${lagging.map((l) => l.name).join(", ")} answered with an older version than v${EXPECTED}. This is NOT drift and does not mean a release half-landed — the release pipeline is fine, a bump PR in another repository is simply not merged yet:`);
    for (const l of lagging) {
      console.error(`  - ${l.name}: ${l.fix}`);
    }
  }
  if (unchecked.length > 0) {
    console.error(`\nCOULD NOT BE CHECKED: ${unchecked.join(", ")} did not answer this run (or its body could not be parsed for a version), so the version served there is unknown. This is NOT drift and NOT follow-up lag, and it is not by itself evidence of a failed release or a pending PR elsewhere. Re-run, or let tomorrow's scheduled run decide, before acting on it.`);
  }
  if (drifted.length > 0 || lagging.length > 0 || unchecked.length > 0) {
    process.exit(1);
  }
  console.log(`\nAll first-party surfaces in sync at v${EXPECTED}, and both follow-up surfaces (docs, marketing) have caught up.`);
}

main().catch((err) => {
  console.error("check-release-sync failed:", err);
  process.exit(1);
});
