import type { CommonIconKey } from "../domain/symbol";
import type { PaymentMethodKind } from "./api-types";

type PresetIcon = {
  readonly type: "icon";
  readonly value: CommonIconKey;
};

type CategoryPresetDefinition = {
  readonly key: string;
  readonly labelKey: string;
  readonly color: string;
  readonly symbol: PresetIcon;
};

type PaymentMethodPresetDefinition = {
  readonly key: string;
  readonly labelKey: string;
  readonly kind: PaymentMethodKind;
  readonly symbol: PresetIcon;
};

export const CATEGORY_PRESETS = [
  categoryPreset("productivity", "briefcase", "#4F7CFF"),
  categoryPreset("entertainment", "movie", "#8B5CF6"),
  categoryPreset("software_services", "device", "#6366F1"),
  categoryPreset("ai_services", "sparkles", "#7C3AED"),
  categoryPreset("cloud_hosting", "cloud", "#0891B2"),
  categoryPreset("communication", "message", "#16A34A"),
  categoryPreset("education", "book", "#D97706"),
  categoryPreset("health_fitness", "heart", "#DC2626"),
  categoryPreset("finance", "chart", "#059669"),
  categoryPreset("utilities", "bolt", "#EA580C"),
  categoryPreset("news_media", "news", "#64748B"),
  categoryPreset("shopping", "shopping_bag", "#DB2777"),
  categoryPreset("other", "dots", "#6B7280"),
] as const satisfies readonly CategoryPresetDefinition[];

export type CategoryPreset = (typeof CATEGORY_PRESETS)[number];
export type CategoryPresetKey = CategoryPreset["key"];

export const RECOMMENDED_CATEGORY_PRESET_KEYS = [
  "productivity",
  "entertainment",
  "software_services",
  "cloud_hosting",
  "utilities",
  "other",
] as const satisfies readonly CategoryPresetKey[];

export const PAYMENT_METHOD_PRESETS = [
  paymentMethodPreset("card", "card", "credit_card"),
  paymentMethodPreset("visa", "card", "brand_visa"),
  paymentMethodPreset("mastercard", "card", "brand_mastercard"),
  paymentMethodPreset("unionpay", "card", "brand_unionpay"),
  paymentMethodPreset("alipay", "wallet", "brand_alipay"),
  paymentMethodPreset("wechat_pay", "wallet", "brand_wechat"),
  paymentMethodPreset("apple_pay", "wallet", "brand_apple"),
  paymentMethodPreset("google_pay", "wallet", "brand_google"),
  paymentMethodPreset("paypal", "wallet", "brand_paypal"),
  paymentMethodPreset("app_store", "store", "brand_apple"),
  paymentMethodPreset("google_play", "store", "brand_google_play"),
  paymentMethodPreset("bank_transfer", "bank", "bank"),
  paymentMethodPreset("manual_invoice", "other", "invoice"),
  paymentMethodPreset("other", "other", "dots"),
] as const satisfies readonly PaymentMethodPresetDefinition[];

export type PaymentMethodPreset = (typeof PAYMENT_METHOD_PRESETS)[number];
export type PaymentMethodPresetKey = PaymentMethodPreset["key"];

function categoryPreset<Key extends string, Icon extends CommonIconKey>(
  key: Key,
  icon: Icon,
  color: string,
): {
  readonly key: Key;
  readonly labelKey: `presets.categories.${Key}`;
  readonly color: string;
  readonly symbol: { readonly type: "icon"; readonly value: Icon };
} {
  return {
    key,
    labelKey: `presets.categories.${key}`,
    color,
    symbol: { type: "icon", value: icon },
  };
}

function paymentMethodPreset<
  Key extends string,
  Kind extends PaymentMethodKind,
  Icon extends CommonIconKey,
>(
  key: Key,
  kind: Kind,
  icon: Icon,
): {
  readonly key: Key;
  readonly labelKey: `presets.paymentMethods.${Key}`;
  readonly kind: Kind;
  readonly symbol: { readonly type: "icon"; readonly value: Icon };
} {
  return {
    key,
    labelKey: `presets.paymentMethods.${key}`,
    kind,
    symbol: { type: "icon", value: icon },
  };
}
