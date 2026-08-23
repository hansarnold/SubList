/// <reference types="node" />

import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenSubListsService } from "../../../src/application/service";
import type { OpenSubListsRepository } from "../../../src/application/ports";
import { archiveV2Schema } from "../../../src/shared/api-types/schemas";
// @ts-expect-error The operator tool is intentionally plain JavaScript outside the app TS build.
import * as untypedMigrationModule from "../../../tools/refactor-migration/index.js";

type MigrationError = Error & {
  code: string;
  issues: ReadonlyArray<{ path: string; message: string }>;
};

type ResourceSymbol = { type: "icon" | "emoji"; value: string } | null;

type MigrationArtifacts = {
  archive: {
    schemaVersion: 2;
    profile: {
      displayName: string | null;
      timezone: string;
      reportingCurrency: string;
    };
    categories: Array<{ id: string; symbol: ResourceSymbol }>;
    paymentMethods: Array<{ id: string; symbol: ResourceSymbol }>;
    subscriptions: Array<{ id: string; amount: string; symbol: ResourceSymbol }>;
  };
  reviewCsv: string;
  verificationReport: {
    counts: {
      source: ResourceCounts;
      output: ResourceCounts;
    };
    totalsByCurrency: Array<{
      currency: string;
      subscriptionCount: number;
      totalAmountMicros: string;
      activeUnarchivedSubscriptionCount: number;
      activeUnarchivedAmountMicros: string;
    }>;
    relationships: {
      allReferencesResolved: boolean;
      category: { referencedSubscriptions: number; unassignedSubscriptions: number };
      paymentMethod: { referencedSubscriptions: number; unassignedSubscriptions: number };
    };
    lifecycle: {
      consistent: boolean;
      activeCount: number;
      cancelledCount: number;
      archivedCount: number;
      unarchivedCount: number;
      cancelledAndArchivedCount: number;
      findings: Array<{ code: string }>;
    };
    source: { sha256: string };
    output: { sha256: string };
  };
};

type ResourceCounts = {
  categories: number;
  paymentMethods: number;
  subscriptions: number;
};

type MigrationModule = {
  migrateArchiveFiles: (options: {
    inputPath: string;
    outputDirectory: string;
    overwrite?: boolean;
  }) => Promise<{
    archivePath: string;
    reviewPath: string;
    reportPath: string;
  }>;
  REFACTOR_MIGRATION_OUTPUT_FILENAMES: Readonly<{
    archive: string;
    review: string;
    report: string;
  }>;
  RefactorMigrationError: new (...args: unknown[]) => MigrationError;
  transformArchiveV1: (sourceText: string, symbolMapText?: string) => MigrationArtifacts;
};

const {
  migrateArchiveFiles,
  REFACTOR_MIGRATION_OUTPUT_FILENAMES,
  RefactorMigrationError,
  transformArchiveV1,
} = untypedMigrationModule as unknown as MigrationModule;

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";
const PAYMENT_METHOD_ID = "22222222-2222-4222-8222-222222222222";
const ACTIVE_USD_ID = "33333333-3333-4333-8333-333333333333";
const CANCELLED_USD_ID = "44444444-4444-4444-8444-444444444444";
const ACTIVE_CNY_ID = "55555555-5555-4555-8555-555555555555";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("the one-time archive v1 to v2 transformer", () => {
  it("transforms a valid v1 archive and applies only explicit symbol mappings", () => {
    const source = sourceText();
    const symbolMap = JSON.stringify({
      format: "opensublists-refactor-symbol-map",
      schemaVersion: 1,
      symbols: [
        {
          resourceKind: "category",
          resourceId: CATEGORY_ID,
          symbol: { type: "icon", value: "briefcase" },
        },
        {
          resourceKind: "subscription",
          resourceId: ACTIVE_USD_ID,
          symbol: { type: "emoji", value: "  ✨  " },
        },
      ],
    });

    const result = transformArchiveV1(source, symbolMap);

    expect(archiveV2Schema.safeParse(result.archive).success).toBe(true);
    expect(result.archive.schemaVersion).toBe(2);
    expect(result.archive.profile).toEqual({
      displayName: "Owner",
      timezone: "Asia/Shanghai",
      reportingCurrency: "CNY",
    });
    expect(result.archive.categories[0]?.symbol).toEqual({
      type: "icon",
      value: "briefcase",
    });
    expect(result.archive.paymentMethods[0]?.symbol).toBeNull();
    expect(
      result.archive.subscriptions.find((value) => value.id === ACTIVE_USD_ID)?.symbol,
    ).toEqual({
      type: "emoji",
      value: "✨",
    });
    expect(
      result.archive.subscriptions.find((value) => value.id === CANCELLED_USD_ID)?.symbol,
    ).toBeNull();
    expect(result.archive.subscriptions.find((value) => value.id === ACTIVE_USD_ID)?.amount).toBe(
      "9.99",
    );
    expect(result.reviewCsv).toContain(
      "resource_kind,resource_id,name,currency,amount,recurrence,category,payment_method,symbol",
    );
    expect(result.reviewCsv).toContain("icon:briefcase");
    expect(result.reviewCsv).toContain("emoji:✨");
    expect(result.reviewCsv).toContain(`Work [${CATEGORY_ID}]`);
    expect(result.reviewCsv).toContain(`Visa [${PAYMENT_METHOD_ID}]`);
  });

  it("emits v2 accepted by both the archive schema and runtime canonicalization", async () => {
    const result = transformArchiveV1(sourceText());
    const runtime = new OpenSubListsService({
      getImportState: () =>
        Promise.resolve({
          categoryIds: new Set<string>(),
          paymentMethodIds: new Set<string>(),
          subscriptionIds: new Set<string>(),
          categoryNameKeysById: new Map<string, string>(),
        }),
    } as unknown as OpenSubListsRepository);

    expect(archiveV2Schema.safeParse(result.archive).success).toBe(true);
    await expect(
      runtime.previewImport(
        "migration-rehearsal-user",
        result.archive as unknown as Record<string, unknown>,
      ),
    ).resolves.toMatchObject({
      schemaVersion: 2,
      counts: { categories: 1, paymentMethods: 1, subscriptions: 3 },
    });
  });

  it("reports exact counts, micro-unit totals, relationships, and lifecycle findings", () => {
    const result = transformArchiveV1(sourceText());
    const report = result.verificationReport;

    expect(report.counts).toEqual({
      source: { categories: 1, paymentMethods: 1, subscriptions: 3 },
      output: { categories: 1, paymentMethods: 1, subscriptions: 3 },
    });
    expect(report.totalsByCurrency).toEqual([
      {
        currency: "CNY",
        subscriptionCount: 1,
        totalAmountMicros: "88800000",
        activeUnarchivedSubscriptionCount: 1,
        activeUnarchivedAmountMicros: "88800000",
      },
      {
        currency: "USD",
        subscriptionCount: 2,
        totalAmountMicros: "10000000",
        activeUnarchivedSubscriptionCount: 1,
        activeUnarchivedAmountMicros: "9990000",
      },
    ]);
    expect(report.relationships).toMatchObject({
      allReferencesResolved: true,
      category: { referencedSubscriptions: 2, unassignedSubscriptions: 1 },
      paymentMethod: { referencedSubscriptions: 2, unassignedSubscriptions: 1 },
    });
    expect(report.lifecycle).toMatchObject({
      consistent: true,
      activeCount: 2,
      cancelledCount: 1,
      archivedCount: 1,
      unarchivedCount: 2,
      cancelledAndArchivedCount: 1,
    });
    expect(report.lifecycle.findings.map((value) => value.code)).toEqual([
      "CANCELLED_SUBSCRIPTIONS_PRESENT",
      "ARCHIVED_SUBSCRIPTIONS_PRESENT",
      "CANCELLED_AND_ARCHIVED_SUBSCRIPTIONS_PRESENT",
    ]);
    expect(report.source.sha256).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(report.output.sha256).toMatch(/^sha256-[a-f0-9]{64}$/);
  });

  it.each(["=1+1", "+cmd", "-cmd", "@cmd"])(
    "neutralizes a spreadsheet formula prefix in CSV cells: %s",
    (name) => {
      const archive = makeArchiveV1();
      archive.subscriptions[0]!.name = name;

      const result = transformArchiveV1(JSON.stringify(archive));
      const row = result.reviewCsv
        .split("\n")
        .find((value) => value.startsWith(`subscription,${ACTIVE_USD_ID},`));

      expect(row).toContain(`,'${name},USD,`);
      expect(row).not.toContain(`,${name},USD,`);
    },
  );

  it("keeps a neutralized formula cell valid when CSV quoting is also required", () => {
    const archive = makeArchiveV1();
    archive.subscriptions[0]!.name = "=SUM(1,1)";

    const result = transformArchiveV1(JSON.stringify(archive));
    const row = result.reviewCsv
      .split("\n")
      .find((value) => value.startsWith(`subscription,${ACTIVE_USD_ID},`));

    expect(row).toContain(`,"'=SUM(1,1)",USD,`);
  });

  it("rejects broken category and payment-method references", () => {
    const archive = makeArchiveV1();
    archive.subscriptions[0]!.categoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    archive.subscriptions[0]!.paymentMethodId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    expectMigrationError(
      () => transformArchiveV1(JSON.stringify(archive)),
      "INVALID_ARCHIVE",
      "subscriptions.0.categoryId",
    );
  });

  it.each([
    ["currency", "usd", "subscriptions.0.currency"],
    ["amount precision", "1.0000000", "subscriptions.0.amount"],
    ["amount overflow", "9007199254.740992", "subscriptions.0.amount"],
  ])("rejects invalid %s data", (_caseName, value, expectedPath) => {
    const archive = makeArchiveV1();
    if (expectedPath.endsWith("currency")) archive.subscriptions[0]!.currency = value;
    else archive.subscriptions[0]!.amount = value;

    expectMigrationError(
      () => transformArchiveV1(JSON.stringify(archive)),
      "INVALID_ARCHIVE",
      expectedPath,
    );
  });

  it("rejects currencies and time zones that runtime canonicalization does not support", () => {
    const profileCurrency = makeArchiveV1();
    profileCurrency.profile.defaultCurrency = "ZZZ";
    expectMigrationError(
      () => transformArchiveV1(JSON.stringify(profileCurrency)),
      "INVALID_ARCHIVE",
      "profile.defaultCurrency",
    );

    const subscriptionCurrency = makeArchiveV1();
    subscriptionCurrency.subscriptions[0]!.currency = "ZZZ";
    expectMigrationError(
      () => transformArchiveV1(JSON.stringify(subscriptionCurrency)),
      "INVALID_ARCHIVE",
      "subscriptions.0.currency",
    );

    const timeZone = makeArchiveV1();
    timeZone.profile.timezone = "GMT";
    expectMigrationError(
      () => transformArchiveV1(JSON.stringify(timeZone)),
      "INVALID_ARCHIVE",
      "profile.timezone",
    );
  });

  it("rejects unknown input fields instead of silently discarding them", () => {
    const archive = { ...makeArchiveV1(), unexpected: true };
    expectMigrationError(
      () => transformArchiveV1(JSON.stringify(archive)),
      "INVALID_ARCHIVE",
      "<root>",
    );
  });

  it("refuses to overwrite any migration artifact by default", async () => {
    const directory = await makeTemporaryDirectory();
    const inputPath = join(directory, "source.json");
    const outputDirectory = join(directory, "output");
    await writeFile(inputPath, sourceText(), "utf8");
    const first = await migrateArchiveFiles({ inputPath, outputDirectory });
    const originalArchive = await readFile(first.archivePath, "utf8");

    await expect(migrateArchiveFiles({ inputPath, outputDirectory })).rejects.toMatchObject({
      code: "OUTPUT_EXISTS",
    });
    await expect(readFile(first.archivePath, "utf8")).resolves.toBe(originalArchive);
  });

  it("accepts one leading package-manager argument separator at the CLI boundary", async () => {
    const directory = await makeTemporaryDirectory();
    const inputPath = join(directory, "source.json");
    const outputDirectory = join(directory, "output");
    await writeFile(inputPath, sourceText(), "utf8");

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "tools/refactor-migration/cli.mjs"),
        "--",
        "--input",
        inputPath,
        "--output-dir",
        outputDirectory,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Refactor migration artifacts created:");
    await expect(
      readFile(join(outputDirectory, REFACTOR_MIGRATION_OUTPUT_FILENAMES.archive), "utf8"),
    ).resolves.toContain('"schemaVersion": 2');
  });

  it("rejects a standalone separator after option parsing has begun", async () => {
    const directory = await makeTemporaryDirectory();
    const inputPath = join(directory, "source.json");
    await writeFile(inputPath, sourceText(), "utf8");

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "tools/refactor-migration/cli.mjs"),
        "--input",
        inputPath,
        "--",
        "--output-dir",
        join(directory, "output"),
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown option: --");
  });

  it("enforces private permissions for new and overwritten artifacts", async () => {
    const directory = await makeTemporaryDirectory();
    const inputPath = join(directory, "source.json");
    const outputDirectory = join(directory, "output");
    await writeFile(inputPath, sourceText(), "utf8");
    await mkdir(outputDirectory, { mode: 0o755 });

    const first = await migrateArchiveFiles({ inputPath, outputDirectory });
    await expectPermissions(outputDirectory, 0o700);
    for (const path of [first.archivePath, first.reviewPath, first.reportPath]) {
      await expectPermissions(path, 0o600);
      await chmod(path, 0o644);
    }
    await chmod(outputDirectory, 0o755);

    const overwritten = await migrateArchiveFiles({ inputPath, outputDirectory, overwrite: true });
    await expectPermissions(outputDirectory, 0o700);
    for (const path of [overwritten.archivePath, overwritten.reviewPath, overwritten.reportPath]) {
      await expectPermissions(path, 0o600);
    }
  });

  it("produces path-independent deterministic artifact contents", async () => {
    const firstDirectory = await makeTemporaryDirectory();
    const secondDirectory = await makeTemporaryDirectory();
    const firstInput = join(firstDirectory, "first-name.json");
    const secondInput = join(secondDirectory, "unrelated-name.json");
    await Promise.all([
      writeFile(firstInput, sourceText(), "utf8"),
      writeFile(secondInput, sourceText(), "utf8"),
    ]);

    await Promise.all([
      migrateArchiveFiles({ inputPath: firstInput, outputDirectory: join(firstDirectory, "out") }),
      migrateArchiveFiles({
        inputPath: secondInput,
        outputDirectory: join(secondDirectory, "out"),
      }),
    ]);

    for (const filename of Object.values(REFACTOR_MIGRATION_OUTPUT_FILENAMES)) {
      const [first, second] = await Promise.all([
        readFile(join(firstDirectory, "out", filename), "utf8"),
        readFile(join(secondDirectory, "out", filename), "utf8"),
      ]);
      expect(first).toBe(second);
    }
  });

  it("rejects invalid, duplicate, and unknown symbol mappings", () => {
    const symbolMap = {
      format: "opensublists-refactor-symbol-map",
      schemaVersion: 1,
      symbols: [
        {
          resourceKind: "category",
          resourceId: CATEGORY_ID,
          symbol: { type: "icon", value: "not_allowed" },
        },
      ],
    };
    expectMigrationError(
      () => transformArchiveV1(sourceText(), JSON.stringify(symbolMap)),
      "INVALID_SYMBOL_MAP",
      "symbols.0.symbol.value",
    );

    symbolMap.symbols = [
      {
        resourceKind: "category",
        resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        symbol: { type: "icon", value: "briefcase" },
      },
    ];
    expectMigrationError(
      () => transformArchiveV1(sourceText(), JSON.stringify(symbolMap)),
      "INVALID_SYMBOL_MAP",
      "symbols.0.resourceId",
    );
  });
});

function expectMigrationError(action: () => unknown, code: string, expectedPath: string): void {
  try {
    action();
    throw new Error("Expected the migration to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(RefactorMigrationError);
    expect(error).toMatchObject({ code });
    const migrationError = error as MigrationError;
    expect(migrationError.issues.some((issue) => issue.path === expectedPath)).toBe(true);
  }
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opensublists-refactor-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function expectPermissions(path: string, expected: number): Promise<void> {
  expect((await stat(path)).mode & 0o777).toBe(expected);
}

function sourceText(): string {
  return `${JSON.stringify(makeArchiveV1(), null, 2)}\n`;
}

function makeArchiveV1() {
  const timestamp = "2026-08-23T08:15:30.123Z";
  return {
    format: "opensublists" as const,
    schemaVersion: 1 as const,
    archiveId: "00000000-0000-4000-8000-000000000001",
    exportedAt: timestamp,
    generator: { name: "OpenSubLists" as const, version: "0.1.0" },
    profile: {
      displayName: "Owner",
      timezone: "Asia/Shanghai",
      defaultCurrency: "CNY",
    },
    categories: [
      {
        id: CATEGORY_ID,
        name: "Work",
        color: "#4F7CFF",
        position: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    paymentMethods: [
      {
        id: PAYMENT_METHOD_ID,
        name: "Visa",
        kind: "card" as const,
        label: "ending 1234",
        position: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    subscriptions: [
      {
        id: ACTIVE_USD_ID,
        name: "Cloud, Pro",
        amount: "9.990000",
        currency: "USD",
        recurrence: {
          unit: "month" as const,
          count: 1,
          anchorOn: "2026-08-31",
          anchorMode: "calendar_day" as const,
        },
        status: "active" as const,
        cancelledAt: null,
        archivedAt: null,
        categoryId: CATEGORY_ID,
        paymentMethodId: PAYMENT_METHOD_ID,
        websiteUrl: "https://example.com",
        notes: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: CANCELLED_USD_ID,
        name: "Old tool",
        amount: "0.010000",
        currency: "USD",
        recurrence: {
          unit: "year" as const,
          count: 1,
          anchorOn: "2025-01-15",
          anchorMode: "calendar_day" as const,
        },
        status: "cancelled" as const,
        cancelledAt: "2026-01-01T00:00:00.000Z",
        archivedAt: "2026-01-02T00:00:00.000Z",
        categoryId: CATEGORY_ID,
        paymentMethodId: PAYMENT_METHOD_ID,
        websiteUrl: null,
        notes: "Retained for migration verification.",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: ACTIVE_CNY_ID,
        name: "Local service",
        amount: "88.8",
        currency: "CNY",
        recurrence: {
          unit: "month" as const,
          count: 3,
          anchorOn: "2026-08-01",
          anchorMode: "calendar_day" as const,
        },
        status: "active" as const,
        cancelledAt: null,
        archivedAt: null,
        categoryId: null,
        paymentMethodId: null,
        websiteUrl: null,
        notes: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}
