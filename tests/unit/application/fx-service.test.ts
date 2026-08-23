import { describe, expect, it, vi } from "vitest";

import {
  ExchangeRateRefreshService,
  type ExchangeRateProvider,
  type FxSnapshotStore,
} from "../../../src/application/fx-service";
import type { FxSnapshot } from "../../../src/domain";

const current: FxSnapshot = {
  provider: "ecb",
  baseCurrency: "EUR",
  rateDate: "2026-08-21",
  fetchedAt: 1,
  rates: [
    { currency: "EUR", unitsPerEur: "1" },
    { currency: "USD", unitsPerEur: "1.2" },
  ],
};

function provider(rateDate: string): ExchangeRateProvider {
  return {
    fetchLatest: vi.fn(() =>
      Promise.resolve({
        provider: "ecb" as const,
        baseCurrency: "EUR" as const,
        rateDate,
        rates: current.rates,
      }),
    ),
  };
}

describe("exchange-rate refresh service", () => {
  it("replaces an older snapshot with one validated latest snapshot", async () => {
    const replaceFxSnapshot = vi.fn(() => Promise.resolve("replaced" as const));
    const store: FxSnapshotStore = {
      getFxSnapshot: vi.fn(() => Promise.resolve({ ...current, rateDate: "2026-08-20" })),
      replaceFxSnapshot,
    };
    const service = new ExchangeRateRefreshService(store, provider("2026-08-21"), () => 42);

    await expect(service.refresh()).resolves.toMatchObject({ outcome: "updated" });
    expect(replaceFxSnapshot).toHaveBeenCalledWith(expect.objectContaining({ fetchedAt: 42 }));
  });

  it("treats the same or an older provider date as idempotent", async () => {
    const replaceFxSnapshot = vi.fn(() => Promise.resolve("replaced" as const));
    const store: FxSnapshotStore = {
      getFxSnapshot: vi.fn(() => Promise.resolve(current)),
      replaceFxSnapshot,
    };

    await expect(
      new ExchangeRateRefreshService(store, provider("2026-08-21")).refresh(),
    ).resolves.toEqual({ outcome: "unchanged", snapshot: current });
    await expect(
      new ExchangeRateRefreshService(store, provider("2026-08-20")).refresh(),
    ).resolves.toEqual({ outcome: "unchanged", snapshot: current });
    expect(replaceFxSnapshot).not.toHaveBeenCalled();
  });

  it("never mutates storage when the provider fails", async () => {
    const replaceFxSnapshot = vi.fn(() => Promise.resolve("replaced" as const));
    const store: FxSnapshotStore = {
      getFxSnapshot: vi.fn(() => Promise.resolve(current)),
      replaceFxSnapshot,
    };
    const failedProvider: ExchangeRateProvider = {
      fetchLatest: vi.fn(() => Promise.reject(new Error("network down"))),
    };

    await expect(new ExchangeRateRefreshService(store, failedProvider).refresh()).rejects.toThrow(
      "network down",
    );
    expect(replaceFxSnapshot).not.toHaveBeenCalled();
  });
});
