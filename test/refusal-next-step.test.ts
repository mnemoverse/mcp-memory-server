/**
 * The refusals on the way to a first call or an upgrade say what to do next.
 *
 * Three refusals sit exactly where a user either never starts or is about to
 * pay: no key configured, the docs' example key, and a 429 that waiting
 * cannot clear. Each one now names the next step, and each console link it
 * prints carries `reason` and `surface`, so a visit from a refusal can be
 * told apart from any other.
 */

import { describe, expect, it } from "vitest";
import { HOSTED_MCP_URL, KEYS_URL, labelledConsoleUrl } from "../src/errors.js";
import { refusePlaceholderKey } from "../src/requests.js";

describe("labelledConsoleUrl", () => {
  it("adds reason and surface to a console link", () => {
    expect(labelledConsoleUrl(KEYS_URL, "missing_key", "npm")).toBe(
      "https://console.mnemoverse.com/dashboard/keys?reason=missing_key&surface=npm",
    );
  });

  it("replaces labels the link already had instead of repeating them", () => {
    const once = labelledConsoleUrl(KEYS_URL, "missing_key", "npm");
    expect(labelledConsoleUrl(once, "quota", "remote")).toBe(
      "https://console.mnemoverse.com/dashboard/keys?reason=quota&surface=remote",
    );
  });

  it("returns a link that does not parse unchanged rather than throwing", () => {
    expect(labelledConsoleUrl("not a url", "quota", "npm")).toBe("not a url");
  });
});

describe("the example-key refusal", () => {
  it("labels its console link and names the keyless hosted connector", () => {
    const refusal = refusePlaceholderKey("mk_live_YOUR_KEY");
    expect(refusal).toBeDefined();
    expect(refusal!.toolCall).toContain(
      "https://console.mnemoverse.com/dashboard/keys?reason=placeholder_key&surface=npm",
    );
    expect(refusal!.toolCall).toContain(HOSTED_MCP_URL);
    expect(refusal!.toolCall).toContain("needs no key at all");
  });
});
