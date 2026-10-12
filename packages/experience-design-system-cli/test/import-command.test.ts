import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerImportCommand } from '../src/commands/import.js';
import type { ImportOptions } from '../src/commands/import-options.js';

// Parses with the real Commander registration, the way `experiences import ...` does, and returns what the TUI is given.
async function optionsFor(argv: string[]): Promise<ImportOptions | undefined> {
  const openTui = vi.fn<(options: ImportOptions) => Promise<void>>().mockResolvedValue(undefined);
  const program = new Command().exitOverride();
  registerImportCommand(program, openTui);

  const original = process.argv;
  process.argv = ['node', 'experiences', ...argv];
  try {
    await program.parseAsync(process.argv);
  } finally {
    process.argv = original;
  }
  return openTui.mock.calls[0]?.[0];
}

describe('import command options', () => {
  it('gives the TUI the defaults for a bare import', async () => {
    expect(await optionsFor([])).toEqual({ prompt: [], cache: true });
  });

  it('reads every flag after the import subcommand', async () => {
    expect(
      await optionsFor([
        'import',
        '--agent',
        'codex:gpt-5',
        '--prompt',
        'select=./a.md',
        '--prompt',
        'token=literal',
        '--no-cache',
      ]),
    ).toEqual({ agent: 'codex:gpt-5', prompt: ['select=./a.md', 'token=literal'], cache: false });
  });

  it('reads the flags when import is the implicit default command', async () => {
    expect(await optionsFor(['--agent', 'claude', '--no-cache'])).toEqual({
      agent: 'claude',
      prompt: [],
      cache: false,
    });
  });

  it('still accepts flags it does not know, so they reach the rest of the CLI', async () => {
    expect(await optionsFor(['--agent', 'claude', '--something-else', 'x'])).toEqual({
      agent: 'claude',
      prompt: [],
      cache: true,
    });
  });
});
