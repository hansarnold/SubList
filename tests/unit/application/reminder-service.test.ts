import { describe, expect, it } from "vitest";

import type {
  AppRenewalEmailDelivery,
  AppSubscription,
  AppUser,
  ReminderDeliveryCandidate,
} from "../../../src/application/models";
import type {
  EmailSender,
  ReminderEmailEnvelope,
  ReminderStore,
} from "../../../src/application/ports";
import {
  deriveRenewalEmailDeliverySummary,
  REMINDER_DELIVERY_BATCH_LIMIT,
  RenewalReminderService,
} from "../../../src/application/reminder-service";

const now = Date.parse("2026-08-24T10:00:00.000Z");

describe("renewal reminder delivery summary", () => {
  it("keeps today's terminal result visible after the effective lead changes", () => {
    const user = userFixture({ defaultEmailReminderDaysBefore: 3 });
    const subscription = subscriptionFixture({ emailReminderDaysBefore: 3 });
    const sent = deliveryFixture({
      billingOn: "2026-08-31",
      effectiveDaysBefore: 7,
      status: "sent",
      attemptCount: 1,
      claimedAt: now - 1_000,
      sentAt: now,
    });

    expect(
      deriveRenewalEmailDeliverySummary({
        user,
        subscription,
        deliveries: [sent],
        senderCapabilityAvailable: true,
        now,
      }),
    ).toEqual({
      state: "sent",
      occurrenceOn: "2026-08-31",
      lastAttemptAt: "2026-08-24T09:59:59.000Z",
    });
  });

  it.each(["provider_configuration_changed", "preference_or_revision_changed"])(
    "shows an attempted cancellation as terminal failed for %s",
    (lastErrorCode) => {
      const attemptedCancellation = deliveryFixture({
        status: "cancelled",
        attemptCount: 1,
        claimedAt: now - 1_000,
        lastErrorCode,
      });

      expect(
        deriveRenewalEmailDeliverySummary({
          user: userFixture(),
          subscription: subscriptionFixture(),
          deliveries: [attemptedCancellation],
          senderCapabilityAvailable: true,
          now,
        }),
      ).toEqual({
        state: "failed",
        occurrenceOn: "2026-08-31",
        lastAttemptAt: "2026-08-24T09:59:59.000Z",
      });
    },
  );

  it.each(["2026-08-25T10:00:00.000Z", "2026-08-28T10:00:00.000Z"])(
    "keeps an attempted occurrence terminal after a lead change at %s",
    (summaryNow) => {
      const attemptedCancellation = deliveryFixture({
        status: "cancelled",
        attemptCount: 1,
        claimedAt: now - 1_000,
        lastErrorCode: "preference_or_revision_changed",
      });
      const monthly = subscriptionFixture({
        emailReminderDaysBefore: 3,
        recurrence: {
          unit: "month",
          count: 1,
          anchorOn: "2026-01-31",
          anchorMode: "calendar_day",
        },
      });

      expect(
        deriveRenewalEmailDeliverySummary({
          user: userFixture({ defaultEmailReminderDaysBefore: 3 }),
          subscription: monthly,
          deliveries: [attemptedCancellation],
          senderCapabilityAvailable: true,
          now: Date.parse(summaryNow),
        }),
      ).toEqual({
        state: "failed",
        occurrenceOn: "2026-08-31",
        lastAttemptAt: "2026-08-24T09:59:59.000Z",
      });
    },
  );

  it("ignores an unattempted superseded plan and projects the current preference", () => {
    expect(
      deriveRenewalEmailDeliverySummary({
        user: userFixture({ defaultEmailReminderDaysBefore: 3 }),
        subscription: subscriptionFixture({ emailReminderDaysBefore: 3 }),
        deliveries: [
          deliveryFixture({
            status: "cancelled",
            attemptCount: 0,
            effectiveDaysBefore: 7,
            lastErrorCode: "preference_or_revision_changed",
          }),
        ],
        senderCapabilityAvailable: true,
        now,
      }),
    ).toMatchObject({ state: "scheduled" });
  });
});

describe("renewal reminder claim boundary", () => {
  it("sends only the fresh candidate returned by the atomic claim", async () => {
    const oldCandidate = candidateFixture("old@example.test", "Old name");
    const freshCandidate = candidateFixture("fresh@example.test", "Fresh name", {
      attemptCount: 1,
      status: "sending",
      claimedAt: now,
      leaseExpiresAt: now + 900_000,
      applicationIdempotencyKey: "renewal:fresh",
      providerKey: "fake",
      providerConfigRevision: 1,
      templateVersion: 1,
    });
    const sent: ReminderEmailEnvelope[] = [];
    const sender: EmailSender = {
      send(envelope) {
        sent.push(envelope);
        return Promise.resolve({ kind: "accepted", providerMessageId: "message-1" });
      },
    };
    const store = {
      maintainReminderDeliveries: () => Promise.resolve(),
      listReminderPlanningCandidates: () => Promise.resolve([]),
      upsertReminderDeliveryPlan: () => Promise.resolve(true),
      listDueReminderDeliveries: () => Promise.resolve([oldCandidate]),
      claimReminderDelivery: () => Promise.resolve(freshCandidate),
      recordReminderDeliveryOutcome: () => Promise.resolve(true),
      listSubscriptionReminderDeliveries: () => Promise.resolve([]),
    } satisfies ReminderStore;

    await new RenewalReminderService(
      store,
      sender,
      {
        providerKey: "fake",
        providerConfigRevision: 1,
        templateVersion: 1,
        appBaseUrl: "https://sublist.example.test",
      },
      () => now,
    ).run(now);

    expect(sent[0]).toMatchObject({
      recipient: "fresh@example.test",
      applicationIdempotencyKey: "renewal:fresh",
    });
    expect(sent[0]?.subject).toContain("Fresh name");
    expect(sent[0]?.subject).not.toContain("Old name");
  });

  it("does not plan or send a delayed replay after the original local day closed", async () => {
    const scheduledTime = Date.parse("2026-08-23T23:05:00.000Z");
    const operationNow = Date.parse("2026-08-24T00:05:00.000Z");
    let upserted = 0;
    const store = {
      maintainReminderDeliveries: () => Promise.resolve(),
      listReminderPlanningCandidates: () =>
        Promise.resolve([
          {
            user: userFixture({ emailReminderLocalTime: "23:00" }),
            subscription: subscriptionFixture(),
          },
        ]),
      upsertReminderDeliveryPlan: () => {
        upserted += 1;
        return Promise.resolve(true);
      },
      listDueReminderDeliveries: () => Promise.resolve([]),
      claimReminderDelivery: () => Promise.resolve(null),
      recordReminderDeliveryOutcome: () => Promise.resolve(true),
      listSubscriptionReminderDeliveries: () => Promise.resolve([]),
    } satisfies ReminderStore;
    const sender = new RecordingSender();

    const result = await new RenewalReminderService(
      store,
      sender,
      configuration(),
      () => operationNow,
    ).run(scheduledTime);

    expect(result).toMatchObject({ planned: 0, claimed: 0 });
    expect(upserted).toBe(0);
    expect(sender.sent).toHaveLength(0);
  });

  it("drains a full 50-subscription account in one late-hour invocation", async () => {
    const candidates = Array.from({ length: 50 }, (_value, index) =>
      candidateFixture(`user-${index}@example.test`, `Service ${index}`, {
        id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        billingOn: "2026-08-25",
        intendedSendAt: Date.parse("2026-08-24T23:00:00.000Z"),
        expiresAt: Date.parse("2026-08-25T00:00:00.000Z"),
      }),
    );
    let dueReads = 0;
    const store = {
      maintainReminderDeliveries: () => Promise.resolve(),
      listReminderPlanningCandidates: () => Promise.resolve([]),
      upsertReminderDeliveryPlan: () => Promise.resolve(true),
      listDueReminderDeliveries: (_now: number, limit: number) => {
        expect(limit).toBe(REMINDER_DELIVERY_BATCH_LIMIT);
        dueReads += 1;
        return Promise.resolve(dueReads === 1 ? candidates : []);
      },
      claimReminderDelivery: (id: string) => {
        const candidate = candidates.find((item) => item.delivery.id === id);
        return Promise.resolve(
          candidate === undefined
            ? null
            : {
                ...candidate,
                delivery: {
                  ...candidate.delivery,
                  status: "sending" as const,
                  attemptCount: 1,
                  claimedAt: Date.parse("2026-08-24T23:05:00.000Z"),
                },
              },
        );
      },
      recordReminderDeliveryOutcome: () => Promise.resolve(true),
      listSubscriptionReminderDeliveries: () => Promise.resolve([]),
    } satisfies ReminderStore;
    const sender = new RecordingSender();
    const lateHourNow = Date.parse("2026-08-24T23:05:00.000Z");

    const result = await new RenewalReminderService(
      store,
      sender,
      configuration(),
      () => lateHourNow,
    ).run(lateHourNow);

    expect(result).toMatchObject({ claimed: 50, accepted: 50 });
    expect(sender.sent).toHaveLength(50);
    expect(dueReads).toBe(2);
  });
});

class RecordingSender implements EmailSender {
  readonly sent: ReminderEmailEnvelope[] = [];

  send(envelope: ReminderEmailEnvelope) {
    this.sent.push(envelope);
    return Promise.resolve({ kind: "accepted" as const, providerMessageId: null });
  }
}

function configuration() {
  return {
    providerKey: "fake",
    providerConfigRevision: 1,
    templateVersion: 1,
    appBaseUrl: "https://sublist.example.test",
  };
}

function userFixture(patch: Partial<AppUser> = {}): AppUser {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    primaryEmail: "user@example.test",
    displayName: null,
    timezone: "UTC",
    reportingCurrency: "USD",
    onboardingCompletedAt: null,
    preferredLocale: "en",
    defaultEmailReminderDaysBefore: 7,
    emailReminderLocalTime: "09:00",
    emailRemindersPaused: false,
    emailReminderRevision: 0,
    emailReminderSuspensionReason: null,
    emailReminderSuspensionEmailNormalized: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

function subscriptionFixture(patch: Partial<AppSubscription> = {}): AppSubscription {
  return {
    id: "20000000-0000-4000-8000-000000000002",
    name: "Subscription",
    amountMicros: 10_000_000,
    currency: "USD",
    recurrence: {
      unit: "day",
      count: 1,
      anchorOn: "2026-01-01",
      anchorMode: "calendar_day",
    },
    nextBillingOn: "2026-08-24",
    status: "active",
    cancelledAt: null,
    archivedAt: null,
    categoryId: null,
    paymentMethodId: null,
    symbol: null,
    websiteUrl: null,
    notes: null,
    emailReminderEnabled: true,
    emailReminderDaysBefore: null,
    emailReminderRevision: 0,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

function deliveryFixture(patch: Partial<AppRenewalEmailDelivery> = {}): AppRenewalEmailDelivery {
  return {
    id: "30000000-0000-4000-8000-000000000003",
    userId: "10000000-0000-4000-8000-000000000001",
    subscriptionId: "20000000-0000-4000-8000-000000000002",
    billingOn: "2026-08-31",
    effectiveDaysBefore: 7,
    intendedSendAt: now - 3_600_000,
    expiresAt: now + 14 * 3_600_000,
    status: "pending",
    attemptCount: 0,
    claimedAt: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    sentAt: null,
    providerMessageId: null,
    lastErrorCode: null,
    providerKey: null,
    providerConfigRevision: null,
    applicationIdempotencyKey: null,
    templateVersion: null,
    plannedUserReminderRevision: 0,
    plannedSubscriptionReminderRevision: 0,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

function candidateFixture(
  email: string,
  name: string,
  deliveryPatch: Partial<AppRenewalEmailDelivery> = {},
): ReminderDeliveryCandidate {
  return {
    user: userFixture({ primaryEmail: email }),
    subscription: subscriptionFixture({ name }),
    delivery: deliveryFixture(deliveryPatch),
  };
}
