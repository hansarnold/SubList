import { describe, expect, it } from "vitest";

import {
  buildReportingTotals,
  canonicalizePositiveDecimal,
  convertRationalMicros,
  formatRationalMicrosAsAmount,
  makeRational,
  parsePositiveDecimalToRational,
  rateMap,
  type FxSnapshot,
  type ReportingCurrencyTotal,
} from "../../../src/domain";

const freshSnapshot: FxSnapshot = {
  provider: "ecb",
  baseCurrency: "EUR",
  rateDate: "2026-08-21",
  fetchedAt: Date.parse("2026-08-21T16:00:00.000Z"),
  rates: [
    { currency: "EUR", unitsPerEur: "1" },
    { currency: "USD", unitsPerEur: "1.2" },
    { currency: "CNY", unitsPerEur: "8.4" },
  ],
};

function total(
  currency: string,
  monthlyMicros: bigint,
  currentMonthMicros = monthlyMicros,
): ReportingCurrencyTotal {
  return {
    currency,
    monthlyEstimateMicros: makeRational(monthlyMicros),
    annualizedEstimateMicros: makeRational(monthlyMicros * 12n),
    currentMonthAmountMicros: currentMonthMicros,
    currentYearAmountMicros: currentMonthMicros * 12n,
  };
}

describe("exact exchange-rate arithmetic", () => {
  it("parses and canonicalizes finite positive decimals without floating point", () => {
    expect(parsePositiveDecimalToRational("1.2000")).toEqual(makeRational(6n, 5n));
    expect(canonicalizePositiveDecimal("1.2000")).toBe("1.2");
    expect(() => parsePositiveDecimalToRational("0")).toThrowError();
    expect(() => parsePositiveDecimalToRational("1e3")).toThrowError();
  });

  it("converts EUR, foreign, and cross rates in the documented direction", () => {
    const rates = rateMap(freshSnapshot);
    const oneEuro = makeRational(1_000_000n);

    expect(formatRationalMicrosAsAmount(convertRationalMicros(oneEuro, "EUR", "USD", rates))).toBe(
      "1.2",
    );
    expect(
      formatRationalMicrosAsAmount(
        convertRationalMicros(makeRational(1_200_000n), "USD", "EUR", rates),
      ),
    ).toBe("1");
    expect(
      formatRationalMicrosAsAmount(
        convertRationalMicros(makeRational(1_200_000n), "USD", "CNY", rates),
      ),
    ).toBe("8.4");
    expect(
      formatRationalMicrosAsAmount(
        convertRationalMicros(makeRational(8_400_000n), "CNY", "USD", rates),
      ),
    ).toBe("1.2");
  });
});

describe("reporting-currency totals", () => {
  it("combines USD and CNY into CNY while retaining exact aggregation", () => {
    const result = buildReportingTotals(
      [total("USD", 200_000_000n), total("CNY", 98_000_000n)],
      "CNY",
      "2026-08-23",
      freshSnapshot,
    );

    expect(result.state).toBe("fresh");
    expect(result.missingCurrencies).toEqual([]);
    expect(formatRationalMicrosAsAmount(result.monthlyAverageMicros!)).toBe("1498");
    expect(formatRationalMicrosAsAmount(result.annualizedMicros!)).toBe("17976");
  });

  it("needs no provider for empty or same-currency data", () => {
    const empty = buildReportingTotals([], "CNY", "2026-08-23", null);
    const sameCurrency = buildReportingTotals(
      [total("CNY", 98_000_000n)],
      "CNY",
      "2026-08-23",
      null,
    );

    expect(empty.state).toBe("not_needed");
    expect(formatRationalMicrosAsAmount(empty.monthlyAverageMicros!)).toBe("0");
    expect(sameCurrency.state).toBe("not_needed");
    expect(formatRationalMicrosAsAmount(sameCurrency.monthlyAverageMicros!)).toBe("98");
  });

  it("suppresses every combined total and lists all missing currencies", () => {
    const result = buildReportingTotals(
      [total("USD", 200_000_000n), total("CNY", 98_000_000n)],
      "CNY",
      "2026-08-23",
      {
        ...freshSnapshot,
        rates: [{ currency: "EUR", unitsPerEur: "1" }],
      },
    );

    expect(result.state).toBe("unavailable");
    expect(result.missingCurrencies).toEqual(["CNY", "USD"]);
    expect(result.monthlyAverageMicros).toBeNull();
    expect(result.annualizedMicros).toBeNull();
    expect(result.currentMonthChargesMicros).toBeNull();
    expect(result.currentYearChargesMicros).toBeNull();
  });

  it("uses an older complete snapshot with an explicit stale state", () => {
    const result = buildReportingTotals([total("USD", 1_000_000n)], "CNY", "2026-08-23", {
      ...freshSnapshot,
      rateDate: "2026-08-10",
    });

    expect(result.state).toBe("stale");
    expect(formatRationalMicrosAsAmount(result.monthlyAverageMicros!)).toBe("7");
  });
});
