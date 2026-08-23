import { describe, expect, it } from "vitest";

import { normalizeCategoryNameKey, normalizeEmailAddress } from "../../../src/domain";

describe("tenant uniqueness normalization", () => {
  it("normalizes category names with NFKC, lowercase, and collapsed whitespace", () => {
    expect(normalizeCategoryNameKey("  Development\t  Tools  ")).toBe("development tools");
    expect(normalizeCategoryNameKey("ＦＯＯ")).toBe("foo");
    expect(normalizeCategoryNameKey("A\u00a0B\nC")).toBe("a b c");
  });

  it("normalizes verified email identity keys", () => {
    expect(normalizeEmailAddress("  Arnold@Example.COM ")).toBe("arnold@example.com");
  });
});
