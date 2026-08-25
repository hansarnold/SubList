import {
  addCalendarDays,
  effectiveReminderDaysBefore,
  localTodayInTimeZone,
  nextOccurrenceOnOrAfter,
  nextReminderPlanOnOrAfter,
  resolveReminderWindow,
} from "../domain";
import type { RenewalEmailDeliverySummary } from "../shared/api-types";
import type {
  AppRenewalEmailDelivery,
  AppSubscription,
  AppUser,
  ReminderDeliveryCandidate,
} from "./models";
import { RENEWAL_EMAIL_TEMPLATE_VERSION, renderRenewalReminderEmail } from "./reminder-email";
import type {
  EmailSender,
  ReminderEmailSendOutcome,
  ReminderProviderConfiguration,
  ReminderStore,
} from "./ports";

export const REMINDER_CLAIM_LEASE_MS = 15 * 60 * 1_000;
// One account may own 50 subscriptions. Keep each query bounded, while allowing a
// small owner-and-friends deployment to drain several accounts in the only hourly
// run that can service a 23:00 local delivery window.
export const REMINDER_DELIVERY_BATCH_LIMIT = 50;
export const REMINDER_DELIVERY_MAX_BATCHES = 10;

export type RenewalReminderRunResult = {
  planned: number;
  claimed: number;
  accepted: number;
  retryable: number;
  permanent: number;
  ambiguous: number;
};

export class RenewalReminderService {
  constructor(
    private readonly store: ReminderStore,
    private readonly sender: EmailSender,
    private readonly configuration: ReminderProviderConfiguration,
    private readonly now: () => number = Date.now,
  ) {}

  async run(scheduledTime: number): Promise<RenewalReminderRunResult> {
    const result: RenewalReminderRunResult = {
      planned: 0,
      claimed: 0,
      accepted: 0,
      retryable: 0,
      permanent: 0,
      ambiguous: 0,
    };
    const operationNow = this.now();
    await this.store.maintainReminderDeliveries(operationNow);

    for (const candidate of await this.store.listReminderPlanningCandidates()) {
      const { user, subscription } = candidate;
      const planningOn = localTodayInTimeZone(user.timezone, scheduledTime);
      const effectiveDaysBefore = effectiveReminderDaysBefore(
        user.defaultEmailReminderDaysBefore,
        subscription.emailReminderDaysBefore,
      );
      const billingOn = addCalendarDays(planningOn, effectiveDaysBefore);
      if (nextOccurrenceOnOrAfter(subscription.recurrence, billingOn) !== billingOn) continue;

      const window = resolveReminderWindow({
        planningOn,
        localTime: user.emailReminderLocalTime,
        timeZone: user.timezone,
      });
      // A delayed/manual replay must never create a pending row for an already
      // closed local-day window. Maintenance cannot expire a row that does not yet
      // exist, and the INSERT side of an upsert has no conflict guard.
      if (window.expiresAt <= operationNow) continue;
      const planned = await this.store.upsertReminderDeliveryPlan({
        id: crypto.randomUUID(),
        userId: user.id,
        subscriptionId: subscription.id,
        billingOn,
        effectiveDaysBefore,
        intendedSendAt: window.intendedSendAt,
        expiresAt: window.expiresAt,
        plannedUserReminderRevision: user.emailReminderRevision,
        plannedSubscriptionReminderRevision: subscription.emailReminderRevision,
        now: operationNow,
      });
      if (planned) result.planned += 1;
    }

    for (let batch = 0; batch < REMINDER_DELIVERY_MAX_BATCHES; batch += 1) {
      const due = await this.store.listDueReminderDeliveries(
        operationNow,
        REMINDER_DELIVERY_BATCH_LIMIT,
      );
      for (const candidate of due) {
        // Validate deterministic rendering before taking a lease. The claimed candidate
        // is read again atomically and rendered again so no pre-claim address or content
        // can cross the send boundary.
        renderCandidate(candidate, this.configuration.appBaseUrl);
        const claimedAt = this.now();
        const claimedCandidate = await this.store.claimReminderDelivery(
          candidate.delivery.id,
          claimedAt,
          claimedAt + REMINDER_CLAIM_LEASE_MS,
          this.configuration,
        );
        if (claimedCandidate === null) continue;
        result.claimed += 1;
        const claimed = claimedCandidate.delivery;
        const rendered = renderCandidate(claimedCandidate, this.configuration.appBaseUrl);

        let outcome: ReminderEmailSendOutcome;
        try {
          outcome = await this.sender.send({
            recipient: claimedCandidate.user.primaryEmail,
            ...rendered,
            applicationIdempotencyKey:
              claimed.applicationIdempotencyKey ?? applicationIdempotencyKey(claimed),
          });
        } catch {
          outcome = { kind: "ambiguous", errorCode: "provider_exception" };
        }

        result[outcomeCounter(outcome)] += 1;
        const completedAt = this.now();
        await this.store.recordReminderDeliveryOutcome(
          claimed.id,
          claimed.attemptCount,
          outcome,
          completedAt,
          outcome.kind === "definitely_not_accepted_retryable"
            ? nextRetryAt(claimed, completedAt)
            : null,
        );
      }
      if (due.length < REMINDER_DELIVERY_BATCH_LIMIT) break;
    }

    return result;
  }
}

export function deriveRenewalEmailDeliverySummary(input: {
  user: AppUser;
  subscription: AppSubscription;
  deliveries: readonly AppRenewalEmailDelivery[];
  senderCapabilityAvailable: boolean;
  now: number;
}): RenewalEmailDeliverySummary {
  const { user, subscription, deliveries, senderCapabilityAvailable, now } = input;
  if (
    !subscription.emailReminderEnabled ||
    subscription.status !== "active" ||
    subscription.archivedAt !== null
  ) {
    return emptySummary();
  }

  const effectiveDaysBefore = effectiveReminderDaysBefore(
    user.defaultEmailReminderDaysBefore,
    subscription.emailReminderDaysBefore,
  );
  const localToday = localTodayInTimeZone(user.timezone, now);
  const current = deliveries
    .filter(
      (delivery) =>
        isUserVisibleDelivery(delivery) &&
        addCalendarDays(delivery.billingOn, -delivery.effectiveDaysBefore) === localToday,
    )
    .sort((left, right) => currentWindowPriority(right, now) - currentWindowPriority(left, now))[0];
  const suppressed =
    user.emailRemindersPaused ||
    user.emailReminderSuspensionReason !== null ||
    !senderCapabilityAvailable;

  if (current !== undefined) {
    const attemptedAt = timestampOrNull(current.claimedAt);
    if (current.status === "sending" && (current.leaseExpiresAt ?? 0) <= now) {
      return { state: "unknown", occurrenceOn: current.billingOn, lastAttemptAt: attemptedAt };
    }
    if (["sent", "failed", "unknown", "expired", "cancelled"].includes(current.status)) {
      return {
        state:
          current.status === "cancelled"
            ? "failed"
            : (current.status as "sent" | "failed" | "unknown" | "expired"),
        occurrenceOn: current.billingOn,
        lastAttemptAt: attemptedAt,
      };
    }
    if (suppressed) {
      return { state: "paused", occurrenceOn: current.billingOn, lastAttemptAt: attemptedAt };
    }
    return {
      state: current.status === "retry_wait" ? "retrying" : "scheduled",
      occurrenceOn: current.billingOn,
      lastAttemptAt: attemptedAt,
    };
  }

  try {
    const next = nextReminderPlanOnOrAfter(
      subscription.recurrence,
      effectiveDaysBefore,
      localToday,
    );
    const lockedOccurrence = deliveries
      .filter(
        (delivery) =>
          delivery.billingOn === next.billingOn &&
          isUserVisibleDelivery(delivery) &&
          ["sent", "failed", "unknown", "expired", "cancelled"].includes(delivery.status),
      )
      .sort(
        (left, right) => currentWindowPriority(right, now) - currentWindowPriority(left, now),
      )[0];
    if (lockedOccurrence !== undefined) {
      return terminalSummary(lockedOccurrence);
    }
    return {
      state: suppressed ? "paused" : "scheduled",
      occurrenceOn: next.billingOn,
      lastAttemptAt: null,
    };
  } catch {
    const recentTerminal = deliveries.find(
      (delivery) =>
        isUserVisibleDelivery(delivery) &&
        ["sent", "failed", "unknown", "expired", "cancelled"].includes(delivery.status),
    );
    return recentTerminal === undefined
      ? emptySummary()
      : {
          state:
            recentTerminal.status === "cancelled"
              ? "failed"
              : (recentTerminal.status as "sent" | "failed" | "unknown" | "expired"),
          occurrenceOn: recentTerminal.billingOn,
          lastAttemptAt: timestampOrNull(recentTerminal.claimedAt),
        };
  }
}

function renderCandidate(candidate: ReminderDeliveryCandidate, appBaseUrl: string) {
  return renderRenewalReminderEmail({
    locale: candidate.user.preferredLocale,
    subscriptionId: candidate.subscription.id,
    subscriptionName: candidate.subscription.name,
    amountMicros: candidate.subscription.amountMicros,
    currency: candidate.subscription.currency,
    billingOn: candidate.delivery.billingOn,
    effectiveDaysBefore: candidate.delivery.effectiveDaysBefore,
    recurrence: candidate.subscription.recurrence,
    appBaseUrl,
  });
}

function applicationIdempotencyKey(delivery: AppRenewalEmailDelivery): string {
  return `renewal:${delivery.userId}:${delivery.subscriptionId}:${delivery.billingOn}`;
}

function nextRetryAt(delivery: AppRenewalEmailDelivery, now: number): number | null {
  if (delivery.attemptCount >= 3) return null;
  const delay = delivery.attemptCount === 1 ? 5 * 60 * 1_000 : 30 * 60 * 1_000;
  const next = now + delay;
  return next < delivery.expiresAt ? next : null;
}

function outcomeCounter(
  outcome: ReminderEmailSendOutcome,
): "accepted" | "retryable" | "permanent" | "ambiguous" {
  if (outcome.kind === "definitely_not_accepted_retryable") return "retryable";
  return outcome.kind;
}

function emptySummary(): RenewalEmailDeliverySummary {
  return { state: "none", occurrenceOn: null, lastAttemptAt: null };
}

function timestampOrNull(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function terminalSummary(delivery: AppRenewalEmailDelivery): RenewalEmailDeliverySummary {
  return {
    state:
      delivery.status === "cancelled"
        ? "failed"
        : (delivery.status as "sent" | "failed" | "unknown" | "expired"),
    occurrenceOn: delivery.billingOn,
    lastAttemptAt: timestampOrNull(delivery.claimedAt),
  };
}

function currentWindowPriority(delivery: AppRenewalEmailDelivery, now: number): number {
  if (delivery.status === "sending" && (delivery.leaseExpiresAt ?? 0) <= now) return 4;
  if (["sent", "failed", "unknown", "expired", "cancelled"].includes(delivery.status)) return 3;
  if (delivery.status === "retry_wait") return 2;
  return 1;
}

function isUserVisibleDelivery(delivery: AppRenewalEmailDelivery): boolean {
  // An unattempted cancellation is merely a superseded plan. Once an attempt has
  // started, however, the uniqueness guard prevents that occurrence from reopening;
  // hiding it would falsely project another scheduled email. Expose that terminal
  // lock through the provider-neutral `failed` summary without leaking its reason.
  return delivery.status !== "cancelled" || delivery.attemptCount > 0;
}

export function defaultReminderProviderConfiguration(input: {
  providerKey: string;
  providerConfigRevision: number;
  appBaseUrl: string;
}): ReminderProviderConfiguration {
  return { ...input, templateVersion: RENEWAL_EMAIL_TEMPLATE_VERSION };
}
