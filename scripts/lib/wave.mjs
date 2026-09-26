/**
 * The release wave: the consumer registry (scripts/consumers.json), the probes
 * that read a consumer's live version, and the "Wave vX.Y.Z" issue body with
 * one checklist line per consumer.
 *
 * Pure functions, no I/O of their own: `probeVersion` takes its fetchers as an
 * argument so tests pass stubs, and the issue text is rendered and re-ticked
 * as strings so the same code runs in a test and in scripts/wave-issue.mjs.
 *
 * Why a wave issue at all: a release reaches the docs as a bot PR and every
 * other consumer by a person's memory. The issue is the list of everything
 * that must move, ticked by the daily check from live probes, so a consumer
 * that nobody remembered stays visibly unticked (mnemoverse-agent-pack,
 * protocols/surface-contour.md).
 */

export const norm = (v) => (v ?? "").toString().replace(/^v/, "").trim();

/**
 * A probed surface must yield a readable X.Y.Z. Anything else (an empty
 * capture, a placeholder, a template that did not render) means the version
 * served there is unknown, which is COULD NOT BE CHECKED and never lag.
 */
export function readableVersion(raw, where) {
  const v = norm(raw);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v)) {
    throw new Error(`${where} carries no readable version (got ${JSON.stringify(raw ?? null)})`);
  }
  return v;
}

/** `getPath({a:{b:1}}, "a.b")` → 1; undefined when any step is missing. */
export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const KINDS = new Set(["auto", "track", "manual"]);
const PROBE_TYPES = new Set(["json-field", "text-regex"]);

/** Validate the registry's shape and return its consumers. Loud on a bad row. */
export function loadConsumers(json) {
  const list = json?.consumers;
  if (!Array.isArray(list) || list.length === 0) throw new Error("consumers.json: no consumers[]");
  const ids = new Set();
  for (const c of list) {
    for (const key of ["id", "name", "kind", "repo", "fix"]) {
      if (typeof c[key] !== "string" || c[key].length === 0) {
        throw new Error(`consumers.json: entry ${JSON.stringify(c.id ?? "?")} lacks ${key}`);
      }
    }
    if (!/^[a-z0-9-]+$/.test(c.id)) throw new Error(`consumers.json: id ${c.id} must be [a-z0-9-]`);
    if (ids.has(c.id)) throw new Error(`consumers.json: duplicate id ${c.id}`);
    ids.add(c.id);
    if (!KINDS.has(c.kind)) throw new Error(`consumers.json: ${c.id} has unknown kind ${c.kind}`);
    if (c.kind === "manual") {
      if (c.probe) throw new Error(`consumers.json: manual consumer ${c.id} must not carry a probe`);
      continue;
    }
    const p = c.probe;
    if (!p || !PROBE_TYPES.has(p.type)) throw new Error(`consumers.json: ${c.id} needs a probe of type ${[...PROBE_TYPES].join("|")}`);
    if (typeof p.url !== "string" || !/^https:\/\//.test(p.url)) throw new Error(`consumers.json: ${c.id} probe.url must be https`);
    if (p.type === "json-field" && typeof p.field !== "string") throw new Error(`consumers.json: ${c.id} json-field probe needs field`);
    if (p.type === "text-regex") {
      if (typeof p.regex !== "string") throw new Error(`consumers.json: ${c.id} text-regex probe needs regex`);
      new RegExp(p.regex); // throws on a bad pattern
    }
  }
  return list;
}

/**
 * Read the version a consumer serves. `io` = { getJson(url), getText(url) }.
 * Throws when the surface did not answer or carries no readable version: the
 * caller records COULD NOT BE CHECKED, never lag.
 */
export async function probeVersion(consumer, io) {
  const p = consumer.probe;
  if (!p) throw new Error(`${consumer.id} has no probe (manual consumer)`);
  if (p.type === "json-field") {
    const j = await io.getJson(p.url);
    const v = getPath(j, p.field);
    if (v == null) throw new Error(`${p.field} missing from ${p.url}`);
    return { version: readableVersion(v, `${p.field} at ${p.url}`) };
  }
  if (p.type === "text-regex") {
    const t = await io.getText(p.url);
    const m = t.match(new RegExp(p.regex));
    if (!m) throw new Error(`no match for /${p.regex}/ at ${p.url}`);
    return { version: readableVersion(m[1], `/${p.regex}/ at ${p.url}`) };
  }
  throw new Error(`unknown probe type ${p.type}`);
}

export function waveTitle(version) {
  return `Wave v${norm(version)}`;
}

/** The version a "Wave vX.Y.Z" title names, or null for any other title. */
export function waveVersion(title) {
  const m = /^Wave v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(title ?? "");
  return m ? m[1] : null;
}

/** a >= b on X.Y.Z (a pre-release suffix sorts below its release). */
export function atLeast(a, b) {
  const parse = (v) => {
    const [core, pre] = norm(v).split(/[-+]/, 2);
    return { n: core.split(".").map((x) => Number.parseInt(x, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i];
  }
  if (x.pre === y.pre) return true;
  if (x.pre === null) return true;
  if (y.pre === null) return false;
  return x.pre >= y.pre;
}

/**
 * The results of one probe run, read for a given wave: a consumer that serves
 * the wave's version or a later one has done its part for that wave, so an
 * older wave still open after the next release can be closed too.
 */
export function resultsForWave(results, waveVer) {
  const out = {};
  for (const [id, r] of Object.entries(results)) {
    if (r.status === "unchecked") out[id] = r;
    else out[id] = { ...r, status: atLeast(r.version, waveVer) ? "ok" : "lag" };
  }
  return out;
}

const STATUS_TEXT = {
  ok: (r) => `serves v${r.version}`,
  lag: (r) => `still v${r.version || "?"}`,
  unchecked: (r) => `could not be checked${r.error ? `: ${r.error}` : ""}`,
};

function statusLine(r) {
  if (!r) return "not checked yet";
  const f = STATUS_TEXT[r.status];
  return f ? f(r) : `status ${r.status}`;
}

/**
 * One checklist line per consumer. The `<!-- wave:id -->` marker is what
 * `applyResults` keys on, and the `<!-- status:id -->…<!-- /status:id -->`
 * span is the only part it rewrites, so a person can add notes anywhere else.
 */
export function renderConsumerLine(consumer, version, result) {
  const checked = result?.status === "ok" ? "x" : " ";
  const fix = consumer.fix.replaceAll("<version>", norm(version));
  const how =
    consumer.kind === "manual"
      ? "no live probe: tick this line by hand when it is done"
      : `probe: ${consumer.probe.url}${consumer.probe.field ? ` → ${consumer.probe.field}` : ""}`;
  return `- [${checked}] <!-- wave:${consumer.id} --> **${consumer.name}** (${consumer.kind}). ${how}. Fix: ${fix} <!-- status:${consumer.id} -->${statusLine(result)}<!-- /status:${consumer.id} -->`;
}

export function renderWaveBody({ version, consumers, results = {}, runUrl = "" }) {
  const v = norm(version);
  const probed = consumers.filter((c) => c.kind !== "manual");
  const manual = consumers.filter((c) => c.kind === "manual");
  const lines = [
    `Release **v${v}** of \`@mnemoverse/mcp-memory-server\` is on npm, the Official MCP Registry and GitHub${runUrl ? ` ([run](${runUrl}))` : ""}. This issue lists every consumer of the MCP surface that has to move, from \`scripts/consumers.json\`. The daily \`release-sync check\` ticks the probed lines from live probes and closes this issue when all of them serve v${v}; if it is still open three days after the release it is labelled \`stale-wave\`. Manual lines are ticked by a person.`,
    "",
    "## Probed consumers",
    "",
    ...probed.map((c) => renderConsumerLine(c, v, results[c.id])),
    "",
    "## Manual items",
    "",
    ...manual.map((c) => renderConsumerLine(c, v, results[c.id])),
    "",
    "_Protocol: mnemoverse-agent-pack, protocols/surface-contour.md. Registry: skills/release-wave/references/surfaces.yaml._",
  ];
  return lines.join("\n") + "\n";
}

/** Re-tick the probed lines of an existing body from fresh results. Manual lines and any prose a person added are left alone. */
export function applyResults(body, consumers, results) {
  let out = body;
  for (const c of consumers) {
    if (c.kind === "manual") continue;
    const r = results[c.id];
    if (!r) continue;
    const marker = `<!-- wave:${c.id} -->`;
    const lineRe = new RegExp(`^- \\[( |x)\\] ${escapeRe(marker)}`, "m");
    out = out.replace(lineRe, `- [${r.status === "ok" ? "x" : " "}] ${marker}`);
    const spanRe = new RegExp(`<!-- status:${c.id} -->[^]*?<!-- /status:${c.id} -->`);
    out = out.replace(spanRe, `<!-- status:${c.id} -->${statusLine(r)}<!-- /status:${c.id} -->`);
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every probed consumer answered with the expected version. */
export function allProbedGreen(consumers, results) {
  return consumers.filter((c) => c.kind !== "manual").every((c) => results[c.id]?.status === "ok");
}

/** Every line, probed and manual, is ticked in the body. */
export function allTicked(body, consumers) {
  return consumers.every((c) => new RegExp(`^- \\[x\\] <!-- wave:${c.id} -->`, "m").test(body));
}

export function isStale(createdAtIso, nowMs, days = 3) {
  const created = Date.parse(createdAtIso);
  if (Number.isNaN(created)) return false;
  return nowMs - created > days * 24 * 60 * 60 * 1000;
}
