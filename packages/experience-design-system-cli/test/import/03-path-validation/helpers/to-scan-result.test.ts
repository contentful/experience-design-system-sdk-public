import { describe, expect, it } from 'vitest';
import { toScanResult } from '../../../../src/tui/import/steps/03-path-validation/helpers/to-scan-result.js';

describe('toScanResult', () => {
  it('maps a successful outcome to an ok ScanResult with folded counts, filePaths and warnings', () => {
    expect(
      toScanResult({
        ok: true,
        result: {
          counts: {
            tsx: 2,
            ts: 1,
            vue: 0,
            astro: 0,
            jsx: 0,
            js: 0,
            json: 1,
            svelte: 1,
            md: 1,
            other: 0,
            total: 6,
          },
          filePaths: ['/a/Button.tsx', '/a/notes.md'],
          warnings: ['one warning'],
        },
      }),
    ).toEqual({
      ok: true,
      counts: { tsx: 2, ts: 1, vue: 0, astro: 0, jsx: 0, js: 0, json: 1, other: 2, total: 6 },
      filePaths: ['/a/Button.tsx', '/a/notes.md'],
      warnings: ['one warning'],
    });
  });

  it('forwards a failure outcome unchanged', () => {
    expect(toScanResult({ ok: false, failure: 'not-found' })).toEqual({ ok: false, failure: 'not-found' });
  });
});
