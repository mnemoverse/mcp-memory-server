/**
 * The release wave: the consumer registry, the probes and the tracker issue
 * text (scripts/lib/wave.mjs, scripts/consumers.json).
 *
 * Why these are worth tests: the wave issue is what a person reads to know
 * whether every consumer of the MCP surface moved after a release, and the
 * daily check rewrites it. A registry row with a bad probe, a marker the
 * re-tick cannot find, or a "green" that ignores a consumer would all leave
 * the issue looking finished while a surface stayed behind, which is the
 * exact failure the wave exists to make visible.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allProbedGreen,
  allTicked,
  applyResults,
  getPath,
  isStale,
  loadConsumers,
  probeVersion,
  readableVersion,
  renderWaveBody,
  waveTitle,
  type Consumer,
  waveVersion,
  atLeast,
  resultsForWave,
} from "../scripts/lib/wave.mjs";

const registry = JSON.parse(readFileSync(new URL("../scripts/consumers.json", import.meta.url), "utf8"));

const FIXTURE: Consumer[] = [
  { id: "docs", name: "docs", kind: "track", repo: "o/docs", fix: "merge bot/mcp-version-<version>", probe: { type: "text-regex", url: "https://x/llms-full.txt", regex: "Current release: \\*\\*v([^*]+)\\*\\*" } },
  { id: "card", name: "card", kind: "track", repo: "o/m", fix: "stamp", probe: { type: "json-field", url: "https://x/card.json", field: "serverInfo.version" } },
  { id: "forms", name: "forms", kind: "manual", repo: "o/d", fix: "resubmit" },
];

describe("the consumer registry (scripts/consumers.json)", () => {
  it("loads, every probed entry has an https probe of a known type, every manual entry has none", () => {
    const list = loadConsumers(registry);
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const c of list) {
      if (c.kind === "manual") expect(c.probe).toBeUndefined();
      else expect(c.probe?.url).toMatch(/^https:\/\//);
    }
    expect(list.map((c) => c.id)).toContain("docs");
    expect(list.map((c) => c.id)).toContain("connector");
  });

  it("refuses a duplicate id, an unknown kind, a manual entry with a probe, and a probe without a field", () => {
    expect(() => loadConsumers({ consumers: [FIXTURE[0], FIXTURE[0]] })).toThrow(/duplicate id/);
    expect(() => loadConsumers({ consumers: [{ ...FIXTURE[0], kind: "auto-ish" }] })).toThrow(/unknown kind/);
    expect(() => loadConsumers({ consumers: [{ ...FIXTURE[2], probe: FIXTURE[1].probe }] })).toThrow(/must not carry a probe/);
    expect(() => loadConsumers({ consumers: [{ ...FIXTURE[1], probe: { type: "json-field", url: "https://x" } }] })).toThrow(/needs field/);
    expect(() => loadConsumers({ consumers: [{ ...FIXTURE[1], probe: { type: "json-field", url: "http://x", field: "a" } }] })).toThrow(/https/);
  });
});

describe("probes", () => {
  const io = {
    getJson: async (url: string) => (url.endsWith("card.json") ? { serverInfo: { version: "0.12.1" } } : { package: {} }),
    getText: async () => "…\nCurrent release: **v0.12.1**\n…",
  };

  it("json-field reads a dotted path; text-regex reads the first capture; both insist on X.Y.Z", async () => {
    expect((await probeVersion(FIXTURE[1], io)).version).toBe("0.12.1");
    expect((await probeVersion(FIXTURE[0], io)).version).toBe("0.12.1");
    await expect(probeVersion({ ...FIXTURE[1], probe: { type: "json-field", url: "https://x/health", field: "package.version" } }, io)).rejects.toThrow(/missing/);
    await expect(probeVersion(FIXTURE[0], { ...io, getText: async () => "Current release: **v{{version}}**" })).rejects.toThrow(/no readable version/);
    expect(() => readableVersion("v0.13.0", "x")).not.toThrow();
    expect(getPath({ a: { b: 1 } }, "a.b")).toBe(1);
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
  });

  it("a manual consumer has no probe to run", async () => {
    await expect(probeVersion(FIXTURE[2], io)).rejects.toThrow(/manual/);
  });
});

describe("the wave issue text", () => {
  it("renders one line per consumer, probed lines carry the probe, manual lines say so, every line carries its marker and status span", () => {
    const body = renderWaveBody({ version: "v0.13.0", consumers: FIXTURE, runUrl: "https://run" });
    expect(body).toContain("Release **v0.13.0**");
    for (const c of FIXTURE) {
      expect(body).toContain(`<!-- wave:${c.id} -->`);
      expect(body).toContain(`<!-- status:${c.id} -->not checked yet<!-- /status:${c.id} -->`);
    }
    expect(body).toContain("probe: https://x/card.json → serverInfo.version");
    expect(body).toContain("no live probe: tick this line by hand");
    expect(body).toContain("merge bot/mcp-version-0.13.0"); // <version> substituted
    expect((body.match(/^- \[ \] /gm) ?? []).length).toBe(3);
    expect(waveTitle("0.13.0")).toBe("Wave v0.13.0");
  });

  it("applyResults ticks only the probed lines that are ok, rewrites only the status span, and leaves manual lines and a person's note alone", () => {
    const body = renderWaveBody({ version: "0.13.0", consumers: FIXTURE }) + "\nA note a person added.\n";
    const ticked = applyResults(body, FIXTURE, {
      docs: { status: "ok", version: "0.13.0" },
      card: { status: "lag", version: "0.12.1" },
    });
    expect(ticked).toMatch(/^- \[x\] <!-- wave:docs -->/m);
    expect(ticked).toMatch(/^- \[ \] <!-- wave:card -->/m);
    expect(ticked).toMatch(/^- \[ \] <!-- wave:forms -->/m);
    expect(ticked).toContain("<!-- status:docs -->serves v0.13.0<!-- /status:docs -->");
    expect(ticked).toContain("<!-- status:card -->still v0.12.1<!-- /status:card -->");
    expect(ticked).toContain("A note a person added.");
    expect(allProbedGreen(FIXTURE, { docs: { status: "ok" }, card: { status: "lag" } })).toBe(false);
    expect(allProbedGreen(FIXTURE, { docs: { status: "ok" }, card: { status: "ok" } })).toBe(true);
    expect(allTicked(ticked, FIXTURE)).toBe(false);
    // Once every probed line is green and a person ticked the manual line, the wave is done.
    const green = applyResults(ticked, FIXTURE, { docs: { status: "ok", version: "0.13.0" }, card: { status: "ok", version: "0.13.0" } });
    const manualTicked = green.replace("- [ ] <!-- wave:forms -->", "- [x] <!-- wave:forms -->");
    expect(allTicked(manualTicked, FIXTURE)).toBe(true);
    // An unchecked probe never ticks a line.
    const unchecked = applyResults(green, FIXTURE, { docs: { status: "unchecked", error: "HTTP 502" } });
    expect(unchecked).toMatch(/^- \[ \] <!-- wave:docs -->/m);
    expect(unchecked).toContain("could not be checked: HTTP 502");
  });

  it("a wave is stale after three days, not before", () => {
    const created = "2026-09-25T18:00:00Z";
    const day = 24 * 3600 * 1000;
    expect(isStale(created, Date.parse(created) + 2 * day)).toBe(false);
    expect(isStale(created, Date.parse(created) + 4 * day)).toBe(true);
    expect(isStale("garbage", 0)).toBe(false);
  });
});

describe("every open wave is maintained, not only the current version's (Copilot on #178)", () => {
  it("reads the version from an exact 'Wave vX.Y.Z' title only", () => {
    expect(waveVersion("Wave v0.13.0")).toBe("0.13.0");
    expect(waveVersion("Wave v0.13.0-rc.1")).toBe("0.13.0-rc.1");
    expect(waveVersion("Wave v0.13")).toBeNull();
    expect(waveVersion("Re: Wave v0.13.0")).toBeNull();
  });

  it("compares versions numerically, a pre-release below its release", () => {
    expect(atLeast("0.13.0", "0.12.1")).toBe(true);
    expect(atLeast("0.12.10", "0.12.9")).toBe(true);
    expect(atLeast("0.12.1", "0.13.0")).toBe(false);
    expect(atLeast("0.13.0-rc.1", "0.13.0")).toBe(false);
    expect(atLeast("0.13.0", "0.13.0-rc.1")).toBe(true);
    expect(atLeast("v0.12.1", "0.12.1")).toBe(true);
    // semver pre-release order and build metadata (Copilot on #178)
    expect(atLeast("0.13.0-rc.10", "0.13.0-rc.2")).toBe(true);
    expect(atLeast("0.13.0-rc.2", "0.13.0-rc.10")).toBe(false);
    expect(atLeast("0.13.0-rc.1", "0.13.0-rc")).toBe(true);
    expect(atLeast("0.13.0-alpha", "0.13.0-1")).toBe(true);
    expect(atLeast("0.13.0+build.2", "0.13.0")).toBe(true);
    expect(atLeast("0.13.0", "0.13.0+build.2")).toBe(true);
  });

  it("a consumer serving a later version completes an older wave; an older one lags; unchecked stays unchecked", () => {
    const probed = {
      docs: { status: "ok" as const, version: "0.13.0" },
      card: { status: "lag" as const, version: "0.12.0" },
      connector: { status: "unchecked" as const, error: "HTTP 502" },
    };
    const forOld = resultsForWave(probed, "0.12.1");
    expect(forOld.docs.status).toBe("ok");
    expect(forOld.card.status).toBe("lag");
    expect(forOld.connector.status).toBe("unchecked");
    // Lagging behind the current release (0.14.0) but past an older wave's
    // version: done for that older wave. This is the case the recompute exists for.
    const behindCurrent = resultsForWave({ docs: { status: "lag" as const, version: "0.13.0" } }, "0.12.1");
    expect(behindCurrent.docs.status).toBe("ok");
    const forNew = resultsForWave(probed, "0.13.0");
    expect(forNew.docs.status).toBe("ok");
    expect(forNew.card.status).toBe("lag");
  });
});
