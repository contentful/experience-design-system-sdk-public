import { describe, expect, it } from 'vitest';
import {
  addFile,
  describeFailure,
  emptyCounts,
  failureFromErrorCode,
  keyAction,
  mergeCounts,
  phaseOf,
  summarize,
} from '../../src/tui/import/steps/03-path-validation/logic.js';

const noKey = { escape: false, return: false };

describe('addFile', () => {
  it('counts each extension in its own category and in the total', () => {
    const counts = [
      'Button.tsx',
      'index.ts',
      'App.vue',
      'Hero.astro',
      'Old.jsx',
      'util.js',
      'tokens.json',
      'README.md',
    ].reduce(addFile, emptyCounts());
    expect(counts).toEqual({ tsx: 1, ts: 1, vue: 1, astro: 1, jsx: 1, js: 1, json: 1, other: 1, total: 8 });
  });

  it('does not count type declaration files as components', () => {
    expect(addFile(emptyCounts(), 'types.d.ts')).toMatchObject({ ts: 0, other: 1, total: 1 });
  });

  it('puts files with no extension in other', () => {
    expect(addFile(emptyCounts(), 'Makefile')).toMatchObject({ other: 1, total: 1 });
  });
});

describe('mergeCounts', () => {
  it('adds every category', () => {
    const a = addFile(addFile(emptyCounts(), 'a.tsx'), 'b.json');
    const b = addFile(emptyCounts(), 'c.tsx');
    expect(mergeCounts(a, b)).toMatchObject({ tsx: 2, json: 1, total: 3 });
  });
});

describe('failureFromErrorCode', () => {
  it('maps the filesystem error codes the screen explains', () => {
    expect(failureFromErrorCode('ENOENT')).toBe('not-found');
    expect(failureFromErrorCode('EACCES')).toBe('permission-denied');
    expect(failureFromErrorCode('EIO')).toBe('unreadable');
    expect(failureFromErrorCode(undefined)).toBe('unreadable');
  });
});

describe('describeFailure', () => {
  it('explains a file passed instead of a directory', () => {
    expect(describeFailure('is-file', '/x').headline).toBe("That's a file, not a directory.");
  });

  it('names the path for a missing directory', () => {
    expect(describeFailure('not-found', '/missing').headline).toBe('Directory not found: /missing');
  });
});

describe('summarize', () => {
  it('lists only categories that have files, in a fixed order', () => {
    const counts = ['a.ts', 'b.tsx', 'c.tsx', 'tokens.json'].reduce(addFile, emptyCounts());
    const { rows, warning } = summarize(counts);
    expect(rows.map((r) => [r.label, r.count])).toEqual([
      ['.tsx files', 2],
      ['.ts files', 1],
      ['.json files (design tokens)', 1],
    ]);
    expect(warning).toBeUndefined();
  });

  it('warns when only token files are found', () => {
    expect(summarize(addFile(emptyCounts(), 'tokens.json')).warning).toBe(
      'No component files found — only token files detected.',
    );
  });

  it('warns when nothing useful is found', () => {
    expect(summarize(addFile(emptyCounts(), 'notes.txt')).warning).toBe(
      'No component or token files found. Try a different path.',
    );
  });
});

describe('phaseOf', () => {
  it('is scanning until a result arrives, then ready or failed', () => {
    expect(phaseOf(undefined)).toBe('scanning');
    expect(phaseOf({ ok: true, counts: emptyCounts() })).toBe('ready');
    expect(phaseOf({ ok: false, failure: 'not-found' })).toBe('failed');
  });
});

describe('keyAction', () => {
  it('goes back on Esc in every phase', () => {
    for (const phase of ['scanning', 'ready', 'failed'] as const) {
      expect(keyAction(phase, '', { ...noKey, escape: true })).toBe('back');
    }
  });

  it('confirms with Enter only when the scan succeeded', () => {
    expect(keyAction('ready', '', { ...noKey, return: true })).toBe('confirm');
    expect(keyAction('scanning', '', { ...noKey, return: true })).toBeUndefined();
  });

  it('changes the path with e when ready, and with Enter or e when it failed', () => {
    expect(keyAction('ready', 'e', noKey)).toBe('change-path');
    expect(keyAction('failed', 'e', noKey)).toBe('change-path');
    expect(keyAction('failed', '', { ...noKey, return: true })).toBe('change-path');
    expect(keyAction('scanning', 'e', noKey)).toBeUndefined();
  });

  it('treats q and s as ordinary letters', () => {
    expect(keyAction('ready', 'q', noKey)).toBeUndefined();
    expect(keyAction('ready', 's', noKey)).toBeUndefined();
  });
});
