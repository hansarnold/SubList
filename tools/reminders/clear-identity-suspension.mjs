#!/usr/bin/env node

import {
  parseClearIdentitySuspensionArguments,
  runClearIdentitySuspension,
} from "./clear-identity-suspension.js";

const usage = `Usage:
  node tools/reminders/clear-identity-suspension.mjs \\
    --user-id <uuid> --confirm-user-id <same-uuid> \\
    --database <binding-or-name> --config <private-wrangler-config> \\
    (--remote | --local) [--env <environment>]
`;

try {
  const options = parseClearIdentitySuspensionArguments(process.argv.slice(2));
  await runClearIdentitySuspension(options);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown suspension-clear failure.";
  process.stderr.write(`${message}\n\n${usage}`);
  process.exitCode = 1;
}
