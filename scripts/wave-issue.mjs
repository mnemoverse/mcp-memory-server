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
 *     `stale-wave` after three days without full green. No open wave for
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

function ensureLabel(name, color, description) {
  try {
    gh(["api", "-X", "POST", `repos/${REPO}/labels`, "-f", `name=${name}`, "-f", `color=${color}`, "-f", `description=${description}`]);
  } catch {
    // exists already (422): fine
  }
}

function findOpenWave(version) {
  const title = waveTitle(version);
  const list = ghJson([
    "api",
    `repos/${REPO}/issues?state=open&labels=${LABEL}&per_page=100`,
  ]);
  return list.find((i) => i.title === title && !i.pull_request) ?? null;
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
  ensureLabel(STALE_LABEL, "d93f0b", "A release wave with a consumer that has not moved for three days");
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
    console.log(`no result file at ${path} (the check did not get as far as writing one); nothing to tick`);
    return;
  }
  const result = JSON.parse(readFileSync(path, "utf8"));
  const version = norm(result.expected);
  const results = result.consumers ?? {};
  const issue = findOpenWave(version);
  if (!issue) {
    console.log(`no open wave issue for v${version}; nothing to tick`);
    return;
  }
  const before = issue.body ?? "";
  const after = applyResults(before, consumers, results);
  const green = allProbedGreen(consumers, results);
  const done = green && allTicked(after, consumers);
  const changed = after !== before;
  const checkedAt = result.checkedAt ?? new Date().toISOString();
  if (changed) {
    gh(["api", "-X", "PATCH", `repos/${REPO}/issues/${issue.number}`, "--input", "-"], JSON.stringify({ body: after }));
  }
  const summary = consumers
    .filter((c) => c.kind !== "manual")
    .map((c) => `${results[c.id]?.status === "ok" ? "✓" : "✗"} ${c.name}`)
    .join("; ");
  if (done) {
    gh(["api", "-X", "POST", `repos/${REPO}/issues/${issue.number}/comments`, "-f",
      `body=Every consumer serves v${version} (${checkedAt}): ${summary}. Closing the wave.`]);
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
