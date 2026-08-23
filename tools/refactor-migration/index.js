import { createHash } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import { access, chmod, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { z } from "zod";
import supportedCurrencies from "../../src/shared/supported-currencies.json" with { type: "json" };
const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_SAFE_MICROS = BigInt(Number.MAX_SAFE_INTEGER);
const MICROS_PER_UNIT = 1000000n;
const SUPPORTED_CURRENCIES = new Set(supportedCurrencies);
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
const OUTPUT_FILENAMES = {
  archive: "opensublists-archive-v2.json",
  review: "opensublists-refactor-review.csv",
  report: "opensublists-refactor-verification.json",
};
const timestampSchema = z.iso.datetime({ offset: true });
const uuidSchema = z.uuid();
const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use a three-letter uppercase currency code.")
  .refine(
    (value) => SUPPORTED_CURRENCIES.has(value),
    "Use a supported uppercase ISO 4217 currency code.",
  );
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const paymentKindSchema = z.enum(["card", "wallet", "bank", "store", "other"]);
const recurrenceUnitSchema = z.enum(["day", "week", "month", "year"]);
const anchorModeSchema = z.enum(["calendar_day", "end_of_month"]);
const subscriptionStatusSchema = z.enum(["active", "cancelled"]);
const isoDateSchema = z.string().refine(isRealIsoDate, "Use a real YYYY-MM-DD date.");
const timezoneSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(isValidTimeZone, "Use a valid IANA time zone.");
const amountSchema = z
  .string()
  .refine(
    (value) => parseAmountToMicros(value) !== null,
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
const recurrenceSchema = z
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
const categoryV1Schema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(80),
  color: colorSchema,
  position: z.number().int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
const paymentMethodV1Schema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(80),
  kind: paymentKindSchema,
  label: paymentLabelSchema.nullable(),
  position: z.number().int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
const subscriptionV1Schema = z
  .strictObject({
    id: uuidSchema,
    name: z.string().trim().min(1).max(120),
    amount: amountSchema,
    currency: currencySchema,
    recurrence: recurrenceSchema,
    status: subscriptionStatusSchema,
    cancelledAt: timestampSchema.nullable(),
    archivedAt: timestampSchema.nullable(),
    categoryId: uuidSchema.nullable(),
    paymentMethodId: uuidSchema.nullable(),
    websiteUrl: nullableUrlSchema,
    notes: z.string().max(10_000).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((value, context) => {
    if (value.status === "active" && value.cancelledAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["cancelledAt"],
        message: "An active subscription must not have cancelledAt.",
      });
    }
    if (value.status === "cancelled" && value.cancelledAt === null) {
      context.addIssue({
        code: "custom",
        path: ["cancelledAt"],
        message: "A cancelled subscription must have cancelledAt.",
      });
    }
  });
const archiveV1Schema = z.strictObject({
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
  categories: z.array(categoryV1Schema).max(100),
  paymentMethods: z.array(paymentMethodV1Schema).max(100),
  subscriptions: z.array(subscriptionV1Schema).max(50),
});
const emojiSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const extendedPictographicPattern = /\p{Extended_Pictographic}/u;
const flagPattern = /^\p{Regional_Indicator}{2}$/u;
const keycapPattern = /^[#*0-9]\uFE0F?\u20E3$/u;
const iconSymbolSchema = z.strictObject({
  type: z.literal("icon"),
  value: z.enum(COMMON_ICON_KEYS),
});
const emojiSymbolSchema = z.strictObject({
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
});
const nonNullSymbolSchema = z.discriminatedUnion("type", [iconSymbolSchema, emojiSymbolSchema]);
const symbolMapSchema = z.strictObject({
  format: z.literal("opensublists-refactor-symbol-map"),
  schemaVersion: z.literal(1),
  symbols: z
    .array(
      z.strictObject({
        resourceKind: z.enum(["category", "paymentMethod", "subscription"]),
        resourceId: uuidSchema,
        symbol: nonNullSymbolSchema,
      }),
    )
    .max(250),
});
export class RefactorMigrationError extends Error {
  code;
  issues;
  constructor(code, message, issues = []) {
    super(message);
    this.name = "RefactorMigrationError";
    this.code = code;
    this.issues = issues;
  }
}
export function transformArchiveV1(sourceText, symbolMapText) {
  assertByteLimit(sourceText, "archive");
  const sourceValue = parseJson(sourceText, "archive");
  const source = parseWithSchema(archiveV1Schema, sourceValue, "INVALID_ARCHIVE");
  validateSourceSemantics(source);
  const symbolMap = parseSymbolMap(symbolMapText);
  const resolvedSymbols = resolveSymbolMap(source, symbolMap);
  const archive = buildArchiveV2(source, resolvedSymbols);
  const archiveJson = `${JSON.stringify(archive, null, 2)}\n`;
  const reviewCsv = buildReviewCsv(archive);
  const verificationReport = buildVerificationReport({
    source,
    archive,
    sourceSha256: sha256(sourceText),
    outputSha256: sha256(archiveJson),
    symbolMapSha256: symbolMapText === undefined ? null : sha256(symbolMapText),
    mappedSymbols: resolvedSymbols,
  });
  const verificationReportJson = `${JSON.stringify(verificationReport, null, 2)}\n`;
  return { archive, archiveJson, reviewCsv, verificationReport, verificationReportJson };
}
export async function migrateArchiveFiles(options) {
  const sourceBuffer = await readBoundedFile(options.inputPath, "archive");
  const symbolMapBuffer =
    options.symbolMapPath === undefined
      ? undefined
      : await readBoundedFile(options.symbolMapPath, "symbol map");
  const artifacts = transformArchiveV1(
    sourceBuffer.toString("utf8"),
    symbolMapBuffer?.toString("utf8"),
  );
  await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(options.outputDirectory, 0o700);
  const paths = {
    archivePath: joinPath(options.outputDirectory, OUTPUT_FILENAMES.archive),
    reviewPath: joinPath(options.outputDirectory, OUTPUT_FILENAMES.review),
    reportPath: joinPath(options.outputDirectory, OUTPUT_FILENAMES.report),
  };
  const writes = [
    [paths.archivePath, artifacts.archiveJson],
    [paths.reviewPath, artifacts.reviewCsv],
    [paths.reportPath, artifacts.verificationReportJson],
  ];
  if (options.overwrite === true) {
    await Promise.all(writes.map(([path, contents]) => writePrivateFile(path, contents)));
  } else {
    await assertAllPathsAbsent(writes.map(([path]) => path));
    await writeAllExclusive(writes);
  }
  return {
    ...paths,
    sourceSha256: artifacts.verificationReport.source.sha256,
    outputSha256: artifacts.verificationReport.output.sha256,
  };
}
export const REFACTOR_MIGRATION_OUTPUT_FILENAMES = OUTPUT_FILENAMES;
function buildArchiveV2(source, symbols) {
  const categories = [...source.categories].sort(comparePositionThenId).map((category) => ({
    id: category.id,
    name: category.name,
    color: category.color,
    symbol: symbols.get(symbolKey("category", category.id)) ?? null,
    position: category.position,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }));
  const paymentMethods = [...source.paymentMethods]
    .sort(comparePositionThenId)
    .map((paymentMethod) => ({
      id: paymentMethod.id,
      name: paymentMethod.name,
      kind: paymentMethod.kind,
      label: paymentMethod.label,
      symbol: symbols.get(symbolKey("paymentMethod", paymentMethod.id)) ?? null,
      position: paymentMethod.position,
      createdAt: paymentMethod.createdAt,
      updatedAt: paymentMethod.updatedAt,
    }));
  const subscriptions = [...source.subscriptions]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((subscription) => ({
      id: subscription.id,
      name: subscription.name,
      symbol: symbols.get(symbolKey("subscription", subscription.id)) ?? null,
      amount: formatMicros(parseRequiredAmount(subscription.amount)),
      currency: subscription.currency,
      recurrence: subscription.recurrence,
      status: subscription.status,
      cancelledAt: subscription.cancelledAt,
      archivedAt: subscription.archivedAt,
      categoryId: subscription.categoryId,
      paymentMethodId: subscription.paymentMethodId,
      websiteUrl: subscription.websiteUrl,
      notes: subscription.notes,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    }));
  return {
    format: source.format,
    schemaVersion: 2,
    archiveId: source.archiveId,
    exportedAt: source.exportedAt,
    generator: source.generator,
    profile: {
      displayName: source.profile.displayName,
      timezone: source.profile.timezone,
      reportingCurrency: source.profile.defaultCurrency,
    },
    categories,
    paymentMethods,
    subscriptions,
  };
}
function buildReviewCsv(archive) {
  const categoryNames = new Map(archive.categories.map((value) => [value.id, value.name]));
  const paymentNames = new Map(archive.paymentMethods.map((value) => [value.id, value.name]));
  const rows = [
    [
      "resource_kind",
      "resource_id",
      "name",
      "currency",
      "amount",
      "recurrence",
      "category",
      "payment_method",
      "symbol",
    ],
  ];
  for (const category of archive.categories) {
    rows.push([
      "category",
      category.id,
      category.name,
      "",
      "",
      "",
      "",
      "",
      formatSymbol(category.symbol),
    ]);
  }
  for (const paymentMethod of archive.paymentMethods) {
    rows.push([
      "paymentMethod",
      paymentMethod.id,
      paymentMethod.name,
      "",
      "",
      "",
      "",
      "",
      formatSymbol(paymentMethod.symbol),
    ]);
  }
  for (const subscription of archive.subscriptions) {
    rows.push([
      "subscription",
      subscription.id,
      subscription.name,
      subscription.currency,
      subscription.amount,
      `${subscription.recurrence.unit}:${subscription.recurrence.count}@${subscription.recurrence.anchorOn}/${subscription.recurrence.anchorMode}`,
      formatRelationship(subscription.categoryId, categoryNames),
      formatRelationship(subscription.paymentMethodId, paymentNames),
      formatSymbol(subscription.symbol),
    ]);
  }
  return `${rows.map((row) => row.map(escapeCsv).join(",")).join("\n")}\n`;
}
function buildVerificationReport(input) {
  const { source, archive, mappedSymbols } = input;
  const categoryReferences = archive.subscriptions.filter((value) => value.categoryId !== null);
  const paymentReferences = archive.subscriptions.filter((value) => value.paymentMethodId !== null);
  const subscriptionsWithoutCategory = archive.subscriptions
    .filter((value) => value.categoryId === null)
    .map((value) => value.id);
  const subscriptionsWithoutPaymentMethod = archive.subscriptions
    .filter((value) => value.paymentMethodId === null)
    .map((value) => value.id);
  const cancelledIds = archive.subscriptions
    .filter((value) => value.status === "cancelled")
    .map((value) => value.id);
  const archivedIds = archive.subscriptions
    .filter((value) => value.archivedAt !== null)
    .map((value) => value.id);
  const cancelledAndArchivedIds = archive.subscriptions
    .filter((value) => value.status === "cancelled" && value.archivedAt !== null)
    .map((value) => value.id);
  return {
    format: "opensublists-refactor-verification",
    schemaVersion: 1,
    source: {
      archiveId: source.archiveId,
      archiveSchemaVersion: 1,
      sha256: input.sourceSha256,
    },
    output: {
      archiveId: archive.archiveId,
      archiveSchemaVersion: 2,
      sha256: input.outputSha256,
    },
    symbolMap:
      input.symbolMapSha256 === null
        ? null
        : { sha256: input.symbolMapSha256, entryCount: mappedSymbols.size },
    counts: { source: countsFor(source), output: countsFor(archive) },
    totalsByCurrency: totalsByCurrency(archive.subscriptions),
    relationships: {
      allReferencesResolved: true,
      category: relationshipSummary(categoryReferences, archive.subscriptions.length, "categoryId"),
      paymentMethod: relationshipSummary(
        paymentReferences,
        archive.subscriptions.length,
        "paymentMethodId",
      ),
      findings: [
        finding("SUBSCRIPTIONS_WITHOUT_CATEGORY", subscriptionsWithoutCategory),
        finding("SUBSCRIPTIONS_WITHOUT_PAYMENT_METHOD", subscriptionsWithoutPaymentMethod),
      ].filter((value) => value !== null),
    },
    lifecycle: {
      consistent: true,
      activeCount: archive.subscriptions.length - cancelledIds.length,
      cancelledCount: cancelledIds.length,
      archivedCount: archivedIds.length,
      unarchivedCount: archive.subscriptions.length - archivedIds.length,
      cancelledAndArchivedCount: cancelledAndArchivedIds.length,
      findings: [
        finding("CANCELLED_SUBSCRIPTIONS_PRESENT", cancelledIds),
        finding("ARCHIVED_SUBSCRIPTIONS_PRESENT", archivedIds),
        finding("CANCELLED_AND_ARCHIVED_SUBSCRIPTIONS_PRESENT", cancelledAndArchivedIds),
      ].filter((value) => value !== null),
    },
    symbols: symbolCounts(archive, mappedSymbols),
  };
}
function totalsByCurrency(subscriptions) {
  const totals = new Map();
  for (const subscription of subscriptions) {
    const amountMicros = parseRequiredAmount(subscription.amount);
    const current = totals.get(subscription.currency) ?? {
      subscriptionCount: 0,
      totalAmountMicros: 0n,
      activeUnarchivedSubscriptionCount: 0,
      activeUnarchivedAmountMicros: 0n,
    };
    current.subscriptionCount += 1;
    current.totalAmountMicros += amountMicros;
    if (subscription.status === "active" && subscription.archivedAt === null) {
      current.activeUnarchivedSubscriptionCount += 1;
      current.activeUnarchivedAmountMicros += amountMicros;
    }
    totals.set(subscription.currency, current);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, value]) => ({
      currency,
      subscriptionCount: value.subscriptionCount,
      totalAmountMicros: value.totalAmountMicros.toString(),
      activeUnarchivedSubscriptionCount: value.activeUnarchivedSubscriptionCount,
      activeUnarchivedAmountMicros: value.activeUnarchivedAmountMicros.toString(),
    }));
}
function relationshipSummary(references, totalSubscriptions, field) {
  const ids = references.map((value) => value[field]).filter((value) => value !== null);
  return {
    referencedSubscriptions: references.length,
    unassignedSubscriptions: totalSubscriptions - references.length,
    distinctReferencedResourceIds: [...new Set(ids)].sort(),
  };
}
function finding(code, resourceIds) {
  if (resourceIds.length === 0) return null;
  return { severity: "info", code, resourceIds: [...resourceIds].sort() };
}
function symbolCounts(archive, mappedSymbols) {
  const mapped = { categories: 0, paymentMethods: 0, subscriptions: 0 };
  for (const key of mappedSymbols.keys()) {
    if (key.startsWith("category:")) mapped.categories += 1;
    else if (key.startsWith("paymentMethod:")) mapped.paymentMethods += 1;
    else mapped.subscriptions += 1;
  }
  const total = countsFor(archive);
  return {
    mapped,
    unmapped: {
      categories: total.categories - mapped.categories,
      paymentMethods: total.paymentMethods - mapped.paymentMethods,
      subscriptions: total.subscriptions - mapped.subscriptions,
    },
  };
}
function countsFor(value) {
  return {
    categories: value.categories.length,
    paymentMethods: value.paymentMethods.length,
    subscriptions: value.subscriptions.length,
  };
}
function parseSymbolMap(symbolMapText) {
  if (symbolMapText === undefined) return null;
  assertByteLimit(symbolMapText, "symbol map");
  return parseWithSchema(
    symbolMapSchema,
    parseJson(symbolMapText, "symbol map"),
    "INVALID_SYMBOL_MAP",
  );
}
function resolveSymbolMap(source, symbolMap) {
  if (symbolMap === null) return new Map();
  const validTargets = new Set();
  for (const category of source.categories) validTargets.add(symbolKey("category", category.id));
  for (const paymentMethod of source.paymentMethods) {
    validTargets.add(symbolKey("paymentMethod", paymentMethod.id));
  }
  for (const subscription of source.subscriptions) {
    validTargets.add(symbolKey("subscription", subscription.id));
  }
  const symbols = new Map();
  const issues = [];
  for (const [index, entry] of symbolMap.symbols.entries()) {
    const key = symbolKey(entry.resourceKind, entry.resourceId);
    if (!validTargets.has(key)) {
      issues.push({
        path: `symbols.${index}.resourceId`,
        message: "The symbol mapping target does not exist in the source archive.",
      });
    } else if (symbols.has(key)) {
      issues.push({
        path: `symbols.${index}`,
        message: "The symbol mapping target appears more than once.",
      });
    } else {
      symbols.set(key, entry.symbol);
    }
  }
  if (issues.length > 0) {
    throw new RefactorMigrationError(
      "INVALID_SYMBOL_MAP",
      summarizeIssues("Symbol map validation failed", issues),
      issues,
    );
  }
  return symbols;
}
function validateSourceSemantics(source) {
  const issues = [];
  assertUniqueIds(source.categories, "categories", issues);
  assertUniqueIds(source.paymentMethods, "paymentMethods", issues);
  assertUniqueIds(source.subscriptions, "subscriptions", issues);
  const categoryIds = new Set(source.categories.map((value) => value.id));
  const paymentMethodIds = new Set(source.paymentMethods.map((value) => value.id));
  const categoryNameKeys = new Map();
  for (const [index, category] of source.categories.entries()) {
    const key = normalizeCategoryNameKey(category.name);
    const earlierIndex = categoryNameKeys.get(key);
    if (earlierIndex !== undefined) {
      issues.push({
        path: `categories.${index}.name`,
        message: `The normalized category name duplicates categories.${earlierIndex}.name.`,
      });
    } else {
      categoryNameKeys.set(key, index);
    }
  }
  for (const [index, subscription] of source.subscriptions.entries()) {
    if (subscription.categoryId !== null && !categoryIds.has(subscription.categoryId)) {
      issues.push({
        path: `subscriptions.${index}.categoryId`,
        message: "The category reference does not exist in this archive.",
      });
    }
    if (
      subscription.paymentMethodId !== null &&
      !paymentMethodIds.has(subscription.paymentMethodId)
    ) {
      issues.push({
        path: `subscriptions.${index}.paymentMethodId`,
        message: "The payment-method reference does not exist in this archive.",
      });
    }
  }
  if (issues.length > 0) {
    throw new RefactorMigrationError(
      "INVALID_ARCHIVE",
      summarizeIssues("Archive semantic validation failed", issues),
      issues,
    );
  }
}
function assertUniqueIds(values, path, issues) {
  const seen = new Map();
  for (const [index, value] of values.entries()) {
    const earlierIndex = seen.get(value.id);
    if (earlierIndex !== undefined) {
      issues.push({
        path: `${path}.${index}.id`,
        message: `The ID duplicates ${path}.${earlierIndex}.id.`,
      });
    } else {
      seen.set(value.id, index);
    }
  }
}
function parseWithSchema(schema, value, code) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "<root>",
    message: issue.message,
  }));
  throw new RefactorMigrationError(
    code,
    summarizeIssues("Schema validation failed", issues),
    issues,
  );
}
function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new RefactorMigrationError("INVALID_JSON", `The ${label} is not valid JSON.`);
  }
}
function parseAmountToMicros(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  const micros = BigInt(whole) * MICROS_PER_UNIT + BigInt(fraction.padEnd(6, "0"));
  return micros <= MAX_SAFE_MICROS ? micros : null;
}
function parseRequiredAmount(value) {
  const micros = parseAmountToMicros(value);
  if (micros === null) {
    throw new RefactorMigrationError("INVALID_ARCHIVE", "A validated amount became invalid.");
  }
  return micros;
}
function formatMicros(micros) {
  const whole = micros / MICROS_PER_UNIT;
  const fraction = (micros % MICROS_PER_UNIT).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
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
  const resemblesNamedTimeZone =
    value === "UTC" || /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(value);
  if (!resemblesNamedTimeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
function normalizeCategoryNameKey(value) {
  return value
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{White_Space}+/gu, " ");
}
function comparePositionThenId(left, right) {
  return left.position - right.position || left.id.localeCompare(right.id);
}
function symbolKey(kind, id) {
  return `${kind}:${id}`;
}
function formatSymbol(symbol) {
  return symbol === null ? "" : `${symbol.type}:${symbol.value}`;
}
function formatRelationship(id, names) {
  if (id === null) return "";
  return `${names.get(id) ?? "Unknown"} [${id}]`;
}
function escapeCsv(value) {
  const spreadsheetSafeValue = /^[=+\-@]/u.test(value) ? `'${value}` : value;
  if (!/[",\r\n]/.test(spreadsheetSafeValue)) return spreadsheetSafeValue;
  return `"${spreadsheetSafeValue.replaceAll('"', '""')}"`;
}
function sha256(value) {
  return `sha256-${createHash("sha256").update(value).digest("hex")}`;
}
function summarizeIssues(prefix, issues) {
  const first = issues[0];
  return first === undefined
    ? `${prefix}.`
    : `${prefix} at ${first.path || "<root>"}: ${first.message}`;
}
function assertByteLimit(value, label) {
  if (Buffer.byteLength(value, "utf8") > MAX_ARCHIVE_BYTES) {
    throw new RefactorMigrationError("INPUT_TOO_LARGE", `The ${label} exceeds 5 MiB.`);
  }
}
async function readBoundedFile(path, label) {
  const value = await readFile(path);
  if (value.byteLength > MAX_ARCHIVE_BYTES) {
    throw new RefactorMigrationError("INPUT_TOO_LARGE", `The ${label} exceeds 5 MiB.`);
  }
  return value;
}
async function assertAllPathsAbsent(paths) {
  const existing = [];
  for (const path of paths) {
    try {
      await access(path, fileConstants.F_OK);
      existing.push(path);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
  }
  if (existing.length > 0) {
    throw new RefactorMigrationError(
      "OUTPUT_EXISTS",
      `Refusing to overwrite existing output: ${existing.join(", ")}`,
    );
  }
}
async function writeAllExclusive(writes) {
  const handles = [];
  try {
    for (const [path] of writes) {
      handles.push({ path, handle: await open(path, "wx", 0o600) });
    }
    await Promise.all(
      handles.map(async ({ path, handle }) => {
        const value = writes.find(([candidate]) => candidate === path)?.[1];
        if (value === undefined) throw new Error("Missing migration artifact contents.");
        await handle.writeFile(value, "utf8");
      }),
    );
  } catch (error) {
    await Promise.allSettled(handles.map(({ handle }) => handle.close()));
    await Promise.allSettled(handles.map(({ path }) => unlink(path)));
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new RefactorMigrationError("OUTPUT_EXISTS", "Refusing to overwrite existing output.");
    }
    throw error;
  } finally {
    await Promise.allSettled(handles.map(({ handle }) => handle.close()));
  }
}

async function writePrivateFile(path, contents) {
  try {
    await chmod(path, 0o600);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}
function isNodeError(value) {
  return value instanceof Error && "code" in value;
}
function joinPath(directory, filename) {
  const separator = directory.endsWith("/") ? "" : "/";
  return `${directory}${separator}${filename}`;
}
