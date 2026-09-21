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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMemoryServer, type Harness } from "./harness.js";

const llmsTxt = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");

interface Listed {
  name: string;
  type: string;
  required: boolean;
}

// The type words llms.txt uses, as the JSON Schema type each one stands for.
const LISTED_TYPES: Record<string, string> = {
  string: "string",
  "string[]": "array",
  integer: "integer",
  number: "number",
  "ISO-8601 string": "string",
  "ISO-8601 strings": "string",
};

/**
 * Every parameter bullet under each `### tool` heading, read as
 * `- name (type, required|optional[, ...]): ...`; "since / until" is two
 * parameters sharing one bullet. A bullet that does not fit that shape fails
 * here rather than being skipped, so the file cannot drift into a form this
 * test no longer reads.
 */
function listedParameters(): Map<string, Listed[]> {
  const byTool = new Map<string, Listed[]>();
  let tool: string | null = null;
  for (const line of llmsTxt.split("\n")) {
    const heading = line.match(/^### (\w+)/);
    if (heading) {
      tool = heading[1];
      byTool.set(tool, []);
    } else if (line.startsWith("## ")) {
      tool = null;
    } else if (tool && line.startsWith("- ")) {
      const bullet = line.match(/^- ([\w /]+?) \(([^,)]+), (required|optional)[,)]/);
      expect(bullet, `unreadable parameter bullet under ${tool}: ${line}`).toBeTruthy();
      const [, names, type, requirement] = bullet!;
      for (const name of names.split(" / ")) {
        byTool.get(tool)!.push({ name, type, required: requirement === "required" });
      }
    }
  }
  return byTool;
}

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

// Found by Copilot on #145: memory_feedback's parameter became memory_ids in
// the tool schema while this file still told agents atom_ids was required, so
// anything learning the surface from here kept sending the deprecated name.
// Being hand-written, the file drifts silently unless a test holds it to the
// schema the server actually registers.
describe("llms.txt tool parameters", () => {
  let mcp: Harness;
  beforeAll(async () => {
    mcp = await startMemoryServer();
  });
  afterAll(async () => {
    await mcp.close();
  });

  it("lists each tool's current parameters, with their type and requirement", async () => {
    const { tools } = await mcp.client.listTools();
    const listed = listedParameters();
    expect([...listed.keys()].sort()).toEqual(tools.map((t) => t.name).sort());
    for (const tool of tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<
        string,
        { type?: string; description?: string }
      >;
      const schemaRequired = new Set(tool.inputSchema.required ?? []);
      // A deprecated alias is accepted but not advertised. A parameter is
      // required when the schema says so or, for memory_ids, whose alias keeps
      // it optional in the schema, when its description opens with "Required".
      const expected = Object.keys(properties)
        .filter((name) => !/^Deprecated/.test(properties[name].description ?? ""))
        .map((name) => ({
          name,
          type: properties[name].type,
          required:
            schemaRequired.has(name) || /^Required/.test(properties[name].description ?? ""),
        }));
      const actual = (listed.get(tool.name) ?? []).map((p) => ({
        name: p.name,
        type: LISTED_TYPES[p.type] ?? `unknown type word "${p.type}"`,
        required: p.required,
      }));
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
      expect(actual.sort(byName), tool.name).toEqual(expected.sort(byName));
    }
  });
});
