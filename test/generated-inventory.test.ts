/**
 * The list of generated files, and the count of them, must agree with the
 * generator — in every document that states either one.
 *
 * `scripts/generate-configs.mjs` is the source of truth: its `OUTPUTS` array
 * plus the in-place README install-block rewrite are exactly what
 * `npm run verify:configs` checks. Four other files restate that inventory in
 * prose — CONTRIBUTING.md's "never edit by hand" table and its two artifact
 * counts, the pre-push hook's abort message, the CI job's name and comment, and
 * a test-file header that reasons from the list — and all four had drifted:
 * they said 14 or 15 while the generator emitted 19, and none of them mentioned
 * `manifest.json` or the four editor snippets added after they were written.
 *
 * WHY THIS IS WORTH A TEST AND NOT JUST A FIX. The drift is not a typo, it is
 * the predictable outcome of a hand-copied list: `verify:configs` proves the
 * generated FILES match the source, and nothing proved the DOCUMENTS match the
 * generator. CONTRIBUTING.md's own instructions for adding a channel say "update
 * this table" as step 4 of 6 — a step with no consequence for skipping it, which
 * is how the table lost five rows. This file supplies the consequence.
 *
 * IT PARSES THE GENERATOR'S TEXT RATHER THAN IMPORTING IT. `generate-configs.mjs`
 * is a script, not a module: importing it WRITES every artifact as a side effect,
 * which a test must not do. Reading the `OUTPUTS` array as source text is the
 * cheap seam, and if the array is ever restructured beyond this parser's reach
 * the first assertion below fails loudly rather than silently passing on zero
 * paths.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const GENERATOR = read("scripts/generate-configs.mjs");
const CONTRIBUTING = read("CONTRIBUTING.md");

/** Every `path:` inside the `OUTPUTS = [ … ];` array, in declaration order. */
const OUTPUT_PATHS: string[] = (() => {
  const start = GENERATOR.indexOf("const OUTPUTS = [");
  expect(start, "OUTPUTS array not found in scripts/generate-configs.mjs").toBeGreaterThan(-1);
  const end = GENERATOR.indexOf("\n];", start);
  expect(end, "end of the OUTPUTS array not found").toBeGreaterThan(start);
  const body = GENERATOR.slice(start, end);
  return [...body.matchAll(/^\s*path:\s*"([^"]+)"/gm)].map((m) => m[1]!);
})();

/** Generated FILES. The README rewrite is counted separately everywhere,
 *  because it is a region of a human-authored file rather than a whole one. */
const FILE_COUNT = OUTPUT_PATHS.length;
/** What the generator itself prints: `✓ All N artifacts in sync`. */
const TOTAL_COUNT = FILE_COUNT + 1;

describe("the generator's own inventory is intact", () => {
  it("the OUTPUTS array parses to a plausible list", () => {
    // A parser that quietly returned [] would make every assertion below
    // vacuously true — the failure mode this whole file exists to prevent.
    expect(OUTPUT_PATHS.length).toBeGreaterThan(10);
    expect(new Set(OUTPUT_PATHS).size).toBe(OUTPUT_PATHS.length);
    expect(OUTPUT_PATHS).toContain("server.json");
    expect(OUTPUT_PATHS).toContain("manifest.json");
  });
});

describe("CONTRIBUTING.md's generated-files table", () => {
  /** The table between the "generated (never edit by hand)" heading and the
   *  paragraph that follows it. */
  const table = (() => {
    const start = CONTRIBUTING.indexOf("Files that are **generated**");
    expect(start, "the generated-files table heading moved").toBeGreaterThan(-1);
    const end = CONTRIBUTING.indexOf("\n\nIf your editor pops up a diff", start);
    expect(end, "the paragraph after the table moved").toBeGreaterThan(start);
    return CONTRIBUTING.slice(start, end);
  })();

  it("names every file the generator writes", () => {
    // The table is the thing a contributor reads before deciding whether a diff
    // in a file is theirs to keep. A file missing from it reads as hand-editable.
    const missing = OUTPUT_PATHS.filter((p) => !table.includes(`\`${p}\``));
    expect(missing, "generated files absent from the CONTRIBUTING.md table").toEqual([]);
  });

  it("names nothing the generator does not write", () => {
    // The other direction: a row for a file that no longer exists tells a
    // contributor to leave a stale artifact alone forever.
    const rows = [...table.matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]!);
    // README.md is the one legitimate non-OUTPUTS row: the generator rewrites a
    // REGION of it rather than emitting the whole file, so it is listed last and
    // described as such.
    const strays = rows.filter((r) => r !== "README.md" && !OUTPUT_PATHS.includes(r));
    expect(strays, "CONTRIBUTING.md table rows with no OUTPUTS entry").toEqual([]);
  });

  it("has one row per generated file, plus the README install block", () => {
    const rowCount = [...table.matchAll(/^\| /gm)].length;
    // Header row + separator row + one row per file + the README row.
    expect(rowCount).toBe(2 + FILE_COUNT + 1);
  });
});

describe("every stated artifact count matches the generator", () => {
  /** Files that restate the inventory in prose. Each is here because it was
   *  wrong at some point, and each is a place a reader trusts. */
  const COUNTED = [
    "CONTRIBUTING.md",
    "scripts/install-hooks.mjs",
    "scripts/generate-configs.mjs",
    ".github/workflows/verify-configs.yml",
    "test/llms-txt.test.ts",
  ] as const;

  it.each(COUNTED)("%s states no stale artifact count", (rel) => {
    // "19 artifacts", "18 generated artifacts", "19 distribution artifacts".
    // A number written any other way is not caught — this is a net for the
    // phrasings that exist, not a proof about prose in general.
    const found = [...read(rel).matchAll(/(\d+)\s+(?:[A-Za-z-]+\s+){0,2}artifacts?\b/g)].map(
      (m) => Number(m[1]),
    );
    for (const n of found) {
      expect([FILE_COUNT, TOTAL_COUNT], `${rel} states ${n} artifacts`).toContain(n);
    }
  });

  it("CONTRIBUTING.md's per-kind breakdown adds up to the whole", () => {
    const grab = (re: RegExp): number => {
      const m = CONTRIBUTING.match(re);
      expect(m, `breakdown phrase not found: ${re}`).not.toBeNull();
      return Number(m![1]);
    };
    const configs = grab(/\*\*(\d+) machine-readable configs\*\*/);
    const inConfigsDir = grab(/(\d+) in `docs\/configs\/`/);
    const partials = grab(/\*\*(\d+) Markdown partials\*\*/);

    expect(configs + partials + 1).toBe(TOTAL_COUNT);
    expect(inConfigsDir).toBe(
      OUTPUT_PATHS.filter((p) => p.startsWith("docs/configs/")).length,
    );
    expect(partials).toBe(
      OUTPUT_PATHS.filter((p) => p.startsWith("docs/snippets/")).length,
    );
  });
});

describe("the CI drift check watches every generated path", () => {
  // The `push` trigger in verify-configs.yml is path-filtered. A generated
  // artifact missing from that filter is not checked on a direct push to main —
  // which is how `manifest.json` sat outside it. (The `pull_request` trigger is
  // deliberately unfiltered, so PRs were always covered; this is the other half.)
  const workflow = read(".github/workflows/verify-configs.yml");

  it("every OUTPUTS path is inside the push filter, directly or by glob", () => {
    const uncovered = OUTPUT_PATHS.filter((p) => {
      if (workflow.includes(`- "${p}"`)) return false;
      const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      return !(dir && workflow.includes(`- "${dir}/**"`));
    });
    expect(uncovered, "generated paths not watched by verify-configs.yml").toEqual([]);
  });
});
