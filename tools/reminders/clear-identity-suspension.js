import { spawn } from "node:child_process";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildClearIdentitySuspensionSql(userId) {
  if (!UUID_PATTERN.test(userId)) throw new Error("--user-id must be a UUID.");
  return `UPDATE users
SET email_reminder_suspension_reason = NULL,
    email_reminder_suspension_email_normalized = NULL,
    email_reminders_paused = 1,
    email_reminder_revision = email_reminder_revision + 1,
    updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE id = '${userId}'
  AND email_reminder_suspension_reason = 'identity_email_conflict'
  AND email_reminder_suspension_email_normalized IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users AS owner
    WHERE owner.id <> users.id
      AND owner.email_normalized = users.email_reminder_suspension_email_normalized
  );
UPDATE renewal_email_deliveries AS delivery
SET status = 'cancelled',
    next_attempt_at = NULL,
    last_error_code = 'preference_or_revision_changed',
    updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE delivery.user_id = '${userId}'
  AND delivery.status IN ('pending', 'retry_wait')
  AND delivery.planned_user_reminder_revision <> (
    SELECT email_reminder_revision FROM users WHERE id = delivery.user_id
  );
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = '${userId}') THEN 'not_found'
  WHEN EXISTS (
    SELECT 1 FROM users
    WHERE id = '${userId}' AND email_reminder_suspension_reason IS NULL
  ) THEN 'cleared_or_not_suspended'
  ELSE 'still_conflicted'
END AS result;`;
}

export function parseClearIdentitySuspensionArguments(args) {
  const options = { remote: false, local: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--remote") options.remote = true;
    else if (argument === "--local") options.local = true;
    else if (
      ["--user-id", "--confirm-user-id", "--config", "--database", "--env"].includes(argument)
    ) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`${argument} requires a value.`);
      const key = {
        "--user-id": "userId",
        "--confirm-user-id": "confirmUserId",
        "--config": "configPath",
        "--database": "database",
        "--env": "environment",
      }[argument];
      options[key] = value;
      index += 1;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  if (!options.userId || !options.confirmUserId || !options.configPath || !options.database) {
    throw new Error("--user-id, --confirm-user-id, --config, and --database are required.");
  }
  if (options.userId !== options.confirmUserId) {
    throw new Error("--confirm-user-id must exactly match --user-id.");
  }
  if (!UUID_PATTERN.test(options.userId)) throw new Error("--user-id must be a UUID.");
  if (options.remote === options.local)
    throw new Error("Choose exactly one of --remote or --local.");
  return options;
}

export async function runClearIdentitySuspension(options) {
  const args = [
    "wrangler",
    "d1",
    "execute",
    options.database,
    "--config",
    options.configPath,
    options.remote ? "--remote" : "--local",
    "--command",
    buildClearIdentitySuspensionSql(options.userId),
  ];
  if (options.environment) args.push("--env", options.environment);
  await new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, { stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Wrangler exited with status ${code ?? "unknown"}.`));
    });
  });
}
