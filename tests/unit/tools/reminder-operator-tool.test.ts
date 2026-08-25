import { describe, expect, it } from "vitest";

// @ts-expect-error The operator tool is intentionally plain JavaScript outside the app TS build.
import * as untypedOperatorTool from "../../../tools/reminders/clear-identity-suspension.js";

type OperatorToolModule = {
  buildClearIdentitySuspensionSql: (userId: string) => string;
  parseClearIdentitySuspensionArguments: (args: string[]) => {
    userId: string;
    remote: boolean;
    local: boolean;
  };
};

const { buildClearIdentitySuspensionSql, parseClearIdentitySuspensionArguments } =
  untypedOperatorTool as unknown as OperatorToolModule;

const userId = "10000000-0000-4000-8000-000000000001";

describe("identity reminder suspension operator tool", () => {
  it("requires matching explicit confirmation and a deployment target", () => {
    expect(() =>
      parseClearIdentitySuspensionArguments([
        "--user-id",
        userId,
        "--confirm-user-id",
        "20000000-0000-4000-8000-000000000002",
        "--database",
        "DB",
        "--config",
        "wrangler.local.jsonc",
        "--remote",
      ]),
    ).toThrow(/exactly match/);
    expect(
      parseClearIdentitySuspensionArguments([
        "--user-id",
        userId,
        "--confirm-user-id",
        userId,
        "--database",
        "DB",
        "--config",
        "wrangler.local.jsonc",
        "--remote",
      ]),
    ).toMatchObject({ userId, remote: true, local: false });
  });

  it("rechecks ownership without accepting or selecting an email address", () => {
    const sql = buildClearIdentitySuspensionSql(userId);
    expect(sql).toContain(
      "owner.email_normalized = users.email_reminder_suspension_email_normalized",
    );
    expect(sql).toContain("email_reminders_paused = 1");
    expect(sql).toContain("email_reminder_revision = email_reminder_revision + 1");
    expect(sql).toContain("UPDATE renewal_email_deliveries AS delivery");
    expect(sql).not.toMatch(/SELECT\s+.*email_normalized/i);
    expect(sql).not.toContain("@");
  });
});
