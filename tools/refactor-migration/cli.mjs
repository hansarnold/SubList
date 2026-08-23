#!/usr/bin/env node

import { migrateArchiveFiles, RefactorMigrationError } from "./index.js";

const USAGE = `Usage:
  pnpm migration:refactor -- --input <archive-v1.json> --output-dir <private-directory> [options]

Options:
  --symbols <symbol-map.json>  Apply an explicit, validated symbol mapping.
  --overwrite                  Replace the three known output files intentionally.
  --help                       Show this help.
`;

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    process.exitCode = 0;
  } else {
    const result = await migrateArchiveFiles(options);
    process.stdout.write(
      [
        "Refactor migration artifacts created:",
        `  Archive: ${result.archivePath}`,
        `  Review: ${result.reviewPath}`,
        `  Report: ${result.reportPath}`,
        `  Source: ${result.sourceSha256}`,
        `  Output: ${result.outputSha256}`,
        "",
      ].join("\n"),
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown migration failure.";
  const code = error instanceof RefactorMigrationError ? error.code : "MIGRATION_FAILED";
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const result = { overwrite: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      result.help = true;
    } else if (argument === "--overwrite") {
      result.overwrite = true;
    } else if (argument === "--input" || argument === "--output-dir" || argument === "--symbols") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.\n\n${USAGE}`);
      }
      const key =
        argument === "--input"
          ? "inputPath"
          : argument === "--output-dir"
            ? "outputDirectory"
            : "symbolMapPath";
      if (result[key] !== undefined) throw new Error(`${argument} may be provided only once.`);
      result[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}\n\n${USAGE}`);
    }
  }

  if (!result.help && (result.inputPath === undefined || result.outputDirectory === undefined)) {
    throw new Error(`--input and --output-dir are required.\n\n${USAGE}`);
  }
  return result;
}
