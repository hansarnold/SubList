import { describe, expect, it } from "vitest";

import { isCommonIconKey, normalizeResourceSymbol } from "../../../src/domain";
import {
  CATEGORY_PRESETS,
  PAYMENT_METHOD_PRESETS,
  RECOMMENDED_CATEGORY_PRESET_KEYS,
} from "../../../src/shared/presets";

describe("preset catalogs", () => {
  it("matches the approved category catalog", () => {
    expect(CATEGORY_PRESETS.map(({ key, symbol, color }) => [key, symbol.value, color])).toEqual([
      ["productivity", "briefcase", "#4F7CFF"],
      ["entertainment", "movie", "#8B5CF6"],
      ["software_services", "device", "#6366F1"],
      ["ai_services", "sparkles", "#7C3AED"],
      ["cloud_hosting", "cloud", "#0891B2"],
      ["communication", "message", "#16A34A"],
      ["education", "book", "#D97706"],
      ["health_fitness", "heart", "#DC2626"],
      ["finance", "chart", "#059669"],
      ["utilities", "bolt", "#EA580C"],
      ["news_media", "news", "#64748B"],
      ["shopping", "shopping_bag", "#DB2777"],
      ["other", "dots", "#6B7280"],
    ]);
    expect(RECOMMENDED_CATEGORY_PRESET_KEYS).toEqual([
      "productivity",
      "entertainment",
      "software_services",
      "cloud_hosting",
      "utilities",
      "other",
    ]);
  });

  it("matches the approved payment-method catalog", () => {
    expect(
      PAYMENT_METHOD_PRESETS.map(({ key, kind, symbol }) => [key, kind, symbol.value]),
    ).toEqual([
      ["card", "card", "credit_card"],
      ["visa", "card", "brand_visa"],
      ["mastercard", "card", "brand_mastercard"],
      ["unionpay", "card", "brand_unionpay"],
      ["alipay", "wallet", "brand_alipay"],
      ["wechat_pay", "wallet", "brand_wechat"],
      ["apple_pay", "wallet", "brand_apple"],
      ["google_pay", "wallet", "brand_google"],
      ["paypal", "wallet", "brand_paypal"],
      ["app_store", "store", "brand_apple"],
      ["google_play", "store", "brand_google_play"],
      ["bank_transfer", "bank", "bank"],
      ["manual_invoice", "other", "invoice"],
      ["other", "other", "dots"],
    ]);
  });

  it("keeps keys, localization keys, colors, and symbols internally consistent", () => {
    const categoryKeys = new Set(CATEGORY_PRESETS.map((preset) => preset.key));
    const paymentKeys = new Set(PAYMENT_METHOD_PRESETS.map((preset) => preset.key));

    expect(categoryKeys.size).toBe(CATEGORY_PRESETS.length);
    expect(paymentKeys.size).toBe(PAYMENT_METHOD_PRESETS.length);
    expect(new Set(RECOMMENDED_CATEGORY_PRESET_KEYS).size).toBe(
      RECOMMENDED_CATEGORY_PRESET_KEYS.length,
    );

    for (const preset of CATEGORY_PRESETS) {
      expect(preset.labelKey).toBe(`presets.categories.${preset.key}`);
      expect(preset.color).toMatch(/^#[0-9A-F]{6}$/);
      expect(isCommonIconKey(preset.symbol.value)).toBe(true);
      expect(normalizeResourceSymbol(preset.symbol)).toEqual(preset.symbol);
    }
    for (const key of RECOMMENDED_CATEGORY_PRESET_KEYS) {
      expect(categoryKeys.has(key)).toBe(true);
    }
    for (const preset of PAYMENT_METHOD_PRESETS) {
      expect(preset.labelKey).toBe(`presets.paymentMethods.${preset.key}`);
      expect(isCommonIconKey(preset.symbol.value)).toBe(true);
      expect(normalizeResourceSymbol(preset.symbol)).toEqual(preset.symbol);
    }
  });
});
