#!/usr/bin/env node

import { migrateLocaleArchiveFile, ReminderMigrationError } from "../reminder-migration/index.js";

const usage = `Usage:
  node tools/locale-migration/cli.mjs --input <archive-v3.json> --output <archive-v4.json> [--overwrite]
`;

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
  } else {
    await migrateLocaleArchiveFile(options);
    process.stdout.write(`Split-locale archive created: ${options.outputPath}\n`);
  }
} catch (error) {
  const code = error instanceof ReminderMigrationError ? error.code : "MIGRATION_FAILED";
  const message = error instanceof Error ? error.message : "Unknown migration failure.";
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const result = { overwrite: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") result.help = true;
    else if (argument === "--overwrite") result.overwrite = true;
    else if (argument === "--input" || argument === "--output") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(usage);
      if (argument === "--input") result.inputPath = value;
      else result.outputPath = value;
      index += 1;
    } else throw new Error(`Unknown option: ${argument}\n\n${usage}`);
  }
  if (!result.help && (!result.inputPath || !result.outputPath)) throw new Error(usage);
  return result;
}
