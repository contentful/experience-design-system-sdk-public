import { describe, expect, it } from 'vitest';
import { computeColumnWidths } from '../../../../../src/tui/import/steps/07-scope-gate/columns.js';
import { resolveKey, type GateContext } from '../../../../../src/tui/import/steps/07-scope-gate/keymap.js';

describe('scope gate token column', () => {
  it('is only shown when there are tokens and room for them', () => {
    expect(computeColumnWidths(140, true).layout).toBe('two-column');
    expect(computeColumnWidths(140, false).layout).toBe('single');
    expect(computeColumnWidths(80, true).layout).toBe('single');
  });

  it('is read only: decisions are ignored while it has focus', () => {
    const ctx: GateContext = {
      focusedColumn: 'tokens',
      singleColumn: false,
      hasCycles: false,
      hasFlagReasons: false,
      jumpFilterActive: false,
      searchActive: false,
      focusedListEmpty: false,
    };
    for (const input of ['a', 'r', 'i']) expect(resolveKey('main', { input }, ctx)).toEqual({ type: 'none' });
    expect(resolveKey('main', { input: '', return: true }, ctx)).toEqual({ type: 'none' });
    expect(resolveKey('main', { input: '', downArrow: true }, ctx)).toEqual({ type: 'move', delta: 1 });
    expect(resolveKey('main', { input: '', tab: true }, ctx)).toEqual({ type: 'switch-column', delta: 1 });
  });
});

describe('scope gate token column width', () => {
  it('grows to fit the tokens but only into the space beside the components', () => {
    expect(computeColumnWidths(200, true, 70).tokens).toBe(70);
    expect(computeColumnWidths(200, true, 500).tokens).toBe(200 - 4 - 54 - 2);
    expect(computeColumnWidths(110, true, 20).tokens).toBe(44);
  });
});
