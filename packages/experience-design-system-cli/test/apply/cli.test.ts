import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerApplyCommand } from '../../src/apply/command.js';

describe('apply command — help', () => {
  it('keeps the apply flag inventory stable when options are registered through helpers', () => {
    const program = new Command();
    registerApplyCommand(program);
    const apply = program.commands.find((command) => command.name() === 'apply');
    expect(apply).toBeDefined();

    const flags = apply!.options.map((option) => option.long).sort();

    expect(flags).toEqual(['--components', '--tokens']);
  });
});
