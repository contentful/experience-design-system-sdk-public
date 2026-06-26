import { describe, it, expect } from 'vitest';
import { nextStateAfterPrint } from '../../../src/import/tui/run-print-files-helpers.js';
import { parsePrintTokensCount } from '../../../src/import/tui/WizardApp.js';

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

describe('parsePrintTokensCount', () => {
  it('extracts the count from the standard "wrote tokens.json (N tokens)" line', () => {
    expect(parsePrintTokensCount('wrote tokens.json (12 tokens)\n')).toBe(12);
  });

  it('handles the singular form', () => {
    expect(parsePrintTokensCount('wrote tokens.json (1 token)\n')).toBe(1);
  });

  it('returns 0 when no count is present', () => {
    expect(parsePrintTokensCount('')).toBe(0);
    expect(parsePrintTokensCount('something unrelated\n')).toBe(0);
  });
});
