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

  it("npm and the registry tell the same story: outcomes and rooms", () => {
    for (const [label, text] of [
      ["source.json description", source.description],
      ["package.json description", pkg.description],
    ] as Array<[string, string]>) {
      expect(text, `${label} drops "learns from outcomes"`).toMatch(/learns from outcomes/i);
      expect(text, `${label} drops shared rooms`).toMatch(/\brooms\b/i);
    }
  });

  it("no surface says the local server needs a key to start", () => {
    for (const [label, text] of LISTING) {
      expect(text, `${label}: the server starts without a key (src/index.ts)`).not.toMatch(
        /refuses to start without|won't start without|requires a (?:free )?api key(?! from| at)/i,
      );
    }
  });
});
