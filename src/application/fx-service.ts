import { assertFxSnapshot, compareIsoCalendarDates, type FxRate, type FxSnapshot } from "../domain";

export interface ExchangeRateProviderSnapshot {
  readonly provider: "ecb";
  readonly rateDate: string;
  readonly baseCurrency: "EUR";
  readonly rates: readonly FxRate[];
}

export interface ExchangeRateProvider {
  fetchLatest(): Promise<ExchangeRateProviderSnapshot>;
}

export interface FxSnapshotStore {
  getFxSnapshot(): Promise<FxSnapshot | null>;
  replaceFxSnapshot(snapshot: FxSnapshot): Promise<"replaced" | "unchanged">;
}

export type FxRefreshResult = {
  readonly outcome: "updated" | "unchanged";
  readonly snapshot: FxSnapshot;
};

export class ExchangeRateRefreshService {
  constructor(
    private readonly store: FxSnapshotStore,
    private readonly provider: ExchangeRateProvider,
    private readonly now: () => number = Date.now,
  ) {}

  async refresh(): Promise<FxRefreshResult> {
    const providerSnapshot = await this.provider.fetchLatest();
    const snapshot = assertFxSnapshot({
      ...providerSnapshot,
      fetchedAt: this.now(),
    });
    const current = await this.store.getFxSnapshot();
    if (current !== null && compareIsoCalendarDates(current.rateDate, snapshot.rateDate) >= 0) {
      return { outcome: "unchanged", snapshot: current };
    }

    const outcome = await this.store.replaceFxSnapshot(snapshot);
    if (outcome === "unchanged") {
      return { outcome: "unchanged", snapshot: (await this.store.getFxSnapshot()) ?? snapshot };
    }
    return { outcome: "updated", snapshot };
  }
}
