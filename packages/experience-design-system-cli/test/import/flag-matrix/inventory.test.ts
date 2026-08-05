import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { IMPORT_FLAGS } from './flags.js';
import { registerImportCommand } from '../../../src/import/command.js';

function registeredImportFlags(): string[] {
  const program = new Command();
  registerImportCommand(program);
  const importCommand = program.commands.find((command) => command.name() === 'import');
  if (!importCommand) throw new Error('Import command was not registered');
  return importCommand.options
    .map((option) => {
      if (!option.long) throw new Error('Import command registered an option without a long flag');
      return option.long;
    })
    .sort();
}

describe('import flag inventory completeness', () => {
  const parsedFlags = registeredImportFlags();
  const inventoryFlags = [...new Set(IMPORT_FLAGS.map((f) => f.flag))].sort();

  it('registers at least the known-large flag set', () => {
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
      `registered flags missing from flags.ts inventory: ${missingFromInventory.join(', ')}`,
    ).toEqual([]);
    expect(extraInInventory, `flags in flags.ts inventory but not registered: ${extraInInventory.join(', ')}`).toEqual(
      [],
    );
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
