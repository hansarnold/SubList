import { describe, expect, it } from "vitest";

import type { AppUser } from "../../../src/application/models";
import type { OpenSubListsRepository } from "../../../src/application/ports";
import { OpenSubListsService } from "../../../src/application/service";

describe("account reminder pause capability", () => {
  it("allows a complete-profile no-op false while the sender is unavailable", async () => {
    const user = userFixture({ emailRemindersPaused: false });
    const repository = {
      getUser: () => Promise.resolve(user),
      updateUser: () => Promise.resolve(user),
    } as unknown as OpenSubListsRepository;
    const service = new OpenSubListsService(repository);

    await expect(service.updateMe(user.id, { emailRemindersPaused: false })).resolves.toMatchObject(
      {
        emailRemindersPaused: false,
      },
    );
  });

  it("rejects an actual unpause while the sender is unavailable", async () => {
    const user = userFixture({ emailRemindersPaused: true });
    const repository = {
      getUser: () => Promise.resolve(user),
    } as unknown as OpenSubListsRepository;
    const service = new OpenSubListsService(repository);

    await expect(service.updateMe(user.id, { emailRemindersPaused: false })).rejects.toMatchObject({
      code: "EMAIL_REMINDERS_UNAVAILABLE",
    });
  });
});

function userFixture(patch: Partial<AppUser>): AppUser {
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
