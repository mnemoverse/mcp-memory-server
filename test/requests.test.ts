/**
 * The WIRE CONTRACT of 0.8.1: byte-identical to 0.8.0 for every input.
 *
 * This exists because the previous guard was a regex over src/index.ts
 * asserting the ABSENCE of a `trim()`. It could not catch a DELETED coercion,
 * and that is precisely what shipped — the read path lost `|| undefined`, so
 * `domain: ""` became `WHERE domain = ''` (a store that cannot exist) while all
 * 60 tests stayed green (reviews, 2026-08-08).
 *
 * The expected bodies below are transcribed from 0.8.0's handlers. If a change
 * makes one of these fail, that change moves data and belongs in a MINOR
 * release — do not update the expectation to match new behaviour without
 * bumping the version. That is the whole point of the file.
 */

import { describe, it, expect } from "vitest";
import {
  readRequestBody,
  recentRequestBody,
  writeRequestBody,
  searchedScope,
} from "../src/requests.js";

/** Every domain shape that has been a real finding on this branch. */
const DOMAINS: Array<[label: string, value: string | undefined]> = [
  ["absent", undefined],
  ["empty string", ""],
  ["spaces only", "   "],
  ["leading space", " engineering"],
  ["trailing newline", "engineering\n"],
  ["non-breaking space", " engineering"],
  ["zero-width space", "​engineering"],
  ["padded room address", " xroom:room_01ABC"],
  ["uppercase room address", "XROOM:room_01ABC"],
  ["canonical room address", "xroom:room_01ABC"],
  ["the string zero", "0"],
  ["a bare colon", ":"],
  ["ordinary", "engineering"],
];

describe("searchedScope — the only normalisation allowed", () => {
  it("maps absent and empty to undefined, and passes everything else through", () => {
    // core filters on `domain is not None`, so "" must NOT reach it: it would
    // become a real filter for a store that cannot exist.
    expect(searchedScope(undefined)).toBeUndefined();
    expect(searchedScope("")).toBeUndefined();
    for (const [, value] of DOMAINS) {
      if (value === undefined || value === "") continue;
      expect(searchedScope(value)).toBe(value);
    }
  });

  it("does not trim, case-fold, or strip invisible characters", () => {
    expect(searchedScope("   ")).toBe("   ");
    expect(searchedScope(" engineering")).toBe(" engineering");
    expect(searchedScope("​engineering")).toBe("​engineering");
    // The security-relevant one: core 400s a non-canonical room address on
    // purpose. Normalising it here would route a write into a shared room.
    expect(searchedScope(" xroom:room_01ABC")).toBe(" xroom:room_01ABC");
  });
});

describe("readRequestBody matches 0.8.0 for every domain shape", () => {
  for (const [label, value] of DOMAINS) {
    it(`domain: ${label}`, () => {
      const body = readRequestBody({ query: "q", domain: value });
      expect(body).toEqual({
        query: "q",
        top_k: 5,
        domain: value || undefined,
        include_associations: true,
      });
    });
  }

  it("omits the temporal keys entirely when unused", () => {
    expect(Object.keys(readRequestBody({ query: "q" })).sort()).toEqual([
      "domain",
      "include_associations",
      "query",
      "top_k",
    ]);
  });

  it("includes each temporal key only when passed", () => {
    const body = readRequestBody({
      query: "q",
      order_by: "recency",
      since: "2026-08-01",
      until: "2026-08-02",
      exclude_author: "someone",
    });
    expect(body).toMatchObject({
      order_by: "recency",
      since: "2026-08-01",
      until: "2026-08-02",
      exclude_author: "someone",
    });
  });

  it("defaults top_k to 5 and never clamps a caller's value", () => {
    expect(readRequestBody({ query: "q", top_k: 50 }).top_k).toBe(50);
    expect(readRequestBody({ query: "q", top_k: 1 }).top_k).toBe(1);
  });
});

describe("recentRequestBody matches 0.8.0 for every domain shape", () => {
  for (const [label, value] of DOMAINS) {
    it(`domain: ${label}`, () => {
      expect(recentRequestBody({ domain: value })).toEqual({
        domain: value || undefined,
        since: undefined,
        until: undefined,
        exclude_author: undefined,
        limit: 20,
        cursor: undefined,
      });
    });
  }

  it("defaults limit to 20", () => {
    expect(recentRequestBody({}).limit).toBe(20);
    expect(recentRequestBody({ limit: 100 }).limit).toBe(100);
  });
});

describe("writeRequestBody matches 0.8.0 for every domain shape", () => {
  for (const [label, value] of DOMAINS) {
    it(`domain: ${label}`, () => {
      // "general" is 0.8.0's explicit default for a missing domain — NOT a
      // normalisation. A padded name is written as given, because trimming it
      // would relocate the caller's data on an automatic ^0.8 upgrade.
      expect(writeRequestBody({ content: "c", domain: value })).toEqual({
        content: "c",
        concepts: [],
        domain: value || "general",
      });
    });
  }

  it("passes a padded room address through unchanged, so core can refuse it", () => {
    // 0.8.0 sent this verbatim and core answered 400. Trimming it made the
    // write land in the room's store, visible to every member.
    expect(writeRequestBody({ content: "c", domain: " xroom:room_01ABC" }).domain).toBe(
      " xroom:room_01ABC",
    );
  });

  it("defaults concepts to an empty array", () => {
    expect(writeRequestBody({ content: "c" }).concepts).toEqual([]);
    expect(writeRequestBody({ content: "c", concepts: ["a"] }).concepts).toEqual(["a"]);
  });
});
