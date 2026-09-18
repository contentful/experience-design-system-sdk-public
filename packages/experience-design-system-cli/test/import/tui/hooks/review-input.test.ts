import { describe, expect, it, vi } from 'vitest';
import type { ImmediateInputKey } from '../../../../src/analyze/select/tui/hooks/useImmediateInput.js';
import {
  handleReviewPanelShortcuts,
  type ReviewPanelShortcutState,
} from '../../../../src/import/tui/hooks/review-input.js';

function key(overrides: Partial<ImmediateInputKey> = {}): ImmediateInputKey {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    shiftTab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...overrides,
  };
}

function state(overrides: Partial<ReviewPanelShortcutState> = {}): ReviewPanelShortcutState {
  return {
    panelOpen: 'none',
    setPanelOpen: vi.fn() as ReviewPanelShortcutState['setPanelOpen'],
    panelScrollOffset: 0,
    setPanelScrollOffset: vi.fn() as ReviewPanelShortcutState['setPanelScrollOffset'],
    tokenReviewRow: 0,
    setTokenReviewRow: vi.fn() as ReviewPanelShortcutState['setTokenReviewRow'],
    tokenReviewEditing: false,
    setTokenReviewEditing: vi.fn() as ReviewPanelShortcutState['setTokenReviewEditing'],
    tokenReviewEditCursor: 0,
    setTokenReviewEditCursor: vi.fn() as ReviewPanelShortcutState['setTokenReviewEditCursor'],
    tokenReviewEditSelection: new Set(),
    setTokenReviewEditSelection: vi.fn() as ReviewPanelShortcutState['setTokenReviewEditSelection'],
    currentTokenSuggestions: () => [],
    handleTokenEditSave: vi.fn(),
    textEntryActive: false,
    showJson: false,
    propKey: 'i',
    componentKey: 'I',
    ...overrides,
  };
}

describe('handleReviewPanelShortcuts', () => {
  it.each([
    { propKey: 'i', componentKey: 'I' },
    { propKey: 'p', componentKey: 'P' },
  ])('opens the parameterized rationale panels ($propKey/$componentKey)', ({ propKey, componentKey }) => {
    const propState = state({ propKey, componentKey });
    expect(handleReviewPanelShortcuts(propKey, key(), propState)).toBe(true);
    expect(propState.setPanelOpen).toHaveBeenCalledWith('prop-rationale');

    const componentState = state({ propKey, componentKey });
    expect(handleReviewPanelShortcuts(componentKey, key(), componentState)).toBe(true);
    expect(componentState.setPanelOpen).toHaveBeenCalledWith('component-rationale');
  });

  it('opens the source and token-review panels', () => {
    const sourceState = state();
    expect(handleReviewPanelShortcuts('s', key(), sourceState)).toBe(true);
    expect(sourceState.setPanelOpen).toHaveBeenCalledWith('source');

    const tokenState = state({
      currentTokenSuggestions: () => [{ propName: 'color', paths: ['color.red'], suggested: [], allowed: [] }],
    });
    expect(handleReviewPanelShortcuts('t', key(), tokenState)).toBe(true);
    expect(tokenState.setPanelOpen).toHaveBeenCalledWith('token-review');
    expect(tokenState.setTokenReviewRow).toHaveBeenCalledWith(0);
  });

  it.each([
    { textEntryActive: true, showJson: false },
    { textEntryActive: false, showJson: true },
  ])('gates rationale shortcuts on text/JSON surfaces', ({ textEntryActive, showJson }) => {
    const shortcutState = state({ textEntryActive, showJson });

    expect(handleReviewPanelShortcuts('i', key(), shortcutState)).toBe(false);
    expect(shortcutState.setPanelOpen).not.toHaveBeenCalled();
    expect(shortcutState.setPanelScrollOffset).not.toHaveBeenCalled();
  });
});
