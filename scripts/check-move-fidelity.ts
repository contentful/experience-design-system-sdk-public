/**
 * Checks that files moved from the legacy CLI into the v2 CLI are copies, apart from their imports.
 *
 * Usage: tsx scripts/check-move-fidelity.ts <map-file>
 * The map file has one `legacy/path|v2/path` per line, both relative to their package's `src`. For every pair it
 * compares the two files after dropping `import` statements and prints what differs. Exits 1 if anything does, so a
 * reviewer reads this output instead of the whole file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'packages');
const LEGACY = join(ROOT, 'experience-design-system-cli-legacy', 'src');
const V2 = join(ROOT, 'experience-design-system-cli', 'src', 'tui', 'import', 'steps', '09-review');

/** Removes import statements, single- and multi-line, and `import type`. */
function withoutImports(source: string): string[] {
  return source
    .replace(/^import\s[^;]*?from\s+['"][^'"]+['"];?\s*$/gms, '')
    .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line, i, all) => !(line === '' && (i === 0 || all[i - 1] === '')));
}

/** A minimal line diff: the lines only in `a` and only in `b`, in order. */
function differences(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, number>();
  for (const line of b) seen.set(line, (seen.get(line) ?? 0) + 1);
  for (const line of a) {
    const n = seen.get(line) ?? 0;
    if (n > 0) seen.set(line, n - 1);
    else out.push(`- ${line}`);
  }
  const have = new Map<string, number>();
  for (const line of a) have.set(line, (have.get(line) ?? 0) + 1);
  for (const line of b) {
    const n = have.get(line) ?? 0;
    if (n > 0) have.set(line, n - 1);
    else out.push(`+ ${line}`);
  }
  return out;
}

const mapFile = process.argv[2];
if (!mapFile) {
  console.error('usage: tsx scripts/check-move-fidelity.ts <map-file>');
  process.exit(2);
}

let identical = 0;
let changed = 0;
for (const entry of readFileSync(mapFile, 'utf8').split('\n').filter(Boolean)) {
  const [from, to] = entry.split('|');
  const diff = differences(
    withoutImports(readFileSync(join(LEGACY, from), 'utf8')),
    withoutImports(readFileSync(join(V2, to), 'utf8')),
  );
  if (diff.length === 0) {
    identical += 1;
    console.log(`same     ${to}`);
  } else {
    changed += 1;
    console.log(`CHANGED  ${to}\n${diff.map((line) => `           ${line}`).join('\n')}`);
  }
}
console.log(`\n${identical} identical apart from imports, ${changed} changed`);
process.exit(changed === 0 ? 0 : 1);
