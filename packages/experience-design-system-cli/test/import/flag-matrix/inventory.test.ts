import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IMPORT_FLAGS } from './flags.js';

const COMMAND_SOURCE = resolve(import.meta.dirname, '../../../src/import/command.ts');

function parseOptionFlagsFromSource(source: string): string[] {
  const flags = new Set<string>();
  const optionRe = /\.option\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gs;
  let match: RegExpExecArray | null;
  while ((match = optionRe.exec(source)) !== null) {
    const optionString = match[2];
    const flagMatch = optionString.match(/--[a-z][a-z-]*/);
    if (flagMatch) flags.add(flagMatch[0]);
  }
  return [...flags].sort();
}

describe('import flag inventory completeness', () => {
  const source = readFileSync(COMMAND_SOURCE, 'utf8');
  const parsedFlags = parseOptionFlagsFromSource(source);
  const inventoryFlags = [...new Set(IMPORT_FLAGS.map((f) => f.flag))].sort();

  it('parses at least the known-large flag set from command.ts (multi-line tolerant)', () => {
    expect(parsedFlags.length).toBeGreaterThanOrEqual(40);
  });

  it('every inventory flag key is unique', () => {
    const keys = IMPORT_FLAGS.map((f) => f.flag);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('parser-derived flag set EXACTLY equals the inventory flag keys', () => {
    const missingFromInventory = parsedFlags.filter((f) => !inventoryFlags.includes(f));
    const extraInInventory = inventoryFlags.filter((f) => !parsedFlags.includes(f));

    expect(
      missingFromInventory,
      `flags in command.ts but missing from flags.ts inventory: ${missingFromInventory.join(', ')}`,
    ).toEqual([]);
    expect(
      extraInInventory,
      `flags in flags.ts inventory but not found in command.ts: ${extraInInventory.join(', ')}`,
    ).toEqual([]);
    expect(inventoryFlags).toEqual(parsedFlags);
  });

  it('every value flag defines a usable sampleValue', () => {
    const valueFlagsWithoutSample = IMPORT_FLAGS.filter((f) => f.kind === 'value' && !f.sampleValue).map((f) => f.flag);
    expect(valueFlagsWithoutSample).toEqual([]);
  });

  it('incompatibility declarations are symmetric', () => {
    const byFlag = new Map(IMPORT_FLAGS.map((f) => [f.flag, f]));
    const asymmetric: string[] = [];
    for (const spec of IMPORT_FLAGS) {
      for (const other of spec.incompatibleWith) {
        const otherSpec = byFlag.get(other);
        if (!otherSpec || !otherSpec.incompatibleWith.includes(spec.flag)) {
          asymmetric.push(`${spec.flag} -> ${other}`);
        }
      }
    }
    expect(asymmetric, `asymmetric incompatibility edges: ${asymmetric.join(', ')}`).toEqual([]);
  });
});
