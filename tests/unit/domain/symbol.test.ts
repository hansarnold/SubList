import { describe, expect, it } from "vitest";

import {
  COMMON_ICON_KEYS,
  MAX_RESOURCE_EMOJI_UTF8_BYTES,
  ResourceSymbolValidationError,
  isCommonIconKey,
  isResourceSymbol,
  normalizeEmojiSymbolValue,
  normalizeResourceSymbol,
} from "../../../src/domain";

describe("resource symbols", () => {
  it("accepts every stable common icon key", () => {
    for (const key of COMMON_ICON_KEYS) {
      expect(isCommonIconKey(key)).toBe(true);
      expect(normalizeResourceSymbol({ type: "icon", value: key })).toEqual({
        type: "icon",
        value: key,
      });
    }
  });

  it.each(["👏", "✨", "❤️", "👨‍👩‍👧‍👦", "👍🏽", "🇨🇳", "1️⃣"])("accepts one emoji grapheme: %s", (emoji) => {
    expect(normalizeResourceSymbol({ type: "emoji", value: `  ${emoji}  ` })).toEqual({
      type: "emoji",
      value: emoji.normalize("NFC"),
    });
  });

  it("normalizes emoji values with trim and NFC", () => {
    const source = "  ❤️  ";
    expect(normalizeEmojiSymbolValue(source)).toBe(source.trim().normalize("NFC"));
  });

  it.each([
    { type: "icon", value: "IconDevice" },
    { type: "icon", value: " device " },
    { type: "emoji", value: "A" },
    { type: "emoji", value: "👏✨" },
    { type: "emoji", value: "<svg>" },
    { type: "emoji", value: "https://example.com/icon.png" },
    { type: "image", value: "https://example.com/icon.png" },
    { type: "icon", value: "device", extra: true },
    { type: "icon" },
    ["icon", "device"],
    undefined,
  ])("rejects malformed or unsafe symbol input", (value) => {
    expect(() => normalizeResourceSymbol(value)).toThrow(ResourceSymbolValidationError);
    expect(isResourceSymbol(value)).toBe(false);
  });

  it("enforces the defensive encoded-size bound", () => {
    const oversizedSingleGrapheme = `👏${"\uFE0F".repeat(MAX_RESOURCE_EMOJI_UTF8_BYTES)}`;
    expect([
      ...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(oversizedSingleGrapheme),
    ]).toHaveLength(1);
    expect(() => normalizeEmojiSymbolValue(oversizedSingleGrapheme)).toThrow(
      ResourceSymbolValidationError,
    );
  });

  it("accepts null as the explicit no-symbol value", () => {
    expect(normalizeResourceSymbol(null)).toBeNull();
    expect(isResourceSymbol(null)).toBe(true);
  });
});
