/**
 * The listing text directories copy from this repository.
 *
 * source.json `description` becomes the MCP registry line (and from there
 * Glama's connector card and PulseMCP), package.json `description` is the npm
 * line, `mcpb.longDescription` is the desktop-extension listing, and the README
 * is the npm page and the GitHub landing. A registry version is immutable once
 * published, so a false sentence here outlives the fix by every version it
 * shipped in: the "one key … ChatGPT" line below sat in sixteen of them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const source = JSON.parse(read("src/configs/source.json"));
const pkg = JSON.parse(read("package.json"));
const serverJson = JSON.parse(read("server.json"));

const LISTING: Array<[string, string]> = [
  ["source.json description (registry line)", source.description],
  ["package.json description (npm line)", pkg.description],
  ["mcpb.longDescription (desktop extension)", source.mcpb.longDescription],
  ["README.md", read("README.md")],
];

const sentences = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " "))
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z"'(\[*`])/));

describe("listing text directories copy", () => {
  // mnemoverse-docs data/facts.json access.chatgptRule (approved 2026-07-15):
  // ChatGPT's MCP path is OAuth-only and its API-key path is a Custom GPT
  // action, so a bare "one key" claim that names ChatGPT is false. "One key or
  // OAuth across …, and ChatGPT" is the approved form.
  const KEY_CHATGPT = /\b(?:one|single|same)(?: api)? key\b.{0,160}\bchatgpt\b|\bchatgpt\b.{0,100}\b(?:one|single|same)(?: api)? key\b/i;
  const ALLOWED = /\bkey or oauth\b|\boauth or (?:an? )?(?:api )?key\b|custom gpt|gpt actions?|chatgpt[^.;]{0,40}\b(?:oauth|sign-in|sign in)/i;

  it("no surface pairs a bare key claim with ChatGPT", () => {
    for (const [label, text] of LISTING) {
      for (const s of sentences(text)) {
        if (KEY_CHATGPT.test(s) && !ALLOWED.test(s)) {
          expect.fail(`${label}: "${s.slice(0, 200)}" breaks facts.json access.chatgptRule`);
        }
      }
    }
  });

  it("the registry line fits the registry's 100-character description limit", () => {
    expect(source.description.length).toBeLessThanOrEqual(100);
    expect(serverJson.description).toBe(source.description);
  });

  it("the registry line still names outcomes and rooms", () => {
    // The registry line changes only with the owner's yes (packaging lane,
    // agent-eye 2026-10-14, section 3.6); until then it keeps both.
    expect(source.description, `registry line drops "learns from outcomes"`).toMatch(/learns from outcomes/i);
    expect(source.description, "registry line drops shared rooms").toMatch(/\brooms\b/i);
  });

  it("the npm line says what feedback does in the canonical words, and nothing more", () => {
    // Packaging lane, P-19 (agent-eye 2026-10-14, section 3.1) and the
    // feedback-wording rule (text-policy.json, 2026-10-15): the effect of a
    // rating is described only as "re-ranks what comes back next". The npm
    // line is what npm search shows, so it says write and read, the sign-in
    // and the free plan instead of a paraphrase of the ranking.
    expect(pkg.description).toMatch(/re-ranks what comes back next/i);
    expect(pkg.description).not.toMatch(/learns from outcomes|feedback re-ranks recall/i);
    expect(pkg.description).toMatch(/\boauth\b/i);
    expect(pkg.description).toMatch(/\bfree plan\b/i);
    expect(pkg.description, "npm line carries a dash").not.toMatch(/[–—]/);
  });

  it("no listing surface names the ranking mechanics", () => {
    // P-37: the ranking mechanics stay out of public prose. Field names an
    // API returns (avg_valence, hebbian_edges, co-activation count) are
    // contract and are written in code spans, which this check skips.
    // The newest CHANGELOG section with entries is checked too: release.yml
    // extracts the "## [$VERSION]" section with awk and publishes it as the
    // GitHub release body (body_path), so a name kept out of the README would
    // otherwise reach the release page. Between releases that text sits under
    // [Unreleased]; on a release commit it moves to the dated section.
    // Older sections are already published and stay as they were.
    const MECHANICS = /\bhebbian\b|rescorla|prediction[- ]error|\bhdbscan\b|von restorff/i;
    const changelog = read("CHANGELOG.md");
    // Release commits keep an empty "## [Unreleased]" above "## [x.y.z]"
    // (0.15.1, f8d5a3f), so check the newest section that has a body.
    const newest =
      changelog
        .split(/^## \[/m)
        .slice(1)
        .find((sec) => sec.replace(/^[^\n]*\n/, "").trim() !== "") ?? "";
    expect(newest, "CHANGELOG.md has no section with entries").not.toBe("");
    const surfaces: Array<[string, string]> = [
      ...LISTING,
      ["CHANGELOG.md newest section (GitHub release body)", newest],
    ];
    for (const [label, text] of surfaces) {
      const prose = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
      for (const s of sentences(prose)) {
        if (MECHANICS.test(s)) {
          expect.fail(`${label}: "${s.slice(0, 200)}" names a ranking mechanism`);
        }
      }
    }
  });

  it("no surface says the local server needs a key to start", () => {
    // The server starts and lists its tools without a key (src/index.ts); a
    // key is needed for tool calls. So "requires … API key" is only true in a
    // sentence that ties it to calls. The old mcpb line, "Requires a free API
    // key from https://console…", said it bare and read as a start requirement.
    const START = /refuses to start without|won't start without|\brequires? an? (?:free )?(?:mnemoverse )?api key\b/i;
    const CALLS = /\btool calls?\b|\bevery (?:actual )?(?:tool )?call\b|\bto call\b/i;
    for (const [label, text] of LISTING) {
      for (const s of sentences(text)) {
        if (START.test(s) && !CALLS.test(s)) {
          expect.fail(`${label}: "${s.slice(0, 200)}" reads as a key needed to start`);
        }
      }
    }
  });
});
