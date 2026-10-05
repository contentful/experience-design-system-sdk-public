import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerApplyCommand } from '../../src/apply/command.js';

describe('apply command — input contract', () => {
  it('accepts one positional CDF file and no apply-specific flags', () => {
    const program = new Command();
    registerApplyCommand(program);
    const apply = program.commands.find((command) => command.name() === 'apply');
    expect(apply).toBeDefined();

    const flags = apply!.options
      .map((option) => option.long)
      .filter(Boolean)
      .sort();

    expect(flags).toEqual([]);
    expect(apply!.registeredArguments).toHaveLength(1);
    expect(apply!.registeredArguments[0]?.name()).toBe('file');
  });
});
