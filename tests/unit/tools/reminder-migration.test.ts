import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { OpenSubListsArchiveV3, OpenSubListsArchiveV4 } from "../../../src/shared/api-types";
import { archiveV3Schema, archiveV4Schema } from "../../../src/shared/api-types/schemas";
// @ts-expect-error The operator tool is intentionally plain JavaScript outside the app TS build.
import * as untypedReminderMigration from "../../../tools/reminder-migration/index.js";

type ReminderMigrationModule = {
  ReminderMigrationError: new (...args: unknown[]) => Error;
  transformArchiveV2: (sourceText: string) => OpenSubListsArchiveV3;
  transformArchiveV3: (sourceText: string) => OpenSubListsArchiveV4;
  migrateReminderArchiveFile: (options: {
    inputPath: string;
    outputPath: string;
    overwrite?: boolean;
  }) => Promise<OpenSubListsArchiveV3>;
  migrateLocaleArchiveFile: (options: {
    inputPath: string;
    outputPath: string;
    overwrite?: boolean;
  }) => Promise<OpenSubListsArchiveV4>;
};

const {
  ReminderMigrationError,
  migrateLocaleArchiveFile,
  migrateReminderArchiveFile,
  transformArchiveV2,
  transformArchiveV3,
} = untypedReminderMigration as unknown as ReminderMigrationModule;

describe("offline reminder archive migration", () => {
  it("adds exact safe profile defaults and explicitly opts every subscription out", () => {
    const transformed = transformArchiveV2(JSON.stringify(archiveV2()));
    expect(transformed).toMatchObject({
      schemaVersion: 3,
      profile: {
        preferredLocale: "en",
        defaultEmailReminderDaysBefore: 7,
        emailReminderLocalTime: "09:00",
        emailRemindersPaused: false,
      },
    });
    expect(transformed.subscriptions).toHaveLength(2);
    expect(transformed.subscriptions.every((item) => item.emailReminderEnabled === false)).toBe(
      true,
    );
    expect(transformed.subscriptions.every((item) => item.emailReminderDaysBefore === null)).toBe(
      true,
    );
    expect(archiveV3Schema.safeParse(transformed).success).toBe(true);
  });

  it("does not accept delivery/provider history disguised as a version 2 archive", () => {
    const source = archiveV2();
    const first = source.subscriptions[0];
    if (first === undefined) throw new Error("The fixture is missing its subscription.");
    source.subscriptions[0] = {
      ...first,
      providerMessageId: "must-not-import",
    };
    expect(() => transformArchiveV2(JSON.stringify(source))).toThrow(ReminderMigrationError);
  });

  it.each([
    [
      "invalid calendar date",
      (source: ReturnType<typeof archiveV2>) => {
        source.subscriptions[0]!.recurrence.anchorOn = "2026-02-30";
      },
    ],
    [
      "invalid IANA timezone",
      (source: ReturnType<typeof archiveV2>) => {
        source.profile.timezone = "UTC+25";
      },
    ],
    [
      "unsafe micro-unit amount",
      (source: ReturnType<typeof archiveV2>) => {
        source.subscriptions[0]!.amount = "9007199254.740992";
      },
    ],
    [
      "non-HTTP website",
      (source: ReturnType<typeof archiveV2>) => {
        source.subscriptions[0]!.websiteUrl = "mailto:billing@example.test";
      },
    ],
    [
      "unmasked payment label",
      (source: ReturnType<typeof archiveV2>) => {
        source.paymentMethods.push(paymentMethod("12345"));
      },
    ],
    [
      "invalid end-of-month recurrence",
      (source: ReturnType<typeof archiveV2>) => {
        source.subscriptions[0]!.recurrence.unit = "week";
        source.subscriptions[0]!.recurrence.anchorMode = "end_of_month";
      },
    ],
    [
      "unapproved icon",
      (source: ReturnType<typeof archiveV2>) => {
        source.subscriptions[0]!.symbol = { type: "icon", value: "untrusted_icon" };
      },
    ],
    [
      "plain-text emoji",
      (source: ReturnType<typeof archiveV2>) => {
        source.subscriptions[0]!.symbol = { type: "emoji", value: "not emoji" };
      },
    ],
  ])("rejects a V2 source with %s", (_label, mutate) => {
    const source = archiveV2();
    mutate(source);
    expect(() => transformArchiveV2(JSON.stringify(source))).toThrow(ReminderMigrationError);
  });

  it("writes an owner-only artifact and refuses an accidental overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opensublists-reminder-migration-"));
    const inputPath = join(directory, "archive-v2.json");
    const outputPath = join(directory, "archive-v3.json");
    try {
      await writeFile(inputPath, JSON.stringify(archiveV2()), "utf8");
      await migrateReminderArchiveFile({ inputPath, outputPath });
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
      const written: unknown = JSON.parse(await readFile(outputPath, "utf8"));
      expect(archiveV3Schema.safeParse(written).success).toBe(true);
      await expect(migrateReminderArchiveFile({ inputPath, outputPath })).rejects.toMatchObject({
        code: "OUTPUT_EXISTS",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("atomically replaces an existing output with owner-only permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opensublists-reminder-overwrite-"));
    const inputPath = join(directory, "archive-v2.json");
    const outputPath = join(directory, "archive-v3.json");
    try {
      await writeFile(inputPath, JSON.stringify(archiveV2()), "utf8");
      await writeFile(outputPath, "stale public output", { encoding: "utf8", mode: 0o644 });
      await chmod(outputPath, 0o644);

      await migrateReminderArchiveFile({ inputPath, outputPath, overwrite: true });

      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
      expect(
        archiveV3Schema.safeParse(JSON.parse(await readFile(outputPath, "utf8"))).success,
      ).toBe(true);
      expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("offline split-locale archive migration", () => {
  it("splits the V3 locale without changing reminder preferences or business data", () => {
    const source = archiveV3("zh-Hans");

    const transformed = transformArchiveV3(JSON.stringify(source));

    expect(transformed.schemaVersion).toBe(4);
    expect(transformed.profile).toEqual({
      displayName: null,
      timezone: "UTC",
      reportingCurrency: "USD",
      defaultEmailReminderDaysBefore: 7,
      emailReminderLocalTime: "09:00",
      emailRemindersPaused: false,
      interfaceLocale: "zh-Hans",
      emailLocale: "zh-Hans",
    });
    expect("preferredLocale" in transformed.profile).toBe(false);
    expect(transformed.categories).toEqual(source.categories);
    expect(transformed.paymentMethods).toEqual(source.paymentMethods);
    expect(transformed.subscriptions).toEqual(source.subscriptions);
    expect(archiveV4Schema.safeParse(transformed).success).toBe(true);
  });

  it("rejects a source that is not a strict V3 locale archive", () => {
    const source = archiveV3();
    const invalidSource = {
      ...source,
      profile: {
        ...source.profile,
        preferredLocale: "fr",
      },
    };

    expect(() => transformArchiveV3(JSON.stringify(invalidSource))).toThrow(ReminderMigrationError);
  });

  it("writes a private V4 artifact and refuses an accidental overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opensublists-locale-migration-"));
    const inputPath = join(directory, "archive-v3.json");
    const outputPath = join(directory, "archive-v4.json");
    try {
      await writeFile(inputPath, JSON.stringify(archiveV3("zh-Hans")), "utf8");

      const migrated = await migrateLocaleArchiveFile({ inputPath, outputPath });

      expect(migrated).toMatchObject({
        schemaVersion: 4,
        profile: { interfaceLocale: "zh-Hans", emailLocale: "zh-Hans" },
      });
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
      const written: unknown = JSON.parse(await readFile(outputPath, "utf8"));
      expect(archiveV4Schema.safeParse(written).success).toBe(true);
      await expect(migrateLocaleArchiveFile({ inputPath, outputPath })).rejects.toMatchObject({
        code: "OUTPUT_EXISTS",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an oversized archive before creating an output artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opensublists-locale-oversized-"));
    const inputPath = join(directory, "archive-v3.json");
    const outputPath = join(directory, "archive-v4.json");
    try {
      await writeFile(inputPath, Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));

      await expect(migrateLocaleArchiveFile({ inputPath, outputPath })).rejects.toMatchObject({
        code: "INPUT_TOO_LARGE",
      });
      await expect(stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("atomically replaces a locale archive with owner-only permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opensublists-locale-overwrite-"));
    const inputPath = join(directory, "archive-v3.json");
    const outputPath = join(directory, "archive-v4.json");
    try {
      await writeFile(inputPath, JSON.stringify(archiveV3()), "utf8");
      await writeFile(outputPath, "stale public output", { encoding: "utf8", mode: 0o644 });
      await chmod(outputPath, 0o644);

      await migrateLocaleArchiveFile({ inputPath, outputPath, overwrite: true });

      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
      const written: unknown = JSON.parse(await readFile(outputPath, "utf8"));
      expect(archiveV4Schema.safeParse(written).success).toBe(true);
      expect(written).toMatchObject({
        schemaVersion: 4,
        profile: { interfaceLocale: "en", emailLocale: "en" },
      });
      expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function archiveV3(locale: "en" | "zh-Hans" = "en"): OpenSubListsArchiveV3 {
  const archive = transformArchiveV2(JSON.stringify(archiveV2()));
  return {
    ...archive,
    profile: {
      ...archive.profile,
      preferredLocale: locale,
    },
  };
}

function paymentMethod(label: string) {
  const timestamp = "2026-08-24T00:00:00.000Z";
  return {
    id: "30000000-0000-4000-8000-000000000001",
    name: "Card",
    kind: "card" as const,
    label,
    symbol: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

type MutableSubscriptionFixture = {
  id: string;
  name: string;
  symbol: unknown;
  amount: string;
  currency: string;
  recurrence: { unit: string; count: number; anchorOn: string; anchorMode: string };
  status: string;
  cancelledAt: string | null;
  archivedAt: string | null;
  categoryId: string | null;
  paymentMethodId: string | null;
  websiteUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

type MutableArchiveV2Fixture = {
  format: string;
  schemaVersion: number;
  archiveId: string;
  exportedAt: string;
  generator: { name: string; version: string };
  profile: { displayName: string | null; timezone: string; reportingCurrency: string };
  categories: unknown[];
  paymentMethods: ReturnType<typeof paymentMethod>[];
  subscriptions: MutableSubscriptionFixture[];
};

function archiveV2(): MutableArchiveV2Fixture {
  const timestamp = "2026-08-24T00:00:00.000Z";
  const subscription = (id: string, name: string): MutableSubscriptionFixture => ({
    id,
    name,
    symbol: null,
    amount: "9.99",
    currency: "USD",
    recurrence: {
      unit: "month",
      count: 1,
      anchorOn: "2026-08-24",
      anchorMode: "calendar_day",
    },
    status: "active",
    cancelledAt: null,
    archivedAt: null,
    categoryId: null,
    paymentMethodId: null,
    websiteUrl: null,
    notes: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return {
    format: "opensublists",
    schemaVersion: 2,
    archiveId: "10000000-0000-4000-8000-000000000001",
    exportedAt: timestamp,
    generator: { name: "OpenSubLists", version: "0.1.0" },
    profile: {
      displayName: null,
      timezone: "UTC",
      reportingCurrency: "USD",
    },
    categories: [],
    paymentMethods: [],
    subscriptions: [
      subscription("20000000-0000-4000-8000-000000000001", "One"),
      subscription("20000000-0000-4000-8000-000000000002", "Two"),
    ],
  };
}
