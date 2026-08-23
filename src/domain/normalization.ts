import { DomainValidationError } from "./errors";
import { addRationals, assertPersistedMicros, makeRational, type Rational } from "./money";
import type { RecurrenceUnit } from "./recurrence";

export interface NormalizedEstimates {
  readonly annualizedEstimateMicros: Rational;
  readonly monthlyEstimateMicros: Rational;
}

export const ZERO_NORMALIZED_ESTIMATES: NormalizedEstimates = {
  annualizedEstimateMicros: makeRational(0n),
  monthlyEstimateMicros: makeRational(0n),
};

export function calculateNormalizedEstimates(
  amountMicros: number,
  recurrenceUnit: RecurrenceUnit,
  recurrenceCount: number,
): NormalizedEstimates {
  assertPersistedMicros(amountMicros);

  if (!Number.isInteger(recurrenceCount) || recurrenceCount < 1 || recurrenceCount > 1_200) {
    throw new DomainValidationError(
      "INVALID_RECURRENCE",
      "Recurrence count must be an integer between 1 and 1200.",
      "recurrence.count",
    );
  }

  const amount = BigInt(amountMicros);
  const count = BigInt(recurrenceCount);
  let annualizedEstimateMicros: Rational;

  switch (recurrenceUnit) {
    case "day":
      annualizedEstimateMicros = makeRational(amount * 146_097n, 400n * count);
      break;
    case "week":
      annualizedEstimateMicros = makeRational(amount * 146_097n, 2_800n * count);
      break;
    case "month":
      annualizedEstimateMicros = makeRational(amount * 12n, count);
      break;
    case "year":
      annualizedEstimateMicros = makeRational(amount, count);
      break;
    default:
      throw new DomainValidationError(
        "INVALID_RECURRENCE",
        "Unknown recurrence unit.",
        "recurrence.unit",
      );
  }

  return {
    annualizedEstimateMicros,
    monthlyEstimateMicros: makeRational(
      annualizedEstimateMicros.numerator,
      annualizedEstimateMicros.denominator * 12n,
    ),
  };
}

export function addNormalizedEstimates(
  left: NormalizedEstimates,
  right: NormalizedEstimates,
): NormalizedEstimates {
  return {
    annualizedEstimateMicros: addRationals(
      left.annualizedEstimateMicros,
      right.annualizedEstimateMicros,
    ),
    monthlyEstimateMicros: addRationals(left.monthlyEstimateMicros, right.monthlyEstimateMicros),
  };
}
