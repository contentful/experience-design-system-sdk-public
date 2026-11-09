import { describe, expect, it } from 'vitest';
import {
  hasImportableFiles,
  keyAction,
  phaseOf,
  type FileCounts,
  type ScanResult,
} from '../../../src/tui/import/steps/03-path-validation/logic.js';
import { controlsFor } from '../../../src/tui/import/steps/03-path-validation/controls.js';

function counts(overrides: Partial<FileCounts> = {}): FileCounts {
  return { tsx: 0, ts: 0, vue: 0, astro: 0, jsx: 0, js: 0, json: 0, other: 0, total: 0, ...overrides };
}

function scanned(overrides: Partial<FileCounts> = {}): ScanResult {
  return { ok: true, counts: counts(overrides), filePaths: [], warnings: [] };
}

const ENTER = { return: true, escape: false };
const ESCAPE = { return: false, escape: true };
const NONE = { return: false, escape: false };

describe('phaseOf', () => {
  it('is scanning until the scan returns', () => {
    expect(phaseOf(undefined)).toBe('scanning');
  });

  it('is failed when the scan failed', () => {
    expect(phaseOf({ ok: false, failure: 'not-found' })).toBe('failed');
  });

  it('is empty for a directory with no files at all', () => {
    expect(phaseOf(scanned())).toBe('empty');
    expect(phaseOf(scanned(), { hasTokens: false })).toBe('empty');
  });

  it('is empty when the only files are not importable', () => {
    expect(phaseOf(scanned({ other: 4, total: 4 }))).toBe('empty');
  });

  it('is ready when there are component files', () => {
    expect(phaseOf(scanned({ tsx: 2, total: 2 }))).toBe('ready');
    expect(phaseOf(scanned({ vue: 1, total: 1 }), { hasTokens: false })).toBe('ready');
  });

  it('counts .json files only when the import generates tokens', () => {
    const jsonOnly = scanned({ json: 3, total: 3 });
    expect(phaseOf(jsonOnly, { hasTokens: true })).toBe('ready');
    expect(phaseOf(jsonOnly, { hasTokens: false })).toBe('empty');
  });
});

describe('hasImportableFiles', () => {
  it('is true for any component file type', () => {
    for (const type of ['tsx', 'ts', 'vue', 'astro', 'jsx', 'js'] as const) {
      expect(hasImportableFiles(counts({ [type]: 1, total: 1 }))).toBe(true);
    }
  });

  it('is false for an empty scan', () => {
    expect(hasImportableFiles(counts())).toBe(false);
  });
});

describe('keyAction', () => {
  it('lets Enter confirm only when the scan is ready', () => {
    expect(keyAction('ready', '', ENTER)).toBe('confirm');
    expect(keyAction('empty', '', ENTER)).not.toBe('confirm');
    expect(keyAction('failed', '', ENTER)).not.toBe('confirm');
    expect(keyAction('scanning', '', ENTER)).toBeUndefined();
  });

  it('sends Enter and e to a different path from an empty scan', () => {
    expect(keyAction('empty', '', ENTER)).toBe('change-path');
    expect(keyAction('empty', 'e', NONE)).toBe('change-path');
  });

  it('goes back on Escape in every phase', () => {
    for (const phase of ['scanning', 'ready', 'empty', 'failed'] as const) {
      expect(keyAction(phase, '', ESCAPE)).toBe('back');
    }
  });
});

describe('controlsFor', () => {
  it('does not offer to continue from an empty scan', () => {
    const labels = controlsFor('empty').map((control) => control.label);
    expect(labels).not.toContain('Yes, continue');
    expect(labels).toContain('Try a different path');
  });
});
