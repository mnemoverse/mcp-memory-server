/**
 * llms.txt — the machine-readable install summary AI crawlers and agent
 * frameworks read to learn how to set this server up (a GEO surface, read by
 * agents rather than humans). It is hand-maintained: confirmed by grepping
 * `OUTPUTS` in scripts/generate-configs.mjs, which lists 18 artifacts under
 * docs/configs/, docs/snippets/, server.json and manifest.json — no llms.txt
 * entry — and by
 * `git log --oneline -- llms.txt`, which shows only manual feature-commit
 * edits, never a generator run. So a defect here is fixed at the source
 * (this file), not chased through generate-configs.mjs.
 *
 * Bug hunt (pre-0.9.2, P2 candidate, confirmed): the Command line omitted
 * `@latest` — `npx @mnemoverse/mcp-memory-server` — while README.md explains
 * at length why every OTHER install snippet in this repo insists on it: bare
 * `npx <pkg>` is cached indefinitely by npm and stops re-checking the
 * registry, so an agent that installed via this exact command would silently
 * stop receiving new releases (README.md, "Why `@latest`?"). Not the
 * registry-pinned case server.json is deliberately exempt from (that exemption
 * is about clients installed through the Official MCP Registry, which resolve
 * their own pinned version from `server.json.version` — llms.txt describes a
 * plain `npx` install, the same bleeding-edge case every docs/configs/*
 * snippet covers).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const llmsTxt = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");

describe("llms.txt install command", () => {
  it("pins @latest, matching every other install surface in this repo", () => {
    const commandLine = llmsTxt.split("\n").find((l) => l.startsWith("Command:"));
    expect(commandLine, "llms.txt has no 'Command:' line").toBeTruthy();
    // Byte-identical to the canonical CLI snippet in README.md ("Claude Code —
    // add via CLI"), minus the `claude mcp add` wrapper — llms.txt describes
    // the bare npx invocation, not a client-specific config file.
    expect(commandLine).toBe("Command: npx -y @mnemoverse/mcp-memory-server@latest");
  });
});
