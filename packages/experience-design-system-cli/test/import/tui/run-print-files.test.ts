import { describe, expect, it } from 'vitest';
import { nextStateAfterPrint } from '../../../src/import/tui/run-print-files-helpers.js';

describe('nextStateAfterPrint', () => {
  it('default (skipGate false) returns step="print-gate" plus componentsPath', () => {
    const next = nextStateAfterPrint({ componentsPath: '/tmp/out/components.json' });
    expect(next).toEqual({
      step: 'print-gate',
      componentsPath: '/tmp/out/components.json',
    });
  });

  it('skipGate=false explicit returns step="print-gate" plus componentsPath', () => {
    const next = nextStateAfterPrint({
      skipGate: false,
      componentsPath: '/tmp/out/components.json',
    });
    expect(next).toEqual({
      step: 'print-gate',
      componentsPath: '/tmp/out/components.json',
    });
  });

  it('skipGate=true returns componentsPath only, no step field', () => {
    const next = nextStateAfterPrint({
      skipGate: true,
      componentsPath: '/tmp/out/components.json',
    });
    expect(next).toEqual({ componentsPath: '/tmp/out/components.json' });
    expect(next).not.toHaveProperty('step');
  });
});
