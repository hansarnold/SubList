import { z } from "zod";

const MAX_SAFE_MICROS = BigInt(Number.MAX_SAFE_INTEGER);

export function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function decimalToMicros(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return micros <= MAX_SAFE_MICROS ? micros : null;
}

export const uuidSchema = z.uuid();
export const isoDateSchema = z.string().refine(isRealIsoDate, "Use a real YYYY-MM-DD date.");
export const timestampSchema = z.iso.datetime({ offset: true });
export const timezoneSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(isValidTimeZone, "Use a valid IANA time zone.");
export const currencySchema = z.string().regex(/^[A-Z]{3}$/);
export const amountSchema = z
  .string()
  .refine(
    (value) => decimalToMicros(value) !== null,
    "Use a non-negative decimal with at most six fractional digits.",
  );
export const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const nullableUrlSchema = z
  .url()
  .max(2048)
  .refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    "Only HTTP(S) URLs are allowed.",
  )
  .nullable();

export const paymentMethodKindSchema = z.enum(["card", "wallet", "bank", "store", "other"]);
export const paymentDisplayLabelSchema = z
  .string()
  .max(80)
  .refine(
    (value) => (value.match(/\p{Decimal_Number}/gu) ?? []).length <= 4,
    "Use a masked display label containing at most four digits.",
  );
export const recurrenceUnitSchema = z.enum(["day", "week", "month", "year"]);
export const anchorModeSchema = z.enum(["calendar_day", "end_of_month"]);
export const statusSchema = z.enum(["active", "cancelled"]);

export const recurrenceSchema = z
  .strictObject({
    unit: recurrenceUnitSchema,
    count: z.number().int().min(1).max(1200),
    anchorOn: isoDateSchema,
    anchorMode: anchorModeSchema,
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

export const updateUserSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(120).nullable().optional(),
    timezone: timezoneSchema.optional(),
    defaultCurrency: currencySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const createCategorySchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  color: colorSchema,
  position: z.number().int().min(0).default(0),
});

export const updateCategorySchema = createCategorySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const createPaymentMethodSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  kind: paymentMethodKindSchema.default("other"),
  label: paymentDisplayLabelSchema.nullable().default(null),
  position: z.number().int().min(0).default(0),
});

export const updatePaymentMethodSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    kind: paymentMethodKindSchema.optional(),
    label: paymentDisplayLabelSchema.nullable().optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const createSubscriptionSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  amount: amountSchema,
  currency: currencySchema,
  recurrence: recurrenceSchema,
  categoryId: uuidSchema.nullable().default(null),
  paymentMethodId: uuidSchema.nullable().default(null),
  websiteUrl: nullableUrlSchema.default(null),
  notes: z.string().max(10_000).nullable().default(null),
});

export const updateSubscriptionSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    amount: amountSchema.optional(),
    currency: currencySchema.optional(),
    recurrence: recurrenceSchema.optional(),
    categoryId: uuidSchema.nullable().optional(),
    paymentMethodId: uuidSchema.nullable().optional(),
    websiteUrl: nullableUrlSchema.optional(),
    notes: z.string().max(10_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const categoryArchiveSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(80),
  color: colorSchema,
  position: z.number().int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const paymentMethodArchiveSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(80),
  kind: paymentMethodKindSchema,
  label: paymentDisplayLabelSchema.nullable(),
  position: z.number().int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const subscriptionArchiveSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  amount: amountSchema,
  currency: currencySchema,
  recurrence: recurrenceSchema,
  status: statusSchema,
  cancelledAt: timestampSchema.nullable(),
  archivedAt: timestampSchema.nullable(),
  categoryId: uuidSchema.nullable(),
  paymentMethodId: uuidSchema.nullable(),
  websiteUrl: nullableUrlSchema,
  notes: z.string().max(10_000).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const archiveV1Schema = z
  .object({
    format: z.literal("opensublists"),
    schemaVersion: z.literal(1),
    archiveId: uuidSchema,
    exportedAt: timestampSchema,
    generator: z.strictObject({
      name: z.literal("OpenSubLists"),
      version: z.string().min(1).max(64),
    }),
    profile: z.strictObject({
      displayName: z.string().max(120).nullable(),
      timezone: timezoneSchema,
      defaultCurrency: currencySchema,
    }),
    categories: z.array(categoryArchiveSchema).max(100),
    paymentMethods: z.array(paymentMethodArchiveSchema).max(100),
    subscriptions: z.array(subscriptionArchiveSchema).max(50),
  })
  .passthrough();

export const importPreviewRequestSchema = z.strictObject({ archive: archiveV1Schema });

export const importRequestSchema = z.strictObject({
  archive: archiveV1Schema,
  expectedDigest: z.string().regex(/^sha256-[a-f0-9]{64}$/),
  conflictStrategy: z.enum(["skip", "overwrite", "duplicate"]),
  importProfile: z.boolean(),
  confirmed: z.literal(true),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
export type ImportRequest = z.infer<typeof importRequestSchema>;
