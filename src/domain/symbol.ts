const RESOURCE_SYMBOL_TYPES = ["icon", "emoji"] as const;

export const COMMON_ICON_KEYS = [
  "bank",
  "bolt",
  "book",
  "brand_alipay",
  "brand_apple",
  "brand_google",
  "brand_google_play",
  "brand_mastercard",
  "brand_paypal",
  "brand_unionpay",
  "brand_visa",
  "brand_wechat",
  "briefcase",
  "calendar",
  "chart",
  "cloud",
  "credit_card",
  "device",
  "dots",
  "food",
  "games",
  "heart",
  "home",
  "invoice",
  "message",
  "movie",
  "music",
  "news",
  "security",
  "shopping_bag",
  "sparkles",
  "store",
  "subscriptions",
  "transport",
  "travel",
  "wallet",
] as const;

export type CommonIconKey = (typeof COMMON_ICON_KEYS)[number];

export type ResourceSymbol =
  | { readonly type: "icon"; readonly value: CommonIconKey }
  | { readonly type: "emoji"; readonly value: string }
  | null;

export const MAX_RESOURCE_EMOJI_UTF8_BYTES = 64;

const COMMON_ICON_KEY_SET: ReadonlySet<string> = new Set(COMMON_ICON_KEYS);
const RESOURCE_SYMBOL_TYPE_SET: ReadonlySet<string> = new Set(RESOURCE_SYMBOL_TYPES);
const EMOJI_GRAPHEME_SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });
const EXTENDED_PICTOGRAPHIC_PATTERN = /\p{Extended_Pictographic}/u;
const FLAG_PATTERN = /^\p{Regional_Indicator}{2}$/u;
const KEYCAP_PATTERN = /^[#*0-9]\uFE0F?\u20E3$/u;

export class ResourceSymbolValidationError extends Error {
  readonly code = "INVALID_SYMBOL";
  readonly path = "symbol";

  constructor(message: string) {
    super(message);
    this.name = "ResourceSymbolValidationError";
  }
}

export function isCommonIconKey(value: string): value is CommonIconKey {
  return COMMON_ICON_KEY_SET.has(value);
}

export function normalizeEmojiSymbolValue(value: string): string {
  const normalized = value.trim().normalize("NFC");
  if (normalized.length === 0) {
    throw invalidSymbol("Emoji must not be empty.");
  }

  if (new TextEncoder().encode(normalized).byteLength > MAX_RESOURCE_EMOJI_UTF8_BYTES) {
    throw invalidSymbol(
      `Emoji must be at most ${MAX_RESOURCE_EMOJI_UTF8_BYTES} bytes after normalization.`,
    );
  }

  const graphemes = [...EMOJI_GRAPHEME_SEGMENTER.segment(normalized)];
  if (graphemes.length !== 1 || graphemes[0]?.segment !== normalized) {
    throw invalidSymbol("Emoji must contain exactly one extended grapheme cluster.");
  }

  if (!isEmojiGrapheme(normalized)) {
    throw invalidSymbol("Symbol value must be an emoji, not plain text.");
  }

  return normalized;
}

export function normalizeResourceSymbol(value: unknown): ResourceSymbol {
  if (value === null) return null;
  if (!isPlainObject(value)) {
    throw invalidSymbol("Symbol must be an icon, an emoji, or null.");
  }

  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "type" || keys[1] !== "value") {
    throw invalidSymbol("Symbol objects must contain only type and value.");
  }

  const type = value.type;
  const symbolValue = value.value;
  if (typeof type !== "string" || !RESOURCE_SYMBOL_TYPE_SET.has(type)) {
    throw invalidSymbol("Symbol type must be icon or emoji.");
  }
  if (typeof symbolValue !== "string") {
    throw invalidSymbol("Symbol value must be a string.");
  }

  if (type === "icon") {
    if (!isCommonIconKey(symbolValue)) {
      throw invalidSymbol("Icon is not in the common icon allow-list.");
    }
    return { type, value: symbolValue };
  }

  return { type: "emoji", value: normalizeEmojiSymbolValue(symbolValue) };
}

export function isResourceSymbol(value: unknown): value is ResourceSymbol {
  try {
    normalizeResourceSymbol(value);
    return true;
  } catch (error) {
    if (error instanceof ResourceSymbolValidationError) return false;
    throw error;
  }
}

function isEmojiGrapheme(value: string): boolean {
  return (
    EXTENDED_PICTOGRAPHIC_PATTERN.test(value) ||
    FLAG_PATTERN.test(value) ||
    KEYCAP_PATTERN.test(value)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function invalidSymbol(message: string): ResourceSymbolValidationError {
  return new ResourceSymbolValidationError(message);
}
