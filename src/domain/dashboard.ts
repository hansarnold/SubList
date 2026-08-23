import {
  addCalendarDays,
  assertIsoCalendarDate,
  compareIsoCalendarDates,
  type IsoCalendarDate,
} from "./calendar-date";
import { DomainValidationError } from "./errors";
import {
  assertCurrencyCode,
  assertPersistedMicros,
  makeRational,
  type CurrencyCode,
  type Rational,
} from "./money";
import {
  addNormalizedEstimates,
  calculateNormalizedEstimates,
  ZERO_NORMALIZED_ESTIMATES,
  type NormalizedEstimates,
} from "./normalization";
import {
  assertRecurrenceRule,
  nextOccurrenceOnOrAfter,
  projectOccurrences,
  type RecurrenceRule,
  type SubscriptionStatus,
} from "./recurrence";

export interface DashboardCategory {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface DashboardPaymentMethod {
  readonly id: string;
  readonly name: string;
}

export interface DashboardSubscription {
  readonly id: string;
  readonly name: string;
  readonly amountMicros: number;
  readonly currency: CurrencyCode;
  readonly recurrence: RecurrenceRule;
  readonly status: SubscriptionStatus;
  readonly archivedAt: number | null;
  readonly category: DashboardCategory | null;
  readonly paymentMethod: DashboardPaymentMethod | null;
}

export interface DashboardOccurrence {
  readonly subscriptionId: string;
  readonly name: string;
  readonly amountMicros: number;
  readonly currency: CurrencyCode;
  readonly billingOn: IsoCalendarDate;
  readonly category: DashboardCategory | null;
  readonly paymentMethod: DashboardPaymentMethod | null;
}

export interface ExactCurrencyTotals {
  readonly currency: CurrencyCode;
  readonly monthlyEstimateMicros: Rational;
  readonly annualizedEstimateMicros: Rational;
  readonly upcomingAmountMicros: bigint;
}

export interface DashboardBreakdown {
  readonly id: string | null;
  readonly name: string | null;
  readonly color: string | null;
  readonly subscriptionCount: number;
  readonly totalsByCurrency: ExactCurrencyTotals[];
}

export interface DashboardStatistics {
  readonly localToday: IsoCalendarDate;
  readonly upcomingThrough: IsoCalendarDate;
  readonly nextCharge: DashboardOccurrence | null;
  readonly totalsByCurrency: ExactCurrencyTotals[];
  readonly upcoming: DashboardOccurrence[];
  readonly categoryBreakdown: DashboardBreakdown[];
  readonly paymentMethodBreakdown: DashboardBreakdown[];
}

interface MutableCurrencyTotals extends NormalizedEstimates {
  upcomingAmountMicros: bigint;
}

interface MutableBreakdown {
  readonly id: string | null;
  readonly name: string | null;
  readonly color: string | null;
  subscriptionCount: number;
  readonly totalsByCurrency: Map<CurrencyCode, MutableCurrencyTotals>;
}

export function buildDashboardStatistics(
  subscriptions: readonly DashboardSubscription[],
  localToday: string,
  upcomingDays: number,
): DashboardStatistics {
  assertIsoCalendarDate(localToday);
  if (!Number.isInteger(upcomingDays) || upcomingDays < 1 || upcomingDays > 30) {
    throw new DomainValidationError(
      "INVALID_WINDOW",
      "Upcoming days must be an integer between 1 and 30.",
      "upcomingDays",
    );
  }

  const upcomingThrough = addCalendarDays(localToday, upcomingDays - 1);
  const totals = new Map<CurrencyCode, MutableCurrencyTotals>();
  const categories = new Map<string | null, MutableBreakdown>();
  const paymentMethods = new Map<string | null, MutableBreakdown>();
  const upcoming: DashboardOccurrence[] = [];
  let nextCharge: DashboardOccurrence | null = null;

  for (const subscription of subscriptions) {
    validateSubscription(subscription);
    if (subscription.status !== "active" || subscription.archivedAt !== null) {
      continue;
    }

    const normalized = calculateNormalizedEstimates(
      subscription.amountMicros,
      subscription.recurrence.unit,
      subscription.recurrence.count,
    );
    addEstimateToCurrencyMap(totals, subscription.currency, normalized, 0n);

    const categoryGroup = getOrCreateBreakdown(
      categories,
      subscription.category?.id ?? null,
      subscription.category?.name ?? null,
      subscription.category?.color ?? null,
    );
    addSubscriptionToBreakdown(categoryGroup, subscription.currency, normalized);

    const paymentMethodGroup = getOrCreateBreakdown(
      paymentMethods,
      subscription.paymentMethod?.id ?? null,
      subscription.paymentMethod?.name ?? null,
      null,
    );
    addSubscriptionToBreakdown(paymentMethodGroup, subscription.currency, normalized);

    const nextBillingOn = nextOccurrenceOnOrAfter(subscription.recurrence, localToday);
    const candidateNextCharge = toOccurrence(subscription, nextBillingOn);
    if (nextCharge === null || compareOccurrences(candidateNextCharge, nextCharge) < 0) {
      nextCharge = candidateNextCharge;
    }

    for (const billingOn of projectOccurrences(
      subscription.recurrence,
      localToday,
      upcomingThrough,
      { maxOccurrences: 366 },
    )) {
      const occurrence = toOccurrence(subscription, billingOn);
      upcoming.push(occurrence);
      addEstimateToCurrencyMap(
        totals,
        subscription.currency,
        ZERO_NORMALIZED_ESTIMATES,
        BigInt(subscription.amountMicros),
      );
    }
  }

  upcoming.sort(compareOccurrences);

  return {
    localToday,
    upcomingThrough,
    nextCharge,
    totalsByCurrency: finalizeCurrencyTotals(totals),
    upcoming,
    categoryBreakdown: finalizeBreakdowns(categories),
    paymentMethodBreakdown: finalizeBreakdowns(paymentMethods),
  };
}

function validateSubscription(subscription: DashboardSubscription): void {
  assertPersistedMicros(subscription.amountMicros);
  assertCurrencyCode(subscription.currency);
  assertRecurrenceRule(subscription.recurrence);
  if (subscription.status !== "active" && subscription.status !== "cancelled") {
    throw new DomainValidationError("INVALID_RECURRENCE", "Unknown subscription status.", "status");
  }
}

function toOccurrence(
  subscription: DashboardSubscription,
  billingOn: IsoCalendarDate,
): DashboardOccurrence {
  return {
    subscriptionId: subscription.id,
    name: subscription.name,
    amountMicros: subscription.amountMicros,
    currency: subscription.currency,
    billingOn,
    category: subscription.category,
    paymentMethod: subscription.paymentMethod,
  };
}

function addEstimateToCurrencyMap(
  map: Map<CurrencyCode, MutableCurrencyTotals>,
  currency: CurrencyCode,
  normalized: NormalizedEstimates,
  upcomingAmountMicros: bigint,
): void {
  const current = map.get(currency) ?? {
    ...ZERO_NORMALIZED_ESTIMATES,
    upcomingAmountMicros: 0n,
  };
  const combined = addNormalizedEstimates(current, normalized);
  map.set(currency, {
    ...combined,
    upcomingAmountMicros: current.upcomingAmountMicros + upcomingAmountMicros,
  });
}

function getOrCreateBreakdown(
  map: Map<string | null, MutableBreakdown>,
  id: string | null,
  name: string | null,
  color: string | null,
): MutableBreakdown {
  const existing = map.get(id);
  if (existing) {
    return existing;
  }

  const created: MutableBreakdown = {
    id,
    name,
    color,
    subscriptionCount: 0,
    totalsByCurrency: new Map(),
  };
  map.set(id, created);
  return created;
}

function addSubscriptionToBreakdown(
  breakdown: MutableBreakdown,
  currency: CurrencyCode,
  normalized: NormalizedEstimates,
): void {
  breakdown.subscriptionCount += 1;
  addEstimateToCurrencyMap(breakdown.totalsByCurrency, currency, normalized, 0n);
}

function finalizeCurrencyTotals(
  totals: Map<CurrencyCode, MutableCurrencyTotals>,
): ExactCurrencyTotals[] {
  return [...totals.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([currency, total]) => ({
      currency,
      monthlyEstimateMicros: total.monthlyEstimateMicros,
      annualizedEstimateMicros: total.annualizedEstimateMicros,
      upcomingAmountMicros: total.upcomingAmountMicros,
    }));
}

function finalizeBreakdowns(
  breakdowns: Map<string | null, MutableBreakdown>,
): DashboardBreakdown[] {
  return [...breakdowns.values()]
    .sort((left, right) => {
      if (left.subscriptionCount !== right.subscriptionCount) {
        return right.subscriptionCount - left.subscriptionCount;
      }

      if (left.name === null && right.name === null) return 0;
      if (left.name === null) return 1;
      if (right.name === null) return -1;
      return compareText(left.name, right.name);
    })
    .map((breakdown) => ({
      id: breakdown.id,
      name: breakdown.name,
      color: breakdown.color,
      subscriptionCount: breakdown.subscriptionCount,
      totalsByCurrency: finalizeCurrencyTotals(breakdown.totalsByCurrency),
    }));
}

function compareOccurrences(left: DashboardOccurrence, right: DashboardOccurrence): number {
  const dateOrder = compareIsoCalendarDates(left.billingOn, right.billingOn);
  if (dateOrder !== 0) return dateOrder;
  const nameOrder = compareText(left.name, right.name);
  return nameOrder !== 0 ? nameOrder : compareText(left.subscriptionId, right.subscriptionId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function emptyExactCurrencyTotal(currency: CurrencyCode): ExactCurrencyTotals {
  return {
    currency,
    monthlyEstimateMicros: makeRational(0n),
    annualizedEstimateMicros: makeRational(0n),
    upcomingAmountMicros: 0n,
  };
}
