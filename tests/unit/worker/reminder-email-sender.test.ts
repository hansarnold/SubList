import { describe, expect, it } from "vitest";

import type { ReminderEmailEnvelope } from "../../../src/application/ports";
import {
  resolveEmailReminderRuntime,
  type EmailReminderEnv,
} from "../../../src/worker/email/config";
import { FakeEmailSender } from "../../../src/worker/email/fake";
import { CloudflareEmailSender } from "../../../src/worker/email/native";

const envelope: ReminderEmailEnvelope = {
  recipient: "person@example.test",
  subject: "Reminder",
  text: "Private body",
  html: "<p>Private body</p>",
  applicationIdempotencyKey: "renewal:1",
};

describe("email reminder runtime capability", () => {
  it("keeps tracked disabled configuration unavailable", () => {
    expect(resolveEmailReminderRuntime(runtimeEnv())).toEqual({ available: false });
  });

  it("allows deterministic fake mode only outside production", () => {
    expect(
      resolveEmailReminderRuntime(
        runtimeEnv({
          ENVIRONMENT: "local",
          EMAIL_REMINDER_MODE: "fake",
          EMAIL_REMINDER_PROVIDER_CONFIG_REVISION: "1",
        }),
      ),
    ).toMatchObject({ available: true, kind: "fake" });
    expect(
      resolveEmailReminderRuntime(
        runtimeEnv({
          ENVIRONMENT: "production",
          EMAIL_REMINDER_MODE: "fake",
          EMAIL_REMINDER_PROVIDER_CONFIG_REVISION: "1",
        }),
      ),
    ).toEqual({ available: false });
  });

  it("allows native sending only for complete production configuration", () => {
    const binding: SendEmail = { send: () => Promise.resolve({ messageId: "id" }) };
    expect(
      resolveEmailReminderRuntime(
        runtimeEnv({
          ENVIRONMENT: "production",
          EMAIL_REMINDER_MODE: "cloudflare",
          EMAIL_REMINDER_FROM: "reminders@example.com",
          EMAIL_REMINDER_PROVIDER_CONFIG_REVISION: "2",
          EMAIL: binding,
          PUBLIC_ORIGIN: "https://sublist.example.com",
        }),
      ),
    ).toMatchObject({ available: true, kind: "cloudflare" });
    expect(
      resolveEmailReminderRuntime(
        runtimeEnv({
          ENVIRONMENT: "local",
          EMAIL_REMINDER_MODE: "cloudflare",
          EMAIL_REMINDER_FROM: "reminders@example.com",
          EMAIL_REMINDER_PROVIDER_CONFIG_REVISION: "2",
          EMAIL: binding,
        }),
      ),
    ).toEqual({ available: false });
  });
});

describe("Cloudflare native email outcome classification", () => {
  it("returns the opaque message ID on acceptance", async () => {
    const sender = new CloudflareEmailSender(
      { send: () => Promise.resolve({ messageId: "opaque-id" }) },
      "reminders@example.com",
    );
    await expect(sender.send(envelope)).resolves.toEqual({
      kind: "accepted",
      providerMessageId: "opaque-id",
    });
  });

  it("maps documented validation and rejection errors to permanent stable codes", async () => {
    const sender = throwingSender("E_RECIPIENT_NOT_ALLOWED");
    await expect(sender.send(envelope)).resolves.toEqual({
      kind: "permanent",
      errorCode: "provider_recipient_not_allowed",
    });
  });

  it.each(["E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED", "E_INTERNAL_SERVER_ERROR"])(
    "treats %s as ambiguous because the binding does not guarantee non-acceptance",
    async (code) => {
      const outcome = await throwingSender(code).send(envelope);
      expect(outcome.kind).toBe("ambiguous");
    },
  );
});

describe("deterministic fake sender privacy", () => {
  it("stores delivery metadata without recipient, subject, or body", async () => {
    const sender = new FakeEmailSender([
      { kind: "definitely_not_accepted_retryable", errorCode: "fake_retryable" },
    ]);
    await expect(sender.send(envelope)).resolves.toMatchObject({
      kind: "definitely_not_accepted_retryable",
    });
    expect(sender.sent).toEqual([
      {
        applicationIdempotencyKey: "renewal:1",
        textBytes: 12,
        htmlBytes: 19,
      },
    ]);
    expect(JSON.stringify(sender.sent)).not.toContain("person@example.test");
    expect(JSON.stringify(sender.sent)).not.toContain("Private body");
  });
});

function runtimeEnv(patch: Partial<EmailReminderEnv> = {}): EmailReminderEnv {
  return {
    ENVIRONMENT: "local",
    PUBLIC_ORIGIN: "http://localhost:5173",
    EMAIL_REMINDER_MODE: "disabled",
    EMAIL_REMINDER_FROM: "reminders@example.invalid",
    EMAIL_REMINDER_PROVIDER_CONFIG_REVISION: "0",
    ...patch,
  };
}

function throwingSender(code: string): CloudflareEmailSender {
  return new CloudflareEmailSender(
    {
      send() {
        return Promise.reject(Object.assign(new Error("private provider details"), { code }));
      },
    },
    "reminders@example.com",
  );
}
