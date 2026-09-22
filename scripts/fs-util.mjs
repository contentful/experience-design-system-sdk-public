#!/usr/bin/env node
/**
 * The handful of filesystem operations our build steps need, as Node rather than
 * shell. `rm -rf` and `cp -r` don't exist on Windows, and nx runs these through
 * cmd.exe there, so every build target failed before this.
 *
 * Usage:
 *   node scripts/fs-util.mjs rm <path...>
 *   node scripts/fs-util.mjs cp <src> <dest>
 */
import { cpSync, rmSync } from 'node:fs';

const [operation, ...paths] = process.argv.slice(2);

switch (operation) {
  case 'rm':
    for (const path of paths) rmSync(path, { recursive: true, force: true });
    break;
  case 'cp': {
    const [source, destination] = paths;
    if (!source || !destination) {
      console.error('fs-util cp: expected <src> <dest>');
      process.exit(1);
    }
    cpSync(source, destination, { recursive: true });
    break;
  }
  default:
    console.error(`fs-util: unknown operation '${operation ?? ''}' (expected rm or cp)`);
    process.exit(1);
}
