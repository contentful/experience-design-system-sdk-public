import { resolve } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerApplyCommand } from '../../src/apply/command.js';
import { registerPrintCommand } from '../../src/print/command.js';

const componentsPath = resolve(import.meta.dirname, '../fixtures/import/components.json');

describe('command routing when raw mode is unavailable', () => {
  const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const stdinSetRawMode = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode');
  const stdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

  beforeEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdin, 'setRawMode', {
      configurable: true,
      value: () => {
        throw new Error('unsupported console mode');
      },
    });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (stdinIsTTY) Object.defineProperty(process.stdin, 'isTTY', stdinIsTTY);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (stdinSetRawMode) Object.defineProperty(process.stdin, 'setRawMode', stdinSetRawMode);
    else delete (process.stdin as { setRawMode?: (enabled: boolean) => unknown }).setRawMode;
    if (stdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTY);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  });

  it('stops an interactive-only command before Ink and names its headless flags', async () => {
    const program = new Command();
    program.exitOverride();
    registerApplyCommand(program);

    await expect(
      program.parseAsync(
        ['apply', 'select', '--space-id', 'space', '--environment-id', 'master', '--cma-token', 'token'],
        { from: 'user' },
      ),
    ).rejects.toThrow(/standard input cannot enter raw mode[\s\S]*--select-all[\s\S]*--select[\s\S]*--deselect/);
  });

  it('keeps explicit non-interactive flags ahead of the capability guard', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
    const program = new Command();
    program.exitOverride();
    registerApplyCommand(program);

    await expect(
      program.parseAsync(
        [
          'apply',
          'select',
          '--select-all',
          '--space-id',
          'space',
          '--environment-id',
          'master',
          '--cma-token',
          'token',
        ],
        { from: 'user' },
      ),
    ).rejects.toThrow('exit:1');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('routes a read-only result view to plain output instead of mounting Ink', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
    const program = new Command();
    program.exitOverride();
    registerPrintCommand(program);

    await expect(
      program.parseAsync(['print', 'validate', '--components', componentsPath], { from: 'user' }),
    ).rejects.toThrow('exit:0');
    expect(writes.join('')).toContain('Valid');
  });
});
