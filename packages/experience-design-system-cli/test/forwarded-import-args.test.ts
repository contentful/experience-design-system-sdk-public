import { describe, expect, it } from 'vitest';
import { forwardedImportArgs } from '../src/legacy/forwarded-import-args.js';

describe('forwardedImportArgs', () => {
  it('strips the leading import subcommand', () => {
    expect(forwardedImportArgs(['import', '--project', './src', '--no-cache'])).toEqual([
      '--project',
      './src',
      '--no-cache',
    ]);
  });

  it('keeps flags when import is the implicit default command', () => {
    expect(forwardedImportArgs(['--tokens', './theme.css'])).toEqual(['--tokens', './theme.css']);
  });

  it('returns nothing for a bare import so the TUI launches', () => {
    expect(forwardedImportArgs(['import'])).toEqual([]);
    expect(forwardedImportArgs([])).toEqual([]);
  });
});
