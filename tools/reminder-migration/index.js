import { constants as fileConstants } from "node:fs";
import { access, chmod, open, readFile, rename, unlink } from "node:fs/promises";
import { z } from "zod";

const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_SAFE_MICROS = BigInt(Number.MAX_SAFE_INTEGER);
const COMMON_ICON_KEYS = [
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
];
const uuidSchema = z.uuid();
const timestampSchema = z.iso.datetime({ offset: true });
const isoDateSchema = z.string().refine(isRealIsoDate, "Use a real YYYY-MM-DD date.");
const timezoneSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(isValidTimeZone, "Use a valid IANA time zone.");
const amountSchema = z
  .string()
  .refine(
    (value) => decimalToMicros(value) !== null,
    "Use a non-negative decimal with at most six fractional digits and a safe micro-unit value.",
  );
const nullableUrlSchema = z
  .url()
  .max(2048)
  .refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    "Only HTTP(S) URLs are allowed.",
  )
  .nullable();
const paymentLabelSchema = z
  .string()
  .max(80)
  .refine(
    (value) => (value.match(/\p{Decimal_Number}/gu) ?? []).length <= 4,
    "Use a masked display label containing at most four digits.",
  );
const emojiSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const extendedPictographicPattern = /\p{Extended_Pictographic}/u;
const flagPattern = /^\p{Regional_Indicator}{2}$/u;
const keycapPattern = /^[#*0-9]\uFE0F?\u20E3$/u;
const symbolSchema = z.union([
  z.null(),
  z.strictObject({ type: z.literal("icon"), value: z.enum(COMMON_ICON_KEYS) }),
  z.strictObject({
    type: z.literal("emoji"),
    value: z.string().transform((value, context) => {
      const normalized = normalizeEmoji(value);
      if (normalized === null) {
        context.addIssue({
          code: "custom",
          message: "Use exactly one emoji grapheme of at most 64 UTF-8 bytes.",
        });
        return z.NEVER;
      }
      return normalized;
    }),
  }),
]);
const recurrenceSchema = z
  .strictObject({
    unit: z.enum(["day", "week", "month", "year"]),
    count: z.number().int().min(1).max(1_200),
    anchorOn: isoDateSchema,
    anchorMode: z.enum(["calendar_day", "end_of_month"]),
  })
  .superRefine((value, context) => {
    if (value.anchorMode === "end_of_month" && value.unit !== "month") {
      context.addIssue({
        code: "custom",
        path: ["anchorMode"],
        message: "End-of-month mode is available only for monthly recurrence.",
      });
    }
  });
const categorySchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  symbol: symbolSchema,
  position: z.number().int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
const paymentMethodSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["card", "wallet", "bank", "store", "other"]),
  label: paymentLabelSchema.nullable(),
  symbol: symbolSchema,
  position: z.number().int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
const subscriptionSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  symbol: symbolSchema,
  amount: amountSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  recurrence: recurrenceSchema,
  status: z.enum(["active", "cancelled"]),
  cancelledAt: timestampSchema.nullable(),
  archivedAt: timestampSchema.nullable(),
  categoryId: uuidSchema.nullable(),
  paymentMethodId: uuidSchema.nullable(),
  websiteUrl: nullableUrlSchema,
  notes: z.string().max(10_000).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
const archiveV2Schema = z.strictObject({
  format: z.literal("opensublists"),
  schemaVersion: z.literal(2),
  archiveId: uuidSchema,
  exportedAt: timestampSchema,
  generator: z.strictObject({
    name: z.literal("OpenSubLists"),
    version: z.string().min(1).max(64),
  }),
  profile: z.strictObject({
    displayName: z.string().max(120).nullable(),
    timezone: timezoneSchema,
    reportingCurrency: z.string().regex(/^[A-Z]{3}$/),
  }),
  categories: z.array(categorySchema).max(100),
  paymentMethods: z.array(paymentMethodSchema).max(100),
  subscriptions: z.array(subscriptionSchema).max(50),
});
const subscriptionV3Schema = subscriptionSchema.extend({
  emailReminderEnabled: z.boolean(),
  emailReminderDaysBefore: z.number().int().min(0).max(365).nullable(),
});
const archiveV3Schema = archiveV2Schema.extend({
  schemaVersion: z.literal(3),
  profile: archiveV2Schema.shape.profile.extend({
    preferredLocale: z.enum(["en", "zh-Hans"]),
    defaultEmailReminderDaysBefore: z.number().int().min(0).max(365),
    emailReminderLocalTime: z.string().regex(/^([01]\d|2[0-3]):00$/),
    emailRemindersPaused: z.boolean(),
  }),
  subscriptions: z.array(subscriptionV3Schema).max(50),
});

export class ReminderMigrationError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = "ReminderMigrationError";
    this.code = code;
    this.issues = issues;
  }
}

export function transformArchiveV2(sourceText) {
  assertByteLimit(sourceText);
  let source;
  try {
    source = JSON.parse(sourceText);
  } catch {
    throw new ReminderMigrationError("INVALID_JSON", "The source archive is not valid JSON.");
  }
  const parsed = archiveV2Schema.safeParse(source);
  if (!parsed.success) {
    throw new ReminderMigrationError(
      "INVALID_ARCHIVE_V2",
      "The source is not a strict OpenSubLists archive version 2.",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }

  const archive = parsed.data;
  const transformed = {
    ...archive,
    schemaVersion: 3,
    profile: {
      ...archive.profile,
      preferredLocale: "en",
      defaultEmailReminderDaysBefore: 7,
      emailReminderLocalTime: "09:00",
      emailRemindersPaused: false,
    },
    subscriptions: archive.subscriptions.map((subscription) => ({
      ...subscription,
      emailReminderEnabled: false,
      emailReminderDaysBefore: null,
    })),
  };
  const validated = archiveV3Schema.safeParse(transformed);
  if (!validated.success) {
    throw new ReminderMigrationError(
      "INVALID_ARCHIVE_V3_RESULT",
      "The transformed archive did not satisfy the current reminder archive contract.",
      validated.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return validated.data;
}

export async function migrateReminderArchiveFile({ inputPath, outputPath, overwrite = false }) {
  const source = await readFile(inputPath);
  if (source.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ReminderMigrationError("INPUT_TOO_LARGE", "The source archive exceeds 5 MiB.");
  }
  if (!overwrite) {
    try {
      await access(outputPath, fileConstants.F_OK);
      throw new ReminderMigrationError("OUTPUT_EXISTS", "Refusing to overwrite the output file.");
    } catch (error) {
      if (error instanceof ReminderMigrationError) throw error;
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
  }
  const transformed = transformArchiveV2(source.toString("utf8"));
  const serialized = `${JSON.stringify(transformed, null, 2)}\n`;
  if (overwrite) {
    const temporaryPath = `${outputPath}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(serialized, "utf8");
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, outputPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  } else {
    const handle = await open(outputPath, "wx", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
    } finally {
      await handle.close();
    }
  }
  await chmod(outputPath, 0o600);
  return transformed;
}

function assertByteLimit(value) {
  if (Buffer.byteLength(value, "utf8") > MAX_ARCHIVE_BYTES) {
    throw new ReminderMigrationError("INPUT_TOO_LARGE", "The source archive exceeds 5 MiB.");
  }
}

function decimalToMicros(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return micros <= MAX_SAFE_MICROS ? micros : null;
}

function isRealIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizeEmoji(value) {
  const normalized = value.trim().normalize("NFC");
  if (normalized.length === 0 || Buffer.byteLength(normalized, "utf8") > 64) return null;
  const graphemes = [...emojiSegmenter.segment(normalized)];
  if (graphemes.length !== 1 || graphemes[0]?.segment !== normalized) return null;
  if (
    !extendedPictographicPattern.test(normalized) &&
    !flagPattern.test(normalized) &&
    !keycapPattern.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function isNodeError(value) {
  return value instanceof Error && "code" in value;
}
