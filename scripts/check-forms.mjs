#!/usr/bin/env node
/**
 * Forms inventory check (packaging plan step 2.2).
 *
 * Mnemoverse memory ships as several packaged forms, each in its own public
 * repository (scripts/forms.json). They drift silently: a manifest version is
 * bumped but never released, two manifests in one repository disagree, a form
 * points at an old endpoint, or a copied skill falls behind its source. This
 * prints every such gap, one line each, and exits 1 if there is any.
 *
 * Checks per form:
 *   - versions:   every listed file carries the same version;
 *   - release:    that version is the repository's latest release tag (vX.Y.Z);
 *   - endpoint:   every listed MCP URL equals forms.json#endpoint;
 *   - skill:      every listed copy is byte-identical to the canonical skill.
 *
 * Reads files from raw.githubusercontent.com and releases from the GitHub API
 * (GITHUB_TOKEN raises the rate limit when set). No dependencies; Node 18+.
 * A file or release that cannot be read is reported as UNREADABLE, never as a
 * match.
 */
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("./forms.json", import.meta.url), "utf8"));
const token = process.env.GITHUB_TOKEN;
const problems = [];
const lines = [];

async function raw(repo, path) {
  const r = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${path}`);
  if (!r.ok) throw new Error(`${r.status} for ${repo}/${path}`);
  return r.text();
}

async function latestRelease(repo) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} for ${repo} releases/latest`);
  return (await r.json()).tag_name;
}

function field(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function report(kind, repo, text) {
  const line = `${kind.padEnd(11)} ${repo}: ${text}`;
  lines.push(line);
  if (kind !== "ok") problems.push(line);
}

let canonicalSkill;
try {
  canonicalSkill = await raw(cfg.skill.canonical.repo, cfg.skill.canonical.path);
} catch (e) {
  report("UNREADABLE", cfg.skill.canonical.repo, `canonical skill (${e.message})`);
}

for (const form of cfg.forms) {
  const { repo } = form;
  const found = [];
  for (const v of form.versions) {
    try {
      const value = field(JSON.parse(await raw(repo, v.path)), v.field);
      found.push({ path: v.path, value });
    } catch (e) {
      report("UNREADABLE", repo, `${v.path} (${e.message})`);
    }
  }
  const distinct = [...new Set(found.map((f) => f.value))];
  if (distinct.length > 1) {
    report("VERSIONS", repo, found.map((f) => `${f.path}=${f.value}`).join(", "));
  }
  const version = distinct.length === 1 ? distinct[0] : undefined;
  if (version !== undefined) {
    try {
      const tag = await latestRelease(repo);
      if (tag !== `v${version}`) {
        report("UNRELEASED", repo, `manifests say ${version}, latest release is ${tag ?? "none"}`);
      } else {
        report("ok", repo, `${version} released`);
      }
    } catch (e) {
      report("UNREADABLE", repo, `latest release (${e.message})`);
    }
  }
  for (const ep of form.endpoints) {
    try {
      const url = field(JSON.parse(await raw(repo, ep.path)), ep.field);
      if (url !== cfg.endpoint) report("ENDPOINT", repo, `${ep.path} points at ${url}, expected ${cfg.endpoint}`);
    } catch (e) {
      report("UNREADABLE", repo, `${ep.path} (${e.message})`);
    }
  }
  for (const path of form.skillCopies) {
    if (canonicalSkill === undefined) continue;
    try {
      if ((await raw(repo, path)) !== canonicalSkill) {
        report("SKILL", repo, `${path} differs from ${cfg.skill.canonical.repo}/${cfg.skill.canonical.path}`);
      }
    } catch (e) {
      report("UNREADABLE", repo, `${path} (${e.message})`);
    }
  }
}

for (const l of lines) console.log(l);
console.log(problems.length ? `\n${problems.length} gap(s) across ${cfg.forms.length} forms.` : `\nAll ${cfg.forms.length} forms in sync.`);
process.exit(problems.length ? 1 : 0);
