import {
  assertIsoCalendarDate,
  differenceInCalendarDays,
  type IsoCalendarDate,
} from "./calendar-date";
import { DomainValidationError } from "./errors";
import {
  addRationals,
  assertCurrencyCode,
  divideRationals,
  makeRational,
  multiplyRationals,
  parsePositiveDecimalToRational,
  type CurrencyCode,
  type Rational,
} from "./money";

export const FX_SNAPSHOT_FRESH_DAYS = 7;

export type FxProvider = "ecb";
export type FxState = "not_needed" | "fresh" | "stale" | "unavailable";

export interface FxRate {
  readonly currency: CurrencyCode;
  readonly unitsPerEur: string;
}

export interface FxSnapshot {
  readonly provider: FxProvider;
  readonly rateDate: IsoCalendarDate;
  readonly baseCurrency: "EUR";
  readonly fetchedAt: number;
  readonly rates: readonly FxRate[];
}

export interface ReportingCurrencyTotal {
  readonly currency: CurrencyCode;
  readonly monthlyEstimateMicros: Rational;
  readonly annualizedEstimateMicros: Rational;
  readonly currentMonthAmountMicros: bigint;
  readonly currentYearAmountMicros: bigint;
}

export interface ExactReportingTotals {
  readonly state: FxState;
  readonly missingCurrencies: CurrencyCode[];
  readonly monthlyAverageMicros: Rational | null;
  readonly annualizedMicros: Rational | null;
  readonly currentMonthChargesMicros: Rational | null;
  readonly currentYearChargesMicros: Rational | null;
}

export function assertFxSnapshot(snapshot: FxSnapshot): FxSnapshot {
  if (snapshot.provider !== "ecb" || snapshot.baseCurrency !== "EUR") {
    throw invalidSnapshot("The exchange-rate snapshot provider or base currency is invalid.");
  }
  assertIsoCalendarDate(snapshot.rateDate);
  if (!Number.isSafeInteger(snapshot.fetchedAt) || snapshot.fetchedAt < 0) {
    throw invalidSnapshot("The exchange-rate fetch timestamp is invalid.");
  }
  if (snapshot.rates.length === 0) {
    throw invalidSnapshot("The exchange-rate snapshot must contain rates.");
  }

  const currencies = new Set<CurrencyCode>();
  for (const rate of snapshot.rates) {
    assertCurrencyCode(rate.currency);
    parsePositiveDecimalToRational(rate.unitsPerEur);
    if (currencies.has(rate.currency)) {
      throw invalidSnapshot(`The exchange-rate snapshot repeats ${rate.currency}.`);
    }
    currencies.add(rate.currency);
  }

  const eur = snapshot.rates.find((rate) => rate.currency === "EUR");
  if (eur === undefined || eur.unitsPerEur !== "1") {
    throw invalidSnapshot("The exchange-rate snapshot must contain EUR with a rate of 1.");
  }

  return snapshot;
}

export function convertRationalMicros(
  amountMicros: Rational,
  sourceCurrency: CurrencyCode,
  reportingCurrency: CurrencyCode,
  rates: ReadonlyMap<CurrencyCode, Rational>,
): Rational {
  assertCurrencyCode(sourceCurrency);
  assertCurrencyCode(reportingCurrency);
  if (sourceCurrency === reportingCurrency) return amountMicros;

  const sourceRate = rates.get(sourceCurrency);
  const reportingRate = rates.get(reportingCurrency);
  if (sourceRate === undefined || reportingRate === undefined) {
    throw new DomainValidationError(
      "MISSING_EXCHANGE_RATE",
      `A conversion rate is missing for ${
        sourceRate === undefined ? sourceCurrency : reportingCurrency
      }.`,
      "currency",
    );
  }

  return multiplyRationals(divideRationals(amountMicros, sourceRate), reportingRate);
}

export function buildReportingTotals(
  totals: readonly ReportingCurrencyTotal[],
  reportingCurrency: CurrencyCode,
  localToday: IsoCalendarDate,
  snapshot: FxSnapshot | null,
): ExactReportingTotals {
  assertCurrencyCode(reportingCurrency);
  assertIsoCalendarDate(localToday);

  const requiresConversion = totals.some((total) => total.currency !== reportingCurrency);
  if (!requiresConversion) {
    return completeReportingTotals("not_needed", totals, reportingCurrency, identityRates());
  }

  if (snapshot === null) {
    return unavailableReportingTotals(requiredCurrencies(totals, reportingCurrency));
  }

  assertFxSnapshot(snapshot);
  const rates = rateMap(snapshot);
  const missingCurrencies = requiredCurrencies(totals, reportingCurrency).filter(
    (currency) => !rates.has(currency),
  );
  if (missingCurrencies.length > 0) {
    return unavailableReportingTotals(missingCurrencies);
  }

  const ageInDays = differenceInCalendarDays(snapshot.rateDate, localToday);
  return completeReportingTotals(
    ageInDays <= FX_SNAPSHOT_FRESH_DAYS ? "fresh" : "stale",
    totals,
    reportingCurrency,
    rates,
  );
}

export function rateMap(snapshot: FxSnapshot): ReadonlyMap<CurrencyCode, Rational> {
  assertFxSnapshot(snapshot);
  return new Map(
    snapshot.rates.map((rate) => [rate.currency, parsePositiveDecimalToRational(rate.unitsPerEur)]),
  );
}

function completeReportingTotals(
  state: Exclude<FxState, "unavailable">,
  totals: readonly ReportingCurrencyTotal[],
  reportingCurrency: CurrencyCode,
  rates: ReadonlyMap<CurrencyCode, Rational>,
): ExactReportingTotals {
  let monthlyAverageMicros = makeRational(0n);
  let annualizedMicros = makeRational(0n);
  let currentMonthChargesMicros = makeRational(0n);
  let currentYearChargesMicros = makeRational(0n);

  for (const total of totals) {
    monthlyAverageMicros = addRationals(
      monthlyAverageMicros,
      convertRationalMicros(total.monthlyEstimateMicros, total.currency, reportingCurrency, rates),
    );
    annualizedMicros = addRationals(
      annualizedMicros,
      convertRationalMicros(
        total.annualizedEstimateMicros,
        total.currency,
        reportingCurrency,
        rates,
      ),
    );
    currentMonthChargesMicros = addRationals(
      currentMonthChargesMicros,
      convertRationalMicros(
        makeRational(total.currentMonthAmountMicros),
        total.currency,
        reportingCurrency,
        rates,
      ),
    );
    currentYearChargesMicros = addRationals(
      currentYearChargesMicros,
      convertRationalMicros(
        makeRational(total.currentYearAmountMicros),
        total.currency,
        reportingCurrency,
        rates,
      ),
    );
  }

  return {
    state,
    missingCurrencies: [],
    monthlyAverageMicros,
    annualizedMicros,
    currentMonthChargesMicros,
    currentYearChargesMicros,
  };
}

function unavailableReportingTotals(missingCurrencies: CurrencyCode[]): ExactReportingTotals {
  return {
    state: "unavailable",
    missingCurrencies,
    monthlyAverageMicros: null,
    annualizedMicros: null,
    currentMonthChargesMicros: null,
    currentYearChargesMicros: null,
  };
}

function requiredCurrencies(
  totals: readonly ReportingCurrencyTotal[],
  reportingCurrency: CurrencyCode,
): CurrencyCode[] {
  const currencies = new Set<CurrencyCode>();
  for (const total of totals) {
    if (total.currency !== reportingCurrency) currencies.add(total.currency);
  }
  if (currencies.size > 0) currencies.add(reportingCurrency);
  currencies.delete("EUR");
  return [...currencies].sort();
}

function identityRates(): ReadonlyMap<CurrencyCode, Rational> {
  return new Map<CurrencyCode, Rational>();
}

function invalidSnapshot(message: string): DomainValidationError {
  return new DomainValidationError("INVALID_EXCHANGE_RATE", message, "fx");
}
