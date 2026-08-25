import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { IdentityEmailConflictError } from "../../src/application/errors";
import type { AuthenticatedIdentity } from "../../src/application/models";
import type { EmailSender, SubscriptionWrite } from "../../src/application/ports";
import {
  deriveRenewalEmailDeliverySummary,
  RenewalReminderService,
} from "../../src/application/reminder-service";
import { OpenSubListsService, toApiUser } from "../../src/application/service";
import { D1OpenSubListsRepository } from "../../src/worker/db/repository";
import { createApp } from "../../src/worker/api/app";
import { FakeEmailSender } from "../../src/worker/email/fake";

const migrations = inject("migrations");
const deliveryNow = Date.parse("2026-08-24T10:00:00.000Z");

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users").run();
});

describe("reminder migration invariants", () => {
  it("backfills safe opt-out defaults and enforces preference/suspension constraints", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("defaults"), 1);
    expect(user).toMatchObject({
      interfaceLocale: "en",
      emailLocale: "en",
      defaultEmailReminderDaysBefore: 7,
      emailReminderLocalTime: "09:00",
      emailRemindersPaused: false,
      emailReminderRevision: 0,
      emailReminderSuspensionReason: null,
    });
    const subscription = subscriptionWrite({ emailReminderEnabled: false });
    await repository.createSubscription(user.id, subscription);
    expect(await repository.getSubscription(user.id, subscription.id)).toMatchObject({
      emailReminderEnabled: false,
      emailReminderDaysBefore: null,
      emailReminderRevision: 0,
    });

    await expect(
      env.DB.prepare("UPDATE users SET default_email_reminder_days_before = 366 WHERE id = ?")
        .bind(user.id)
        .run(),
    ).rejects.toThrow();
    for (const invalidLocalTime of ["0a:00", "1/:00", "24:00"]) {
      await expect(
        env.DB.prepare("UPDATE users SET email_reminder_local_time = ? WHERE id = ?")
          .bind(invalidLocalTime, user.id)
          .run(),
      ).rejects.toThrow();
    }
    await expect(
      env.DB.prepare(
        "UPDATE users SET email_reminder_suspension_reason = 'identity_email_conflict' WHERE id = ?",
      )
        .bind(user.id)
        .run(),
    ).rejects.toThrow(/INVALID_EMAIL_REMINDER_SUSPENSION_PAIR/);
  });
});

describe("D1 reminder planning and delivery state", () => {
  it("selects only explicit per-subscription opt-ins and sends once across duplicate runs", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("planner"), 1);
    const disabled = subscriptionWrite({
      id: "20000000-0000-4000-8000-000000000001",
      name: "Large manual-looking record",
      amountMicros: Number.MAX_SAFE_INTEGER,
      emailReminderEnabled: false,
    });
    const enabled = subscriptionWrite({
      id: "20000000-0000-4000-8000-000000000002",
      emailReminderEnabled: true,
    });
    await repository.createSubscription(user.id, disabled);
    await repository.createSubscription(user.id, enabled);
    const candidates = await repository.listReminderPlanningCandidates();
    expect(candidates.map((candidate) => candidate.subscription.id)).toEqual([enabled.id]);

    const sender = new FakeEmailSender();
    const service = new RenewalReminderService(
      repository,
      sender,
      {
        providerKey: "deterministic_fake",
        providerConfigRevision: 1,
        templateVersion: 1,
        appBaseUrl: "https://sublist.example.test",
      },
      () => deliveryNow,
    );
    expect(await service.run(deliveryNow)).toMatchObject({ claimed: 1, accepted: 1 });
    expect(await service.run(deliveryNow)).toMatchObject({ claimed: 0, accepted: 0 });
    expect(sender.sent).toHaveLength(1);
    const rows = await repository.listSubscriptionReminderDeliveries(user.id, enabled.id, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", attemptCount: 1, billingOn: "2026-08-31" });
  });

  it("skips a stale plan without aborting when its subscription was deleted", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("deleted-plan"), 1);
    const subscription = subscriptionWrite({ emailReminderEnabled: true });
    await repository.createSubscription(user.id, subscription);
    const [candidate] = await repository.listReminderPlanningCandidates();
    expect(candidate).toBeDefined();
    expect(await repository.deleteSubscription(user.id, subscription.id)).toBe(true);

    await expect(
      repository.upsertReminderDeliveryPlan({
        id: crypto.randomUUID(),
        userId: user.id,
        subscriptionId: subscription.id,
        billingOn: "2026-08-31",
        effectiveDaysBefore: 7,
        intendedSendAt: deliveryNow,
        expiresAt: deliveryNow + 1_000_000,
        plannedUserReminderRevision: candidate!.user.emailReminderRevision,
        plannedSubscriptionReminderRevision: candidate!.subscription.emailReminderRevision,
        now: deliveryNow,
      }),
    ).resolves.toBe(false);
  });

  it("retries only a definite fake non-acceptance and then records acceptance", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("retry"), 1);
    const subscription = subscriptionWrite({ emailReminderEnabled: true });
    await repository.createSubscription(user.id, subscription);
    let clock = deliveryNow;
    const sender = new FakeEmailSender([
      { kind: "definitely_not_accepted_retryable", errorCode: "fake_retryable" },
      { kind: "accepted", providerMessageId: "fake-accepted" },
    ]);
    const service = new RenewalReminderService(
      repository,
      sender,
      {
        providerKey: "deterministic_fake",
        providerConfigRevision: 1,
        templateVersion: 1,
        appBaseUrl: "https://sublist.example.test",
      },
      () => clock,
    );
    await service.run(deliveryNow);
    expect(
      (await repository.listSubscriptionReminderDeliveries(user.id, subscription.id, 1))[0],
    ).toMatchObject({ status: "retry_wait", attemptCount: 1, lastErrorCode: "fake_retryable" });
    clock += 6 * 60 * 1_000;
    await service.run(deliveryNow);
    expect(
      (await repository.listSubscriptionReminderDeliveries(user.id, subscription.id, 1))[0],
    ).toMatchObject({ status: "sent", attemptCount: 2, providerMessageId: "fake-accepted" });
  });

  it("refuses a stale pre-claim candidate after a reminder-relevant edit", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("claim"), 1);
    const subscription = subscriptionWrite({ emailReminderEnabled: true });
    await repository.createSubscription(user.id, subscription);
    const sender = new FakeEmailSender();
    const service = new RenewalReminderService(
      repository,
      sender,
      {
        providerKey: "deterministic_fake",
        providerConfigRevision: 1,
        templateVersion: 1,
        appBaseUrl: "https://sublist.example.test",
      },
      () => deliveryNow,
    );
    await repository.upsertReminderDeliveryPlan({
      id: crypto.randomUUID(),
      userId: user.id,
      subscriptionId: subscription.id,
      billingOn: "2026-08-31",
      effectiveDaysBefore: 7,
      intendedSendAt: deliveryNow - 1,
      expiresAt: deliveryNow + 1_000_000,
      plannedUserReminderRevision: 0,
      plannedSubscriptionReminderRevision: 0,
      now: deliveryNow - 1,
    });
    const [stale] = await repository.listDueReminderDeliveries(deliveryNow, 10);
    expect(stale).toBeDefined();
    await repository.updateSubscription(
      user.id,
      {
        ...subscription,
        name: "Changed",
        emailReminderRevision: 1,
        updatedAt: deliveryNow,
      },
      subscription.updatedAt,
      subscription.emailReminderRevision,
    );
    expect(
      await repository.claimReminderDelivery(
        stale!.delivery.id,
        deliveryNow,
        deliveryNow + 900_000,
        {
          providerKey: "deterministic_fake",
          providerConfigRevision: 1,
          templateVersion: 1,
          appBaseUrl: "https://sublist.example.test",
        },
      ),
    ).toBeNull();
    expect(sender.sent).toHaveLength(0);
    expect(
      (await repository.listSubscriptionReminderDeliveries(user.id, subscription.id, 1))[0],
    ).toMatchObject({ status: "cancelled" });
    void service;
  });

  it("rejects a stale whole-row edit after a concurrent reminder opt-out", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("concurrent-opt-out"), 1);
    const subscription = subscriptionWrite({ emailReminderEnabled: true });
    await repository.createSubscription(user.id, subscription);
    const current = await repository.getSubscription(user.id, subscription.id);
    expect(current).not.toBeNull();

    await expect(
      repository.updateSubscription(
        user.id,
        {
          ...current!,
          emailReminderEnabled: false,
          emailReminderRevision: current!.emailReminderRevision + 1,
          updatedAt: 10,
        },
        current!.updatedAt,
        current!.emailReminderRevision,
      ),
    ).resolves.toMatchObject({ emailReminderEnabled: false, emailReminderRevision: 1 });

    await expect(
      repository.updateSubscription(
        user.id,
        { ...current!, notes: "Stale unrelated edit", updatedAt: 11 },
        current!.updatedAt,
        current!.emailReminderRevision,
      ),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_STATE_CHANGED", status: 409 });
    expect(await repository.getSubscription(user.id, subscription.id)).toMatchObject({
      emailReminderEnabled: false,
      emailReminderRevision: 1,
      notes: null,
    });
  });

  it("exhausts only definite non-acceptance retries and never retries an ambiguous outcome", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("outcomes"), 1);
    const retrying = subscriptionWrite({
      id: "20000000-0000-4000-8000-000000000021",
      emailReminderEnabled: true,
    });
    const ambiguous = subscriptionWrite({
      id: "20000000-0000-4000-8000-000000000022",
      emailReminderEnabled: true,
    });
    await repository.createSubscription(user.id, retrying);
    await repository.createSubscription(user.id, ambiguous);
    let clock = deliveryNow;
    const sentKeys: string[] = [];
    const sender: EmailSender = {
      send(envelope) {
        sentKeys.push(envelope.applicationIdempotencyKey);
        return Promise.resolve(
          envelope.applicationIdempotencyKey.includes(retrying.id)
            ? { kind: "definitely_not_accepted_retryable" as const, errorCode: "fake_retryable" }
            : { kind: "ambiguous" as const, errorCode: "fake_ambiguous" },
        );
      },
    };
    const service = new RenewalReminderService(
      repository,
      sender,
      reminderConfiguration(),
      () => clock,
    );

    await service.run(deliveryNow);
    expect(sentKeys).toHaveLength(2);
    const firstStates = await Promise.all([
      repository.listSubscriptionReminderDeliveries(user.id, retrying.id, 1),
      repository.listSubscriptionReminderDeliveries(user.id, ambiguous.id, 1),
    ]);
    expect(firstStates[0][0]).toMatchObject({ status: "retry_wait", attemptCount: 1 });
    expect(firstStates[1][0]).toMatchObject({
      status: "unknown",
      attemptCount: 1,
      lastErrorCode: "fake_ambiguous",
    });

    clock += 6 * 60 * 1_000;
    await service.run(deliveryNow);
    clock += 31 * 60 * 1_000;
    await service.run(deliveryNow);
    expect(sentKeys).toHaveLength(4);
    expect(
      (await repository.listSubscriptionReminderDeliveries(user.id, retrying.id, 1))[0],
    ).toMatchObject({ status: "failed", attemptCount: 3, lastErrorCode: "retry_exhausted" });
    expect(
      (await repository.listSubscriptionReminderDeliveries(user.id, ambiguous.id, 1))[0],
    ).toMatchObject({ status: "unknown", attemptCount: 1 });
  });

  it("marks an expired claim lease unknown without a provider retry", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("lease"), 1);
    const subscription = subscriptionWrite({ emailReminderEnabled: true });
    await repository.createSubscription(user.id, subscription);
    await repository.upsertReminderDeliveryPlan({
      id: crypto.randomUUID(),
      userId: user.id,
      subscriptionId: subscription.id,
      billingOn: "2026-08-31",
      effectiveDaysBefore: 7,
      intendedSendAt: deliveryNow - 1,
      expiresAt: deliveryNow + 3_600_000,
      plannedUserReminderRevision: 0,
      plannedSubscriptionReminderRevision: 0,
      now: deliveryNow - 1,
    });
    const [due] = await repository.listDueReminderDeliveries(deliveryNow, 1);
    if (due === undefined) throw new Error("Expected a due delivery.");
    await repository.claimReminderDelivery(
      due.delivery.id,
      deliveryNow,
      deliveryNow + 15 * 60 * 1_000,
      reminderConfiguration(),
    );
    await repository.maintainReminderDeliveries(deliveryNow + 15 * 60 * 1_000);

    expect(
      (await repository.listSubscriptionReminderDeliveries(user.id, subscription.id, 1))[0],
    ).toMatchObject({
      status: "unknown",
      attemptCount: 1,
      lastErrorCode: "lease_expired_ambiguous",
    });
  });

  it("locks an attempted occurrence on provider or preference revision changes", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("locks"), 1);
    const providerLocked = subscriptionWrite({
      id: "20000000-0000-4000-8000-000000000031",
      emailReminderEnabled: true,
    });
    const preferenceLocked = subscriptionWrite({
      id: "20000000-0000-4000-8000-000000000032",
      emailReminderEnabled: true,
    });
    await repository.createSubscription(user.id, providerLocked);
    await repository.createSubscription(user.id, preferenceLocked);
    let clock = deliveryNow;
    const sender = new FakeEmailSender([
      { kind: "definitely_not_accepted_retryable", errorCode: "fake_retryable" },
      { kind: "definitely_not_accepted_retryable", errorCode: "fake_retryable" },
    ]);
    await new RenewalReminderService(repository, sender, reminderConfiguration(), () => clock).run(
      deliveryNow,
    );

    const application = new OpenSubListsService(repository, () => clock, undefined, {
      emailRemindersAvailable: true,
      reminderStore: repository,
    });
    await application.updateSubscription(user.id, preferenceLocked.id, { name: "Changed" });
    clock += 6 * 60 * 1_000;
    await new RenewalReminderService(
      repository,
      sender,
      { ...reminderConfiguration(), providerConfigRevision: 2 },
      () => clock,
    ).run(deliveryNow);

    const [providerRow] = await repository.listSubscriptionReminderDeliveries(
      user.id,
      providerLocked.id,
      1,
    );
    const [preferenceRow] = await repository.listSubscriptionReminderDeliveries(
      user.id,
      preferenceLocked.id,
      1,
    );
    expect(providerRow).toMatchObject({
      status: "cancelled",
      attemptCount: 1,
      lastErrorCode: "provider_configuration_changed",
    });
    expect(preferenceRow).toMatchObject({
      status: "cancelled",
      attemptCount: 1,
      lastErrorCode: "preference_or_revision_changed",
    });
    for (const [subscription, delivery] of [
      [providerLocked, providerRow],
      [{ ...preferenceLocked, name: "Changed", emailReminderRevision: 1 }, preferenceRow],
    ] as const) {
      if (delivery === undefined) throw new Error("Expected a locked delivery.");
      expect(
        deriveRenewalEmailDeliverySummary({
          user,
          subscription,
          deliveries: [delivery],
          senderCapabilityAvailable: true,
          now: deliveryNow,
        }),
      ).toMatchObject({ state: "failed", occurrenceOn: "2026-08-31" });
    }
  });

  it("resumes a safe retry after global pause but never reopens an attempted opt-out", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("pause"), 1);
    const subscription = subscriptionWrite({ emailReminderEnabled: true });
    await repository.createSubscription(user.id, subscription);
    let clock = deliveryNow;
    const sender = new FakeEmailSender([
      { kind: "definitely_not_accepted_retryable", errorCode: "fake_retryable" },
      { kind: "accepted", providerMessageId: "resumed" },
    ]);
    const reminderService = new RenewalReminderService(
      repository,
      sender,
      reminderConfiguration(),
      () => clock,
    );
    const application = new OpenSubListsService(repository, () => clock, undefined, {
      emailRemindersAvailable: true,
      reminderStore: repository,
    });

    await reminderService.run(deliveryNow);
    await application.updateMe(user.id, { emailRemindersPaused: true });
    clock += 6 * 60 * 1_000;
    await reminderService.run(deliveryNow);
    expect(sender.sent).toHaveLength(1);
    await application.updateMe(user.id, { emailRemindersPaused: false });
    await reminderService.run(deliveryNow);
    expect(sender.sent).toHaveLength(2);
    expect(
      (await repository.listSubscriptionReminderDeliveries(user.id, subscription.id, 1))[0],
    ).toMatchObject({ status: "sent", attemptCount: 2 });

    const second = subscriptionWrite({
      id: "20000000-0000-4000-8000-000000000041",
      emailReminderEnabled: true,
    });
    await repository.createSubscription(user.id, second);
    const secondSender = new FakeEmailSender([
      { kind: "definitely_not_accepted_retryable", errorCode: "fake_retryable" },
      { kind: "accepted", providerMessageId: "must-not-send" },
    ]);
    const secondService = new RenewalReminderService(
      repository,
      secondSender,
      reminderConfiguration(),
      () => clock,
    );
    await secondService.run(deliveryNow);
    await application.updateSubscription(user.id, second.id, { emailReminderEnabled: false });
    await application.updateSubscription(user.id, second.id, { emailReminderEnabled: true });
    clock += 6 * 60 * 1_000;
    await secondService.run(deliveryNow);
    expect(secondSender.sent).toHaveLength(1);
    expect(
      (await repository.listSubscriptionReminderDeliveries(user.id, second.id, 1))[0],
    ).toMatchObject({ status: "cancelled", attemptCount: 1 });
  });
});

describe("reminder revision and identity safety", () => {
  it("increments only reminder-relevant revisions", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("revisions"), 1);
    const service = new OpenSubListsService(repository, () => deliveryNow, undefined, {
      emailRemindersAvailable: true,
      reminderStore: repository,
    });
    const created = await service.createSubscription(user.id, {
      name: "Original",
      amount: "9.99",
      currency: "USD",
      recurrence: {
        unit: "month",
        count: 1,
        anchorOn: "2026-08-24",
        anchorMode: "calendar_day",
      },
      symbol: null,
      categoryId: null,
      paymentMethodId: null,
      websiteUrl: null,
      notes: null,
      emailReminderEnabled: false,
      emailReminderDaysBefore: null,
    });
    await service.updateSubscription(user.id, created.id, { notes: "not rendered" });
    expect((await repository.getSubscription(user.id, created.id))?.emailReminderRevision).toBe(0);
    await service.updateSubscription(user.id, created.id, { name: "Rendered change" });
    expect((await repository.getSubscription(user.id, created.id))?.emailReminderRevision).toBe(1);

    await service.updateMe(user.id, { emailRemindersPaused: true });
    expect((await repository.getUser(user.id))?.emailReminderRevision).toBe(0);
    await service.updateMe(user.id, { interfaceLocale: "zh-Hans" });
    expect((await repository.getUser(user.id))?.emailReminderRevision).toBe(0);
    await service.updateMe(user.id, { emailLocale: "zh-Hans" });
    expect((await repository.getUser(user.id))?.emailReminderRevision).toBe(1);
  });

  it("keeps pending deliveries for interface locale edits and cancels them for email locale edits", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("locale-revisions"), 1);
    const subscription = subscriptionWrite({ emailReminderEnabled: true });
    await repository.createSubscription(user.id, subscription);
    expect(
      await repository.upsertReminderDeliveryPlan({
        id: "30000000-0000-4000-8000-000000000099",
        userId: user.id,
        subscriptionId: subscription.id,
        billingOn: "2026-08-31",
        effectiveDaysBefore: 7,
        intendedSendAt: deliveryNow,
        expiresAt: deliveryNow + 1_000_000,
        plannedUserReminderRevision: user.emailReminderRevision,
        plannedSubscriptionReminderRevision: subscription.emailReminderRevision,
        now: deliveryNow - 1,
      }),
    ).toBe(true);
    const service = new OpenSubListsService(repository, () => deliveryNow, undefined, {
      emailRemindersAvailable: true,
      reminderStore: repository,
    });

    await service.updateMe(user.id, { interfaceLocale: "zh-Hans" });
    expect(await repository.getUser(user.id)).toMatchObject({
      interfaceLocale: "zh-Hans",
      emailLocale: "en",
      emailReminderRevision: 0,
    });
    expect(
      (await repository.listSubscriptionReminderDeliveries(user.id, subscription.id, 1))[0],
    ).toMatchObject({ status: "pending", lastErrorCode: null });

    await service.updateMe(user.id, { emailLocale: "zh-Hans" });
    expect(await repository.getUser(user.id)).toMatchObject({
      interfaceLocale: "zh-Hans",
      emailLocale: "zh-Hans",
      emailReminderRevision: 1,
    });
    expect(
      (await repository.listSubscriptionReminderDeliveries(user.id, subscription.id, 1))[0],
    ).toMatchObject({
      status: "cancelled",
      lastErrorCode: "preference_or_revision_changed",
    });
  });

  it("fails closed on verified-email ownership collision and clears only after recheck", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const firstIdentity = identity("identity-a", "first@example.test");
    const secondIdentity = identity("identity-b", "second@example.test");
    const first = await repository.resolveUser(firstIdentity, 1);
    const second = await repository.resolveUser(secondIdentity, 1);
    const subscription = subscriptionWrite({ emailReminderEnabled: true });
    await repository.createSubscription(first.id, subscription);
    expect(
      await repository.upsertReminderDeliveryPlan({
        id: crypto.randomUUID(),
        userId: first.id,
        subscriptionId: subscription.id,
        billingOn: "2026-08-31",
        effectiveDaysBefore: 7,
        intendedSendAt: deliveryNow,
        expiresAt: deliveryNow + 1_000_000,
        plannedUserReminderRevision: 0,
        plannedSubscriptionReminderRevision: 0,
        now: deliveryNow,
      }),
    ).toBe(true);

    await expect(
      repository.resolveUser({ ...firstIdentity, email: secondIdentity.email }, 2),
    ).rejects.toBeInstanceOf(IdentityEmailConflictError);
    const suspended = await repository.getUser(first.id);
    expect(suspended).toMatchObject({
      primaryEmail: firstIdentity.email,
      emailReminderSuspensionReason: "identity_email_conflict",
      emailReminderSuspensionEmailNormalized: secondIdentity.email,
    });
    expect(toApiUser(suspended!)).toMatchObject({ emailReminderSystemSuspended: true });
    expect(toApiUser(suspended!)).not.toHaveProperty("emailReminderSuspensionEmailNormalized");
    expect(await repository.clearEmailReminderIdentityConflict(first.id, 3)).toBe(
      "still_conflicted",
    );
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(second.id).run();
    expect(await repository.clearEmailReminderIdentityConflict(first.id, 4)).toBe("cleared");
    expect(await repository.getUser(first.id)).toMatchObject({
      emailReminderSuspensionReason: null,
      emailReminderSuspensionEmailNormalized: null,
      emailRemindersPaused: true,
      emailReminderRevision: 1,
    });
    expect(
      await repository.listSubscriptionReminderDeliveries(first.id, subscription.id, 1),
    ).toEqual([expect.objectContaining({ status: "cancelled" })]);
  });
});

describe("reminder import safety", () => {
  it("forces global pause transactionally when an unavailable deployment imports an opt-in", async () => {
    const repository = new D1OpenSubListsRepository(env.DB);
    const user = await repository.resolveUser(identity("import"), 1);
    const subscription = subscriptionWrite({ emailReminderEnabled: true });
    const outcome = await repository.applyImport(
      user.id,
      {
        user,
        resourceRevision: (await repository.getImportState(user.id)).resourceRevision,
      },
      [{ kind: "insert", subscription }],
      null,
      [],
      10,
      true,
    );
    expect(outcome).toEqual({ enabledPreferencesAfterApply: 1, forcedGlobalPause: true });
    expect(await repository.getUser(user.id)).toMatchObject({ emailRemindersPaused: true });
  });
});

describe("reminder HTTP capability contract", () => {
  it("gates only opt-in transitions and actual unpause operations", async () => {
    const unavailable = reminderApp(false);
    const available = reminderApp(true);
    const unavailableSession = await reminderRequest(unavailable, "/api/v1/session");
    await expect(unavailableSession.json()).resolves.toMatchObject({
      data: { capabilities: { emailReminders: false } },
    });
    const availableSession = await reminderRequest(available, "/api/v1/session");
    await expect(availableSession.json()).resolves.toMatchObject({
      data: { capabilities: { emailReminders: true } },
    });

    const disabledCreate = await reminderRequest(unavailable, "/api/v1/subscriptions", {
      method: "POST",
      headers: reminderJsonHeaders(),
      body: JSON.stringify(subscriptionInput(false, "Disabled")),
    });
    expect(disabledCreate.status).toBe(201);
    const disabledId = (await disabledCreate.json<{ data: { id: string } }>()).data.id;
    await expectReminderError(
      reminderRequest(unavailable, `/api/v1/subscriptions/${disabledId}`, {
        method: "PATCH",
        headers: reminderJsonHeaders(),
        body: JSON.stringify({ emailReminderEnabled: true }),
      }),
      "EMAIL_REMINDERS_UNAVAILABLE",
    );

    const enabledCreate = await reminderRequest(available, "/api/v1/subscriptions", {
      method: "POST",
      headers: reminderJsonHeaders(),
      body: JSON.stringify(subscriptionInput(true, "Enabled")),
    });
    expect(enabledCreate.status).toBe(201);
    const enabledId = (await enabledCreate.json<{ data: { id: string } }>()).data.id;
    expect(
      await reminderRequest(unavailable, `/api/v1/subscriptions/${enabledId}`, {
        method: "PATCH",
        headers: reminderJsonHeaders(),
        body: JSON.stringify({ emailReminderEnabled: true }),
      }),
    ).toMatchObject({ status: 200 });
    expect(
      await reminderRequest(unavailable, `/api/v1/subscriptions/${enabledId}`, {
        method: "PATCH",
        headers: reminderJsonHeaders(),
        body: JSON.stringify({ emailReminderEnabled: false }),
      }),
    ).toMatchObject({ status: 200 });

    expect(
      await reminderRequest(unavailable, "/api/v1/me", {
        method: "PATCH",
        headers: reminderJsonHeaders(),
        body: JSON.stringify({ emailRemindersPaused: false }),
      }),
    ).toMatchObject({ status: 200 });
    expect(
      await reminderRequest(unavailable, "/api/v1/me", {
        method: "PATCH",
        headers: reminderJsonHeaders(),
        body: JSON.stringify({ emailRemindersPaused: true }),
      }),
    ).toMatchObject({ status: 200 });
    await expectReminderError(
      reminderRequest(unavailable, "/api/v1/me", {
        method: "PATCH",
        headers: reminderJsonHeaders(),
        body: JSON.stringify({ emailRemindersPaused: false }),
      }),
      "EMAIL_REMINDERS_UNAVAILABLE",
    );
  });

  it("keeps a system suspension fail-closed without exposing its candidate address", async () => {
    const available = reminderApp(true);
    const session = await reminderRequest(available, "/api/v1/session");
    const userId = (await session.json<{ data: { user: { id: string } } }>()).data.user.id;
    await env.DB.prepare(
      `UPDATE users
       SET email_reminders_paused = 1,
           email_reminder_suspension_reason = 'identity_email_conflict',
           email_reminder_suspension_email_normalized = 'private-candidate@example.test'
       WHERE id = ?`,
    )
      .bind(userId)
      .run();

    const response = await reminderRequest(available, "/api/v1/me", {
      method: "PATCH",
      headers: reminderJsonHeaders(),
      body: JSON.stringify({ emailRemindersPaused: false }),
    });
    expect(response.status).toBe(409);
    const body = await response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("EMAIL_REMINDERS_SUSPENDED");
    expect(JSON.stringify(body)).not.toContain("private-candidate@example.test");
  });

  it("returns only a coarse delivery summary from Subscription Detail", async () => {
    const available = reminderApp(true);
    const create = await reminderRequest(available, "/api/v1/subscriptions", {
      method: "POST",
      headers: reminderJsonHeaders(),
      body: JSON.stringify(subscriptionInput(true, "Detail")),
    });
    const subscriptionId = (await create.json<{ data: { id: string } }>()).data.id;
    const session = await reminderRequest(available, "/api/v1/session");
    const userId = (await session.json<{ data: { user: { id: string } } }>()).data.user.id;
    const repository = new D1OpenSubListsRepository(env.DB);
    const runtimeNow = Date.now();
    const localTime = `${String(new Date(runtimeNow).getUTCHours()).padStart(2, "0")}:00`;
    await repository.updateUser(userId, { emailReminderLocalTime: localTime }, runtimeNow - 1);
    await new RenewalReminderService(
      repository,
      new FakeEmailSender([{ kind: "accepted", providerMessageId: "private-provider-id" }]),
      reminderConfiguration(),
      () => runtimeNow,
    ).run(runtimeNow);

    const detailResponse = await reminderRequest(
      available,
      `/api/v1/subscriptions/${subscriptionId}`,
    );
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json<{
      data: { emailReminderDelivery: { state: string; occurrenceOn: string | null } };
    }>();
    expect(detail.data.emailReminderDelivery).toMatchObject({ state: "sent" });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("private-provider-id");
    expect(serialized).not.toMatch(/providerMessageId|lastErrorCode|recipient|messageId/);
  });

  it("previews reminder impact and forces pause for a V4 opt-in import without a sender", async () => {
    const unavailable = reminderApp(false);
    await reminderRequest(unavailable, "/api/v1/session");
    const archive = reminderArchiveV4(true);
    const previewResponse = await reminderRequest(unavailable, "/api/v1/imports/preview", {
      method: "POST",
      headers: reminderJsonHeaders(),
      body: JSON.stringify({ archive, conflictStrategy: "skip", importProfile: true }),
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json<{
      data: {
        digest: string;
        reminderImpact: {
          enabledPreferencesAfterApply: number;
          senderCapabilityAvailable: boolean;
          willForceGlobalPause: boolean;
        };
      };
    }>();
    expect(preview.data.reminderImpact).toEqual({
      enabledPreferencesAfterApply: 1,
      senderCapabilityAvailable: false,
      willForceGlobalPause: true,
    });

    const importResponse = await reminderRequest(unavailable, "/api/v1/imports", {
      method: "POST",
      headers: reminderJsonHeaders(),
      body: JSON.stringify({
        archive,
        expectedDigest: preview.data.digest,
        conflictStrategy: "skip",
        importProfile: true,
        confirmed: true,
      }),
    });
    expect(importResponse.status).toBe(200);
    await expect(importResponse.json()).resolves.toMatchObject({
      data: {
        reminderImpact: {
          enabledPreferencesAfterApply: 1,
          senderCapabilityAvailable: false,
          willForceGlobalPause: true,
        },
      },
    });
    const me = await reminderRequest(unavailable, "/api/v1/me");
    await expect(me.json()).resolves.toMatchObject({
      data: { emailRemindersPaused: true },
    });
  });

  it("requires a new import preview when sender capability changes", async () => {
    const unavailable = reminderApp(false);
    const available = reminderApp(true);
    await reminderRequest(unavailable, "/api/v1/session");
    const archive = reminderArchiveV4(true);
    const previewResponse = await reminderRequest(unavailable, "/api/v1/imports/preview", {
      method: "POST",
      headers: reminderJsonHeaders(),
      body: JSON.stringify({ archive, conflictStrategy: "skip", importProfile: true }),
    });
    const preview = await previewResponse.json<{ data: { digest: string } }>();

    const importResponse = await reminderRequest(available, "/api/v1/imports", {
      method: "POST",
      headers: reminderJsonHeaders(),
      body: JSON.stringify({
        archive,
        expectedDigest: preview.data.digest,
        conflictStrategy: "skip",
        importProfile: true,
        confirmed: true,
      }),
    });

    expect(importResponse.status).toBe(409);
    await expect(importResponse.json()).resolves.toMatchObject({
      error: { code: "IMPORT_DIGEST_MISMATCH" },
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM subscriptions").first<number>("count"),
    ).toBe(0);
  });
});

function identity(subject: string, email = `${subject}@example.test`): AuthenticatedIdentity {
  return { provider: "local_development", subject, email };
}

function subscriptionWrite(patch: Partial<SubscriptionWrite> = {}): SubscriptionWrite {
  return {
    id: "20000000-0000-4000-8000-000000000010",
    name: "Service",
    amountMicros: 9_990_000,
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
    emailReminderEnabled: false,
    emailReminderDaysBefore: null,
    emailReminderRevision: 0,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function reminderConfiguration() {
  return {
    providerKey: "deterministic_fake",
    providerConfigRevision: 1,
    templateVersion: 1,
    appBaseUrl: "https://sublist.example.test",
  };
}

function reminderApp(available: boolean) {
  return createApp(undefined, () =>
    available
      ? {
          available: true,
          kind: "fake",
          configuration: reminderConfiguration(),
        }
      : { available: false },
  );
}

function reminderRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return Promise.resolve(
    app.fetch(new Request(`http://localhost:5173${path}`, init), env, createExecutionContext()),
  );
}

function reminderJsonHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Origin: "http://localhost:5173",
    "X-Requested-With": "XMLHttpRequest",
  };
}

function subscriptionInput(emailReminderEnabled: boolean, name: string) {
  return {
    name,
    amount: "9.99",
    currency: "USD",
    recurrence: {
      unit: "day",
      count: 1,
      anchorOn: "2026-01-01",
      anchorMode: "calendar_day",
    },
    symbol: null,
    categoryId: null,
    paymentMethodId: null,
    websiteUrl: null,
    notes: null,
    emailReminderEnabled,
    emailReminderDaysBefore: null,
  };
}

async function expectReminderError(responsePromise: Promise<Response>, code: string) {
  const response = await responsePromise;
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

function reminderArchiveV4(emailReminderEnabled: boolean) {
  const timestamp = "2026-08-24T00:00:00.000Z";
  return {
    format: "opensublists",
    schemaVersion: 4,
    archiveId: "10000000-0000-4000-8000-000000000091",
    exportedAt: timestamp,
    generator: { name: "OpenSubLists", version: "integration-test" },
    profile: {
      displayName: null,
      timezone: "UTC",
      reportingCurrency: "USD",
      interfaceLocale: "en",
      emailLocale: "en",
      defaultEmailReminderDaysBefore: 7,
      emailReminderLocalTime: "09:00",
      emailRemindersPaused: false,
    },
    categories: [],
    paymentMethods: [],
    subscriptions: [
      {
        id: "20000000-0000-4000-8000-000000000091",
        name: "Imported reminder",
        symbol: null,
        amount: "9.99",
        currency: "USD",
        recurrence: {
          unit: "month",
          count: 1,
          anchorOn: "2026-08-24",
          anchorMode: "calendar_day",
        },
        status: "active",
        cancelledAt: null,
        archivedAt: null,
        categoryId: null,
        paymentMethodId: null,
        websiteUrl: null,
        notes: null,
        emailReminderEnabled,
        emailReminderDaysBefore: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}
