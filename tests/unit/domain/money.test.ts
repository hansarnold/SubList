import { describe, expect, it } from "vitest";

import {
  addNormalizedEstimates,
  assertCurrencyCode,
  calculateNormalizedEstimates,
  formatMicrosAsAmount,
  formatRationalMicrosAsAmount,
  makeRational,
  parseAmountToMicros,
  roundRationalToBigInt,
} from "../../../src/domain";

describe("money conversion", () => {
  it.each([
    ["0", 0],
    ["9.99", 9_990_000],
    ["1200", 1_200_000_000],
    ["0.000001", 1],
    ["1.230000", 1_230_000],
    ["9007199254.740991", Number.MAX_SAFE_INTEGER],
  ])("parses %s without floating-point arithmetic", (input, expected) => {
    expect(parseAmountToMicros(input)).toBe(expected);
  });

  it.each([
    "",
    " 1",
    "1 ",
    "+1",
    "-0",
    "-1",
    "01",
    ".5",
    "1.",
    "1.0000001",
    "1e3",
    "1,000",
    "9007199254.740992",
  ])("rejects non-canonical or out-of-range amount %s", (input) => {
    expect(() => parseAmountToMicros(input)).toThrowError();
  });

  it.each([
    [0, "0"],
    [9_990_000, "9.99"],
    [1_230_000, "1.23"],
    [1, "0.000001"],
    [Number.MAX_SAFE_INTEGER, "9007199254.740991"],
    [9_990_000_000_000_000n, "9990000000"],
  ])("formats %s micro-units canonically", (input, expected) => {
    expect(formatMicrosAsAmount(input)).toBe(expected);
  });

  it("accepts supported uppercase ISO 4217 codes only", () => {
    expect(assertCurrencyCode("USD")).toBe("USD");
    expect(assertCurrencyCode("CNY")).toBe("CNY");
    expect(() => assertCurrencyCode("usd")).toThrowError();
    expect(() => assertCurrencyCode("ZZZ")).toThrowError();
  });
});

describe("exact rational money", () => {
  it("uses half-away-from-zero rounding at the final boundary", () => {
    expect(roundRationalToBigInt(makeRational(1n, 2n))).toBe(1n);
    expect(roundRationalToBigInt(makeRational(4n, 10n))).toBe(0n);
    expect(roundRationalToBigInt(makeRational(-1n, 2n))).toBe(-1n);
  });

  it("uses the exact Gregorian annualization ratios", () => {
    const daily = calculateNormalizedEstimates(400, "day", 1);
    expect(daily.annualizedEstimateMicros).toEqual(makeRational(146_097n));
    expect(daily.monthlyEstimateMicros).toEqual(makeRational(146_097n, 12n));

    const weekly = calculateNormalizedEstimates(2_800, "week", 1);
    expect(weekly.annualizedEstimateMicros).toEqual(makeRational(146_097n));
  });

  it("normalizes monthly and yearly intervals exactly", () => {
    const everyThreeMonths = calculateNormalizedEstimates(9_000_000, "month", 3);
    expect(formatRationalMicrosAsAmount(everyThreeMonths.annualizedEstimateMicros)).toBe("36");
    expect(formatRationalMicrosAsAmount(everyThreeMonths.monthlyEstimateMicros)).toBe("3");

    const everyTwoYears = calculateNormalizedEstimates(10_000_000, "year", 2);
    expect(formatRationalMicrosAsAmount(everyTwoYears.annualizedEstimateMicros)).toBe("5");
  });

  it("aggregates exact values before rounding", () => {
    const halfMicro = calculateNormalizedEstimates(1, "year", 2);
    const combined = addNormalizedEstimates(halfMicro, halfMicro);

    expect(combined.annualizedEstimateMicros).toEqual(makeRational(1n));
    expect(formatRationalMicrosAsAmount(combined.annualizedEstimateMicros)).toBe("0.000001");
  });
});
