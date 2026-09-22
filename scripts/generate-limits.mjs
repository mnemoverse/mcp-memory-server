#!/usr/bin/env node
/**
 * src/limits.ts, generated from core's OpenAPI contract.
 *
 * ADR-025 (mnemoverse-core): core defines the API, this package defines the
 * MCP surface. A field limit is core's to set, and a copy nobody checks is a
 * defect — the package's `top_k` said 50 while the engine had accepted 500
 * since June, and `domain` had no length at all while the engine rejects over
 * 100 characters. So the limits are read from the contract and written here,
 * and `--check` proves the committed file still matches it.
 *
 *   npm run limits:refresh   rewrite src/limits.ts from the live contract
 *   npm run limits:check     fail if the committed file no longer matches
 *
 * Defaults are taken as well where the engine states one: a tool description
 * that promises a different default is a lie the caller acts on (`top_k` said
 * 5 while the engine uses 10, and the package does not send the field at all
 * when it is omitted).
 *
 * The URL can be overridden with CORE_OPENAPI_URL (a local export, another
 * deployment). The contract is public, so the check needs no credential.
 */

import { writeFileSync, readFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";

const URL_ = process.env.CORE_OPENAPI_URL ?? "https://core.mnemoverse.com/openapi.json";
const OUT = fileURLToPath(new URL("../src/limits.ts", import.meta.url));

/**
 * What to take, and from where. Every entry names the request schema and the
 * field in it, so a rename in core surfaces as a fetch error here rather than
 * as a silent limit.
 */
const WANTED = [
  ["writeContent", "WriteRequestSchema", "content", ["minLength", "maxLength"]],
  ["writeConcepts", "WriteRequestSchema", "concepts", ["maxItems"]],
  ["domain", "WriteRequestSchema", "domain", ["maxLength"]],
  ["readQuery", "ReadRequestSchema", "query", ["minLength", "maxLength"]],
  ["readTopK", "ReadRequestSchema", "top_k", ["minimum", "maximum", "default"]],
  ["recentLimit", "RecentRequestSchema", "limit", ["minimum", "maximum", "default"]],
  ["recentCursor", "RecentRequestSchema", "cursor", ["maxLength"]],
  ["feedbackOutcome", "FeedbackRequestSchema", "outcome", ["minimum", "maximum"]],
  ["roomName", "CreateRoomRequestSchema", "name", ["minLength", "maxLength"]],
  ["roomDescription", "CreateRoomRequestSchema", "description", ["maxLength"]],
  ["inviteExpiresInDays", "CreateInviteRequestSchema", "expires_in_days", ["minimum", "maximum", "default"]],
  ["inviteMaxUses", "CreateInviteRequestSchema", "max_uses", ["minimum", "maximum", "default"]],
];

/** Core writes an optional field as `anyOf: [{…}, {type: "null"}]`. */
function flatten(schema) {
  const flat = { ...schema };
  for (const part of schema.anyOf ?? []) {
    if (part && part.type !== "null") {
      for (const [k, v] of Object.entries(part)) if (!(k in flat)) flat[k] = v;
    }
  }
  return flat;
}

/** Same bound as the repo's other network check (scripts/check-release-sync.mjs). */
const TIMEOUT_MS = 20_000;

async function fetchContract() {
  // A deadline, so a connection that is accepted and then stalls cannot hold
  // the scheduled runner until GitHub's job timeout.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL_, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "mnemoverse-limits-check" },
    });
    if (!res.ok) throw new Error(`${URL_} answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function collect(contract) {
  const schemas = contract?.components?.schemas ?? {};
  const limits = {};
  for (const [name, schemaName, field, keys] of WANTED) {
    const props = schemas[schemaName]?.properties;
    if (!props) throw new Error(`core's contract has no ${schemaName}`);
    const spec = props[field];
    if (!spec) throw new Error(`${schemaName} has no field ${field}`);
    const flat = flatten(spec);
    const picked = {};
    for (const key of keys) {
      const value = flat[key];
      if (typeof value !== "number") {
        throw new Error(`${schemaName}.${field} has no numeric ${key}`);
      }
      picked[key] = value;
    }
    limits[name] = picked;
  }
  return limits;
}

function render(limits, version) {
  const body = Object.entries(limits)
    .map(([name, picked]) => {
      const fields = Object.entries(picked)
        .map(([k, v]) => `    ${k}: ${v},`)
        .join("\n");
      return `  ${name}: {\n${fields}\n  },`;
    })
    .join("\n");
  return `/**
 * Field limits, GENERATED from core's OpenAPI contract. Do not edit by hand:
 * run \`npm run limits:refresh\`, and \`npm run limits:check\` proves this file
 * still matches the contract.
 *
 * Source: ${URL_}
 * Core API version: ${version}
 *
 * ADR-025 (mnemoverse-core): the engine sets a field's limits; this package
 * reads them. A limit the package invents drifts the moment the engine moves,
 * which is what happened to \`top_k\` (50 here against 500 there) and to
 * \`domain\` (unbounded here against 100 there).
 */

export const CORE_LIMITS = {
${body}
} as const;

/** The contract this file was generated from, for the freshness check. */
export const CORE_CONTRACT = {
  url: ${JSON.stringify(URL_)},
  apiVersion: ${JSON.stringify(version)},
} as const;
`;
}

const contract = await fetchContract();
const version = contract?.info?.version;
if (typeof version !== "string") throw new Error("core's contract has no info.version");
const rendered = render(collect(contract), version);

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current === rendered) {
    console.log(`✓ src/limits.ts matches ${URL_} (core ${version})`);
  } else {
    console.error(
      `✗ src/limits.ts no longer matches ${URL_} (core ${version}).\n` +
        `  Run \`npm run limits:refresh\`, check what moved, and announce it in the CHANGELOG.`,
    );
    process.exit(1);
  }
} else {
  // Written through a temporary file in the same directory and renamed, so an
  // interrupted run cannot leave a half-written src/limits.ts behind
  // (CodeRabbit on #151).
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, rendered, "utf8");
  renameSync(tmp, OUT);
  console.log(`Wrote src/limits.ts from ${URL_} (core ${version})`);
}
