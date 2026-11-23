#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runProfiledImport } from './import-profiling/run.mjs';
import { writeProfileReport } from './import-profiling/report.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function parseProfileArguments(args) {
  let directory;
  let reportDirectory;
  let sampleIntervalMs = 1000;
  let index = 0;
  for (; index < args.length; index++) {
    const option = args[index];
    if (option === '--') {
      index++;
      break;
    }
    if (option === '--profile-dir' || option === '--report') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('A profile directory is required.');
      if (option === '--report') reportDirectory = value;
      else directory = value;
    } else if (option === '--sample-interval-ms') {
      sampleIntervalMs = Number(args[++index]);
      if (!Number.isInteger(sampleIntervalMs) || sampleIntervalMs < 100)
        throw new Error('The sampling interval must be an integer of at least 100 ms.');
    } else break;
  }
  return {
    ...(directory ? { directory } : {}),
    ...(reportDirectory ? { reportDirectory } : {}),
    sampleIntervalMs,
    importArgs: args.slice(index),
  };
}

async function main() {
  const { directory, reportDirectory, sampleIntervalMs, importArgs } = parseProfileArguments(process.argv.slice(2));
  if (reportDirectory) {
    await writeProfileReport(resolve(reportDirectory));
    process.stdout.write(`${join(resolve(reportDirectory), 'summary.md')}\n`);
    return;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = directory ?? join(root, '.import-profiles', `${timestamp}-${randomUUID().slice(0, 8)}`);
  const result = await runProfiledImport({
    entryPoint: join(root, 'packages/experience-design-system-cli/bin/cli.js'),
    importArgs,
    directory: output,
    sampleIntervalMs,
  });
  process.exitCode = result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
