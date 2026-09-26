#!/usr/bin/env node
/**
 * The "Wave vX.Y.Z" tracker issue, driven by `gh` (GH_TOKEN in the environment).
 *
 *   node scripts/wave-issue.mjs open --version 0.13.0 [--run-url URL]
 *     After a successful release (release.yml): create the issue with one
 *     checklist line per consumer from scripts/consumers.json, labelled
 *     `wave`; if it already exists (a re-run of the release workflow), add a
 *     comment instead of a second issue.
 *
 *   node scripts/wave-issue.mjs tick --result PATH
 *     After the daily release-sync check (release-sync-check.yml): read the
 *     check's JSON result, re-tick the probed lines of the open wave issue for
 *     that version, comment when something changed, close it when every
 *     probed line is green (and no manual line is left unticked), label it
 *     `stale-wave` when it is still open three days after the release. No open wave for
 *     that version (an old release, or the issue was closed by hand) is not
 *     an error: nothing to tick.
 *
 * No third-party dependency: `gh` is on every GitHub runner. Exit 0 on "nothing
 * to do", 1 on a real failure, so a release never fails on its tracker.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  loadConsumers,
  renderWaveBody,
  applyResults,
  allProbedGreen,
  allTicked,
  isStale,
  waveTitle,
  waveVersion,
  isWaveIssue,
  waveConsumers,
  resultsForWave,
  norm,
} from "./lib/wave.mjs";

const REPO = process.env.WAVE_REPO || "mnemoverse/mcp-memory-server";
const LABEL = "wave";
const STALE_LABEL = "stale-wave";

const consumers = loadConsumers(
  JSON.parse(readFileSync(fileURLToPath(new URL("./consumers.json", import.meta.url)), "utf8")),
);

function gh(args, input) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "inherit"],
  });
}

function ghJson(args, input) {
  return JSON.parse(gh(args, input));
}

// Idempotent: --force creates the label or updates an existing one, so the
// only failures left are real ones (auth, network, 5xx), and those propagate
// instead of leaving a wave unlabelled (Copilot on #178).
function ensureLabel(name, color, description) {
  gh(["label", "create", name, "--repo", REPO, "--color", color, "--description", description, "--force"]);
}

// Every open wave, found by its exact title over every page of open issues:
// not by label (a label that failed to apply would hide a wave and a re-run
// would open a duplicate) and not from the first page only (Copilot on #178).
function listOpenWaves() {
  const pages = gh(["api", "--paginate", "--slurp", `repos/${REPO}/issues?state=open&per_page=100`]);
  return JSON.parse(pages)
    .flat()
    .filter(isWaveIssue);
}

function findOpenWave(version) {
  const title = waveTitle(version);
  return listOpenWaves().find((i) => i.title === title) ?? null;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function open() {
  const version = norm(arg("--version"));
  if (!version) throw new Error("--version is required");
  const runUrl = arg("--run-url") ?? "";
  ensureLabel(LABEL, "0e8a16", "A release wave: every consumer of the MCP surface that must move");
  ensureLabel(STALE_LABEL, "d93f0b", "A release wave still open three days after the release");
  const existing = findOpenWave(version);
  if (existing) {
    gh(["api", "-X", "POST", `repos/${REPO}/issues/${existing.number}/comments`, "-f",
      `body=The release workflow ran again for v${version}${runUrl ? ` ([run](${runUrl}))` : ""}; this wave is still open and its lines are unchanged.`]);
    console.log(`wave issue #${existing.number} exists, commented`);
    return;
  }
  const body = renderWaveBody({ version, consumers, runUrl });
  const created = ghJson(
    ["api", "-X", "POST", `repos/${REPO}/issues`, "--input", "-"],
    JSON.stringify({ title: waveTitle(version), body, labels: [LABEL] }),
  );
  console.log(`opened wave issue #${created.number}: ${created.html_url}`);
}

function tick() {
  const path = arg("--result");
  if (!path) throw new Error("--result is required");
  if (!existsSync(path)) {
    // A missing result means the probe step broke before writing one, not
    // that there is nothing to report: fail, so open waves do not silently
    // stop being ticked (Copilot on #178).
    throw new Error(`no result file at ${path}: the probe step failed before writing one`);
    return;
  }
  const result = JSON.parse(readFileSync(path, "utf8"));
  // Validate before any write (Copilot on #178): the version must be this
  // checkout's package.json version (the trusted job checks out the default
  // branch), every consumer id must be in the registry, every status one of
  // the three the check writes. Anything else is refused, not applied.
  const version = norm(result.expected);
  const trusted = norm(JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")).version);
  if (version !== trusted) throw new Error(`result is for v${version}, but this checkout is v${trusted}; refusing to tick`);
  const known = new Set(consumers.map((c) => c.id));
  const results = {};
  for (const [id, r] of Object.entries(result.consumers ?? {})) {
    if (!known.has(id)) throw new Error(`result names an unknown consumer ${JSON.stringify(id)}; refusing to tick`);
    if (!r || !["ok", "lag", "unchecked"].includes(r.status)) throw new Error(`result for ${id} has status ${JSON.stringify(r?.status)}; refusing to tick`);
    if (r.status !== "unchecked" && norm(r.version) === "") throw new Error(`result for ${id} carries no version; refusing to tick`);
    if (r.status === "ok" && norm(r.version) !== trusted) throw new Error(`result marks ${id} ok at v${norm(r.version)}, not v${trusted}; refusing to tick`);
    results[id] = { status: r.status, version: r.version == null ? undefined : String(r.version).slice(0, 40), error: r.error == null ? undefined : String(r.error).slice(0, 200) };
  }
  // Every open wave, not only the current version's: after the next release an
  // older wave is still maintained (ticked, closed, labelled stale) instead of
  // staying open forever (Copilot on #178). A consumer serving the wave's
  // version or a later one has done its part for that wave.
  const waves = listOpenWaves();
  if (waves.length === 0) {
    console.log(`no open wave issue; nothing to tick`);
    return;
  }
  // One wave failing (an issue closed mid-run, a transient 5xx) must not skip
  // the others; the run still fails at the end (CodeRabbit on #178).
  let failed = 0;
  for (const issue of waves) {
    try {
      tickWave(issue, waveVersion(issue.title), results, result.checkedAt);
    } catch (err) {
      failed++;
      console.error(`wave #${issue.number} tick failed: ${err?.message ?? err}`);
    }
  }
  if (failed) throw new Error(`${failed} of ${waves.length} wave(s) failed to tick`);
}

function tickWave(issue, waveVer, results, checkedAtRaw) {
  const waveResults = resultsForWave(results, waveVer);
  // Re-read the body right before rewriting it, so a person's edit made while
  // this run was probing is the base of the rewrite, not lost to it. The jobs
  // that tick are serialized (concurrency group tick-wave), so the only other
  // writer is a person; the remaining window is one API round trip.
  const fresh = ghJson(["api", `repos/${REPO}/issues/${issue.number}`]);
  const before = fresh.body ?? "";
  // The consumers this wave was opened with, not the registry of today.
  const own = waveConsumers(before, consumers);
  if (own.length === 0) {
    console.log(`wave #${issue.number} has no consumer line; left alone`);
    return;
  }
  const after = applyResults(before, own, waveResults);
  const green = allProbedGreen(own, waveResults);
  const done = green && allTicked(after, own);
  const changed = after !== before;
  const checkedAt = checkedAtRaw ?? new Date().toISOString();
  if (changed) {
    gh(["api", "-X", "PATCH", `repos/${REPO}/issues/${issue.number}`, "--input", "-"], JSON.stringify({ body: after }));
  }
  const summary = own
    .filter((c) => c.kind !== "manual")
    .map((c) => `${waveResults[c.id]?.status === "ok" ? "✓" : "✗"} ${c.name}`)
    .join("; ");
  if (done) {
    gh(["api", "-X", "POST", `repos/${REPO}/issues/${issue.number}/comments`, "-f",
      `body=Every consumer serves v${waveVer} or later (${checkedAt}): ${summary}. Closing the wave.`]);
    gh(["api", "-X", "PATCH", `repos/${REPO}/issues/${issue.number}`, "-f", "state=closed", "-f", "state_reason=completed"]);
    console.log(`wave #${issue.number} closed: all green`);
    return;
  }
  if (changed) {
    gh(["api", "-X", "POST", `repos/${REPO}/issues/${issue.number}/comments`, "-f",
      `body=Probed ${checkedAt}: ${summary}.${green ? " Every probed consumer is green; a manual line is still unticked." : ""}`]);
  }
  const labels = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
  if (isStale(issue.created_at, Date.now()) && !labels.includes(STALE_LABEL)) {
    gh(["api", "-X", "POST", `repos/${REPO}/issues/${issue.number}/labels`, "--input", "-"], JSON.stringify({ labels: [STALE_LABEL] }));
    gh(["api", "-X", "POST", `repos/${REPO}/issues/${issue.number}/comments`, "-f",
      `body=Three days after the release, this wave is not complete: ${summary}. Labelled ${STALE_LABEL}; the fixes are on each line.`]);
    console.log(`wave #${issue.number} labelled ${STALE_LABEL}`);
  }
  console.log(`wave #${issue.number} ticked (${changed ? "changed" : "unchanged"}): ${summary}`);
}

const cmd = process.argv[2];
try {
  if (cmd === "open") open();
  else if (cmd === "tick") tick();
  else {
    console.error("usage: wave-issue.mjs open --version X [--run-url U] | tick --result PATH");
    process.exit(2);
  }
} catch (err) {
  console.error(`wave-issue ${cmd} failed:`, err?.message ?? err);
  process.exit(1);
}
