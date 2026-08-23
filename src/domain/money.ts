import { DomainValidationError } from "./errors";
import supportedCurrencies from "../shared/supported-currencies.json" with { type: "json" };

export const MICROS_PER_UNIT = 1_000_000n;
export const MAX_PERSISTED_MICROS = BigInt(Number.MAX_SAFE_INTEGER);

export type CurrencyCode = string;

export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

const CANONICAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,6}))?$/;
const POSITIVE_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;
const MAX_RATE_DECIMAL_LENGTH = 64;

// ISO 4217 active currencies and commonly used ISO fund/metal/testing codes.
const SUPPORTED_CURRENCIES = new Set(supportedCurrencies);

export function assertPersistedMicros(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainValidationError(
      "INVALID_AMOUNT",
      "Money micro-units must be a non-negative safe integer.",
      "amount",
    );
  }

  return value;
}

export function parseAmountToMicros(amount: string): number {
  const match = CANONICAL_AMOUNT_PATTERN.exec(amount);
  if (!match) {
    throw new DomainValidationError(
      "INVALID_AMOUNT",
      "Use a non-negative canonical decimal with no more than six fractional digits.",
      "amount",
    );
  }

  const decimalSeparator = amount.indexOf(".");
  const wholePart = decimalSeparator === -1 ? amount : amount.slice(0, decimalSeparator);
  const fractionPart = decimalSeparator === -1 ? "" : amount.slice(decimalSeparator + 1);
  const micros = BigInt(wholePart) * MICROS_PER_UNIT + BigInt(fractionPart.padEnd(6, "0"));

  if (micros > MAX_PERSISTED_MICROS) {
    throw new DomainValidationError(
      "INVALID_AMOUNT",
      "The amount exceeds the maximum supported value.",
      "amount",
    );
  }

  return Number(micros);
}

export function formatMicrosAsAmount(micros: number | bigint): string {
  const exactMicros = typeof micros === "bigint" ? micros : BigInt(assertPersistedMicros(micros));

  if (exactMicros < 0n) {
    throw new DomainValidationError(
      "INVALID_AMOUNT",
      "Money micro-units must not be negative.",
      "amount",
    );
  }

  const wholePart = exactMicros / MICROS_PER_UNIT;
  const fractionPart = (exactMicros % MICROS_PER_UNIT)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");

  return fractionPart.length === 0 ? wholePart.toString() : `${wholePart}.${fractionPart}`;
}

export function isSupportedCurrencyCode(value: string): value is CurrencyCode {
  return /^[A-Z]{3}$/.test(value) && SUPPORTED_CURRENCIES.has(value);
}

export function assertCurrencyCode(value: string): CurrencyCode {
  if (!isSupportedCurrencyCode(value)) {
    throw new DomainValidationError(
      "INVALID_CURRENCY",
      "Use a supported uppercase ISO 4217 currency code.",
      "currency",
    );
  }

  return value;
}

export function makeRational(numerator: bigint, denominator: bigint = 1n): Rational {
  if (denominator === 0n) {
    throw new RangeError("A rational denominator cannot be zero.");
  }

  const sign = denominator < 0n ? -1n : 1n;
  const signedNumerator = numerator * sign;
  const positiveDenominator = denominator * sign;
  const divisor = greatestCommonDivisor(absolute(signedNumerator), positiveDenominator);

  return {
    numerator: signedNumerator / divisor,
    denominator: positiveDenominator / divisor,
  };
}

export function addRationals(left: Rational, right: Rational): Rational {
  return makeRational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function multiplyRationals(left: Rational, right: Rational): Rational {
  return makeRational(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function divideRationals(left: Rational, right: Rational): Rational {
  if (right.numerator === 0n) {
    throw new RangeError("A rational divisor cannot be zero.");
  }

  return makeRational(left.numerator * right.denominator, left.denominator * right.numerator);
}

export function parsePositiveDecimalToRational(value: string): Rational {
  if (value.length > MAX_RATE_DECIMAL_LENGTH || !POSITIVE_DECIMAL_PATTERN.test(value)) {
    throw new DomainValidationError(
      "INVALID_EXCHANGE_RATE",
      "Exchange rates must be positive canonical decimal strings.",
      "rate",
    );
  }

  const [whole = "0", fraction = ""] = value.split(".");
  const numerator = BigInt(whole) * 10n ** BigInt(fraction.length) + BigInt(fraction || "0");
  if (numerator <= 0n) {
    throw new DomainValidationError(
      "INVALID_EXCHANGE_RATE",
      "Exchange rates must be greater than zero.",
      "rate",
    );
  }

  return makeRational(numerator, 10n ** BigInt(fraction.length));
}

export function canonicalizePositiveDecimal(value: string): string {
  parsePositiveDecimalToRational(value);
  const [whole = "0", fraction = ""] = value.split(".");
  const canonicalFraction = fraction.replace(/0+$/, "");
  return canonicalFraction.length === 0 ? whole : `${whole}.${canonicalFraction}`;
}

export function divideRational(value: Rational, divisor: bigint): Rational {
  if (divisor === 0n) {
    throw new RangeError("A rational divisor cannot be zero.");
  }

  return makeRational(value.numerator, value.denominator * divisor);
}

export function roundRationalToBigInt(value: Rational): bigint {
  const quotient = value.numerator / value.denominator;
  const remainder = value.numerator % value.denominator;

  if (absolute(remainder) * 2n < value.denominator) {
    return quotient;
  }

  return quotient + (value.numerator < 0n ? -1n : 1n);
}

export function formatRationalMicrosAsAmount(value: Rational): string {
  return formatMicrosAsAmount(roundRationalToBigInt(value));
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;

  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a === 0n ? 1n : a;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
