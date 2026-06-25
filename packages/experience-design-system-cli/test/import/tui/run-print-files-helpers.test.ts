import { describe, it, expect } from 'vitest';
import { nextStateAfterPrint } from '../../../src/import/tui/run-print-files-helpers.js';

describe('nextStateAfterPrint', () => {
  it('returns componentsPath only when skipGate is set', () => {
    const r = nextStateAfterPrint({ skipGate: true, componentsPath: '/x/components.json' });
    expect(r).toEqual({ componentsPath: '/x/components.json' });
  });

  it('returns print-gate step + path otherwise', () => {
    const r = nextStateAfterPrint({ componentsPath: '/x/components.json' });
    expect(r).toEqual({ step: 'print-gate', componentsPath: '/x/components.json' });
  });

  it('includes outDir when provided', () => {
    const r = nextStateAfterPrint({ componentsPath: '/x/components.json', outDir: '/x' });
    expect(r).toEqual({ step: 'print-gate', componentsPath: '/x/components.json', outDir: '/x' });
  });

  it('includes outDir under skipGate when provided', () => {
    const r = nextStateAfterPrint({ skipGate: true, componentsPath: '/x/components.json', outDir: '/x' });
    expect(r).toEqual({ componentsPath: '/x/components.json', outDir: '/x' });
  });
});
