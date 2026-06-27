import { describe, it, expect } from 'vitest';
import { buildAutoFilterErrorTail } from '../../../src/import/tui/auto-filter-error.js';

describe('buildAutoFilterErrorTail', () => {
  it('keeps the real error line and drops progress= lines', () => {
    const raw = [
      'progress=select-agent:10/12:rejected:Portal:utility%20wrapper',
      '  [10/12]  Portal  rejected  utility wrapper',
      'Error: database is locked: another CLI process may be running.',
    ].join('\n');
    expect(buildAutoFilterErrorTail(raw)).toBe('Error: database is locked: another CLI process may be running.');
  });

  it('drops per-component [N/total] status lines', () => {
    const raw = [
      '  [3/5]  Modal  accepted  primary surface',
      '  [4/5]  Spinner  rejected  utility',
      'Error: something else broke',
    ].join('\n');
    expect(buildAutoFilterErrorTail(raw)).toBe('Error: something else broke');
  });

  it('joins up to 3 non-structured tail lines with " / "', () => {
    const raw = [
      'progress=select-agent:1/1:accepted:Foo:',
      'context line 1',
      'context line 2',
      'context line 3',
      'context line 4',
    ].join('\n');
    expect(buildAutoFilterErrorTail(raw)).toBe('context line 2 / context line 3 / context line 4');
  });

  it('strips ANSI color codes from the tail', () => {
    const raw = '\x1b[31mError: red text\x1b[0m';
    expect(buildAutoFilterErrorTail(raw)).toBe('Error: red text');
  });

  it('returns empty string when only structured lines are present', () => {
    const raw = ['progress=select-agent:1/1:accepted:Foo:', '  [1/1]  Foo  accepted'].join('\n');
    expect(buildAutoFilterErrorTail(raw)).toBe('');
  });
});
