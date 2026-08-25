import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type {
  CategoryWrite,
  ImportMutation,
  PaymentMethodWrite,
  SubscriptionWrite,
} from "../../src/application/ports";
import type { FxSnapshot } from "../../src/domain";
import { D1OpenSubListsRepository } from "../../src/worker/db/repository";

const migrations = inject("migrations");

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM fx_snapshot"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

describe("refactored D1 repository", () => {
  it("persists reporting currency and completes onboarding idempotently", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(localIdentity("profile"), 10);
    expect(user).toMatchObject({
      reportingCurrency: "USD",
      onboardingCompletedAt: null,
    });

    const updated = await repository.updateUser(user.id, { reportingCurrency: "CNY" }, 20);
    expect(updated).toMatchObject({ reportingCurrency: "CNY", updatedAt: 20 });

    const completed = await repository.completeOnboarding(user.id, 30);
    const repeated = await repository.completeOnboarding(user.id, 40);
    expect(completed).toMatchObject({ onboardingCompletedAt: 30, updatedAt: 30 });
    expect(repeated).toMatchObject({ onboardingCompletedAt: 30, updatedAt: 30 });
    expect(await repository.completeOnboarding("missing-user", 50)).toBeNull();
  });

  it("creates bounded category batches atomically and keeps them tenant scoped", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const tenantA = await repository.resolveUser(localIdentity("batch-a"), 1);
    const tenantB = await repository.resolveUser(localIdentity("batch-b"), 1);
    const first = categoryWrite("10000000-0000-4000-8000-000000000001", "Productivity", 0, {
      type: "icon",
      value: "briefcase",
    });
    const second = categoryWrite("10000000-0000-4000-8000-000000000002", "Utilities", 1, {
      type: "emoji",
      value: "⚡",
    });

    expect(await repository.createCategories(tenantA.id, [first, second])).toEqual([first, second]);
    expect(await repository.listCategories(tenantA.id)).toMatchObject([
      { name: "Productivity", symbol: { type: "icon", value: "briefcase" } },
      { name: "Utilities", symbol: { type: "emoji", value: "⚡" } },
    ]);
    expect(await repository.listCategories(tenantB.id)).toEqual([]);

    const fresh = categoryWrite(
      "10000000-0000-4000-8000-000000000003",
      "Should roll back",
      2,
      null,
    );
    const conflicting = categoryWrite(
      "10000000-0000-4000-8000-000000000004",
      "Duplicate productivity",
      3,
      null,
      "productivity",
    );
    await expect(repository.createCategories(tenantA.id, [fresh, conflicting])).rejects.toThrow();
    expect(await repository.getCategory(tenantA.id, fresh.id)).toBeNull();
    expect(await repository.listCategories(tenantA.id)).toHaveLength(2);

    await expect(
      repository.createCategories(
        tenantA.id,
        Array.from({ length: 14 }, (_, index) =>
          categoryWrite(
            `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            `Category ${index}`,
            index,
            null,
          ),
        ),
      ),
    ).rejects.toThrow(RangeError);
  });

  it("round-trips symbols through CRUD and Dashboard joins", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(localIdentity("symbols"), 1);
    const category = categoryWrite("30000000-0000-4000-8000-000000000001", "Cloud", 0, {
      type: "icon",
      value: "cloud",
    });
    const paymentMethod = paymentMethodWrite("30000000-0000-4000-8000-000000000002", "Visa", {
      type: "icon",
      value: "brand_visa",
    });
    const subscription = subscriptionWrite(
      "30000000-0000-4000-8000-000000000003",
      category.id,
      paymentMethod.id,
      { type: "emoji", value: "✨" },
    );

    await repository.createCategory(user.id, category);
    await repository.createPaymentMethod(user.id, paymentMethod);
    await repository.createSubscription(user.id, subscription);

    expect(await repository.listDashboardSubscriptions(user.id)).toMatchObject([
      {
        symbol: { type: "emoji", value: "✨" },
        category: { symbol: { type: "icon", value: "cloud" } },
        paymentMethod: { kind: "card", symbol: { type: "icon", value: "brand_visa" } },
      },
    ]);

    expect(
      await repository.updateCategory(user.id, category.id, { symbol: null }, 5),
    ).toMatchObject({
      symbol: null,
    });
    expect(
      await repository.updatePaymentMethod(
        user.id,
        paymentMethod.id,
        { symbol: { type: "emoji", value: "💳" } },
        5,
      ),
    ).toMatchObject({ symbol: { type: "emoji", value: "💳" } });
    expect(
      await repository.updateSubscription(
        user.id,
        {
          ...subscription,
          symbol: { type: "icon", value: "subscriptions" },
          updatedAt: 5,
        },
        subscription.updatedAt,
        subscription.emailReminderRevision,
      ),
    ).toMatchObject({ symbol: { type: "icon", value: "subscriptions" } });
  });

  it("preserves symbols and reporting currency through import inserts and overwrites", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(localIdentity("import"), 1);
    const category = categoryWrite("40000000-0000-4000-8000-000000000001", "Imported category", 0, {
      type: "emoji",
      value: "📚",
    });
    const paymentMethod = paymentMethodWrite(
      "40000000-0000-4000-8000-000000000002",
      "Imported card",
      { type: "icon", value: "credit_card" },
    );
    const subscription = subscriptionWrite(
      "40000000-0000-4000-8000-000000000003",
      category.id,
      paymentMethod.id,
      { type: "icon", value: "book" },
    );

    await repository.applyImport(
      user.id,
      await importGuard(repository, user.id),
      importMutations("insert", category, paymentMethod, subscription),
      {
        displayName: "Imported",
        timezone: "Asia/Shanghai",
        reportingCurrency: "CNY",
        preferredLocale: "en",
        defaultEmailReminderDaysBefore: 7,
        emailReminderLocalTime: "09:00",
        emailRemindersPaused: false,
      },
      [],
      10,
      false,
    );
    expect(await repository.getUser(user.id)).toMatchObject({
      displayName: "Imported",
      timezone: "Asia/Shanghai",
      reportingCurrency: "CNY",
    });
    expect(await repository.getCategory(user.id, category.id)).toMatchObject({
      symbol: { type: "emoji", value: "📚" },
    });
    expect(await repository.getPaymentMethod(user.id, paymentMethod.id)).toMatchObject({
      symbol: { type: "icon", value: "credit_card" },
    });
    expect(await repository.getSubscription(user.id, subscription.id)).toMatchObject({
      symbol: { type: "icon", value: "book" },
    });

    await repository.applyImport(
      user.id,
      await importGuard(repository, user.id),
      importMutations(
        "overwrite",
        { ...category, symbol: null },
        { ...paymentMethod, symbol: { type: "emoji", value: "💰" } },
        { ...subscription, symbol: null },
      ),
      null,
      [],
      20,
      false,
    );
    expect(await repository.getCategory(user.id, category.id)).toMatchObject({ symbol: null });
    expect(await repository.getPaymentMethod(user.id, paymentMethod.id)).toMatchObject({
      symbol: { type: "emoji", value: "💰" },
    });
    expect(await repository.getSubscription(user.id, subscription.id)).toMatchObject({
      symbol: null,
    });
  });

  it("atomically replaces and validates the singleton FX snapshot", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const first: FxSnapshot = {
      provider: "ecb",
      rateDate: "2026-08-21",
      baseCurrency: "EUR",
      fetchedAt: 100,
      rates: [
        { currency: "EUR", unitsPerEur: "1" },
        { currency: "USD", unitsPerEur: "1.0800" },
      ],
    };

    expect(await repository.replaceFxSnapshot(first)).toBe("replaced");
    expect(await repository.getFxSnapshot()).toEqual({
      ...first,
      rates: [
        { currency: "EUR", unitsPerEur: "1" },
        { currency: "USD", unitsPerEur: "1.08" },
      ],
    });
    expect(
      await repository.replaceFxSnapshot({ ...first, fetchedAt: 200, rates: first.rates }),
    ).toBe("unchanged");
    expect(
      await repository.replaceFxSnapshot({ ...first, rateDate: "2026-08-20", fetchedAt: 300 }),
    ).toBe("unchanged");

    const second: FxSnapshot = {
      ...first,
      rateDate: "2026-08-22",
      fetchedAt: 400,
      rates: [
        { currency: "CNY", unitsPerEur: "7.8" },
        { currency: "EUR", unitsPerEur: "1" },
      ],
    };
    expect(await repository.replaceFxSnapshot(second)).toBe("replaced");
    expect(await repository.getFxSnapshot()).toEqual(second);

    await expect(
      repository.replaceFxSnapshot({
        ...second,
        rateDate: "2026-08-23",
        rates: [{ currency: "CNY", unitsPerEur: "7.9" }],
      }),
    ).rejects.toThrow();
    expect(await repository.getFxSnapshot()).toEqual(second);
  });

  it("prevents an older concurrent FX writer from replacing a newer snapshot", async () => {
    const newer = fxSnapshot("2026-08-23", 500, "1.09");
    const older = fxSnapshot("2026-08-22", 600, "1.07");

    const result = await runOrderedConcurrentFxWrites(newer, older);

    expect(result.outcomes).toEqual(["replaced", "unchanged"]);
    expect(result.snapshot).toEqual(newer);
  });

  it("keeps the first completed snapshot when concurrent writers publish the same date", async () => {
    const first = fxSnapshot("2026-08-23", 500, "1.09");
    const sameDate = fxSnapshot("2026-08-23", 600, "1.07");

    const result = await runOrderedConcurrentFxWrites(first, sameDate);

    expect(result.outcomes).toEqual(["replaced", "unchanged"]);
    expect(result.snapshot).toEqual(first);
  });
});

async function runOrderedConcurrentFxWrites(first: FxSnapshot, second: FxSnapshot) {
  let batchArrivals = 0;
  let releaseBothBatches!: () => void;
  let releaseFirstBatch!: () => void;
  const bothBatchesReady = new Promise<void>((resolve) => {
    releaseBothBatches = resolve;
  });
  const firstBatchFinished = new Promise<void>((resolve) => {
    releaseFirstBatch = resolve;
  });

  const gatedDatabase = (position: "first" | "second"): D1Database =>
    new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch") {
          return async <T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
            batchArrivals += 1;
            if (batchArrivals === 2) releaseBothBatches();
            await bothBatchesReady;
            if (position === "second") await firstBatchFinished;
            try {
              return await target.batch<T>(statements);
            } finally {
              if (position === "first") releaseFirstBatch();
            }
          };
        }
        if (property === "prepare") return target.prepare.bind(target);
        throw new Error(`Unexpected D1 database property access: ${String(property)}`);
      },
    });

  const firstRepository = new D1OpenSubListsRepository(gatedDatabase("first"));
  const secondRepository = new D1OpenSubListsRepository(gatedDatabase("second"));
  const outcomes = await Promise.all([
    firstRepository.replaceFxSnapshot(first),
    secondRepository.replaceFxSnapshot(second),
  ]);

  return {
    outcomes,
    snapshot: await new D1OpenSubListsRepository(env.DB).getFxSnapshot(),
  };
}

async function importGuard(repository: D1OpenSubListsRepository, userId: string) {
  const [user, state] = await Promise.all([
    repository.getUser(userId),
    repository.getImportState(userId),
  ]);
  if (user === null) throw new Error("Import test user was not found.");
  return { user, resourceRevision: state.resourceRevision };
}

function fxSnapshot(rateDate: string, fetchedAt: number, usdRate: string): FxSnapshot {
  return {
    provider: "ecb",
    rateDate,
    baseCurrency: "EUR",
    fetchedAt,
    rates: [
      { currency: "EUR", unitsPerEur: "1" },
      { currency: "USD", unitsPerEur: usdRate },
    ],
  };
}

function localIdentity(key: string) {
  return {
    provider: "local_development" as const,
    subject: key,
    email: `${key}@example.invalid`,
  };
}

function categoryWrite(
  id: string,
  name: string,
  position: number,
  symbol: CategoryWrite["symbol"],
  nameKey = name.toLowerCase(),
): CategoryWrite {
  return {
    id,
    name,
    nameKey,
    color: "#123456",
    symbol,
    position,
    createdAt: 1,
    updatedAt: 1,
  };
}

function paymentMethodWrite(
  id: string,
  name: string,
  symbol: PaymentMethodWrite["symbol"],
): PaymentMethodWrite {
  return {
    id,
    name,
    kind: "card",
    label: "ending 1234",
    symbol,
    position: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function subscriptionWrite(
  id: string,
  categoryId: string,
  paymentMethodId: string,
  symbol: SubscriptionWrite["symbol"],
): SubscriptionWrite {
  return {
    id,
    name: "Imported subscription",
    amountMicros: 9_990_000,
    currency: "USD",
    recurrence: {
      unit: "month",
      count: 1,
      anchorOn: "2026-08-23",
      anchorMode: "calendar_day",
    },
    nextBillingOn: "2026-08-23",
    status: "active",
    cancelledAt: null,
    archivedAt: null,
    categoryId,
    paymentMethodId,
    symbol,
    websiteUrl: null,
    notes: null,
    emailReminderEnabled: false,
    emailReminderDaysBefore: null,
    emailReminderRevision: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function importMutations(
  kind: ImportMutation["kind"],
  category: CategoryWrite,
  paymentMethod: PaymentMethodWrite,
  subscription: SubscriptionWrite,
): ImportMutation[] {
  return [
    { kind, category },
    { kind, paymentMethod },
    { kind, subscription },
  ];
}
