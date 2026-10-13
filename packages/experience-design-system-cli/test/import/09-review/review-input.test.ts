import { describe, expect, it, vi } from 'vitest';
import type { ImmediateInputKey } from '../../../src/tui/import/steps/07-scope-gate/sidebar/hooks/useImmediateInput.js';
import {
  handleJsonPanelInput,
  handleReviewOverlayInput,
  handleReviewPanelShortcuts,
  handleReviewViewToggleInput,
  type ReviewPanelShortcutState,
} from '../../../src/tui/import/steps/09-review/review-input.js';

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

describe('handleReviewViewToggleInput', () => {
  it('toggles JSON view and resets JSON navigation', () => {
    const setShowJson = vi.fn();
    const setJsonScrollOffset = vi.fn();
    const pendingGRef = { current: true };
    const toggleState = {
      setShowJson,
      setJsonScrollOffset,
      pendingGRef,
    };

    expect(handleReviewViewToggleInput('J', toggleState)).toBe(true);
    expect(setShowJson).toHaveBeenCalledWith(expect.any(Function));
    expect(setJsonScrollOffset).toHaveBeenCalledWith(0);
    expect(pendingGRef.current).toBe(false);

    pendingGRef.current = true;
    expect(handleReviewViewToggleInput('H', toggleState)).toBe(false);
    expect(setJsonScrollOffset).toHaveBeenCalledTimes(1);
    expect(pendingGRef.current).toBe(true);
  });

  it('does not consume unrelated input', () => {
    const toggleState = {
      setShowJson: vi.fn(),
      setJsonScrollOffset: vi.fn(),
      pendingGRef: { current: true },
    };

    expect(handleReviewViewToggleInput('j', toggleState)).toBe(false);
    expect(toggleState.setShowJson).not.toHaveBeenCalled();
  });
});

describe('handleReviewOverlayInput', () => {
  const overlay = (overrides: Record<string, unknown> = {}) => ({
    loading: false,
    loadError: null as string | null,
    showFinalize: false,
    dialogOpen: false,
    showHelp: false,
    showReloadDialog: false,
    finalizePreview: { scrollBy: vi.fn() },
    reloadFromSave: vi.fn(),
    setShowReloadDialog: vi.fn(),
    onQuit: vi.fn(),
    handleUndo: vi.fn(),
    handleRedo: vi.fn(),
    ...overrides,
  });

  it('swallows every key while loading', () => {
    const state = overlay({ loading: true });

    expect(handleReviewOverlayInput('q', key(), state)).toBe(true);
    expect(state.onQuit).not.toHaveBeenCalled();
  });

  describe('after a load error', () => {
    it.each([
      ['q', 'q', key()],
      ['Esc', '', key({ escape: true })],
      ['Enter', '', key({ return: true })],
    ])('%s quits', (_label, input, pressed) => {
      const state = overlay({ loadError: 'No generated definitions found' });

      expect(handleReviewOverlayInput(input, pressed, state)).toBe(true);
      expect(state.onQuit).toHaveBeenCalledTimes(1);
    });

    it('swallows any other key without quitting', () => {
      const state = overlay({ loadError: 'boom' });

      expect(handleReviewOverlayInput('x', key(), state)).toBe(true);
      expect(state.onQuit).not.toHaveBeenCalled();
    });
  });

  describe('with the finalize dialog open', () => {
    it('scrolls the deletion list down and up with the arrows', () => {
      const state = overlay({ showFinalize: true });

      expect(handleReviewOverlayInput('', key({ downArrow: true }), state)).toBe(true);
      expect(handleReviewOverlayInput('', key({ upArrow: true }), state)).toBe(true);

      expect(state.finalizePreview.scrollBy.mock.calls).toEqual([[1], [-1]]);
    });

    it('leaves the dialog its own keys but still swallows them, so nothing underneath reacts', () => {
      const state = overlay({ showFinalize: true });

      expect(handleReviewOverlayInput('y', key(), state)).toBe(true);
      expect(handleReviewOverlayInput('z', key({ ctrl: true }), state)).toBe(true);

      expect(state.handleUndo).not.toHaveBeenCalled();
      expect(state.finalizePreview.scrollBy).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['another dialog is open', { dialogOpen: true }],
    ['help is showing', { showHelp: true }],
  ])('swallows keys, including undo, while %s', (_label, overrides) => {
    const state = overlay(overrides);

    expect(handleReviewOverlayInput('z', key({ ctrl: true }), state)).toBe(true);
    expect(state.handleUndo).not.toHaveBeenCalled();
  });

  describe('with the reload dialog open', () => {
    it('Enter reloads from the saved state and closes the dialog', () => {
      const state = overlay({ showReloadDialog: true });

      expect(handleReviewOverlayInput('', key({ return: true }), state)).toBe(true);

      expect(state.reloadFromSave).toHaveBeenCalledTimes(1);
      expect(state.setShowReloadDialog).toHaveBeenCalledWith(false);
    });

    it('Esc closes it without reloading', () => {
      const state = overlay({ showReloadDialog: true });

      expect(handleReviewOverlayInput('', key({ escape: true }), state)).toBe(true);

      expect(state.reloadFromSave).not.toHaveBeenCalled();
      expect(state.setShowReloadDialog).toHaveBeenCalledWith(false);
    });

    it('swallows other keys, including undo', () => {
      const state = overlay({ showReloadDialog: true });

      expect(handleReviewOverlayInput('z', key({ ctrl: true }), state)).toBe(true);
      expect(state.handleUndo).not.toHaveBeenCalled();
    });
  });

  describe('the shortcuts', () => {
    it('Ctrl+Z undoes', () => {
      const state = overlay();

      expect(handleReviewOverlayInput('z', key({ ctrl: true }), state)).toBe(true);
      expect(state.handleUndo).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Y redoes', () => {
      const state = overlay();

      expect(handleReviewOverlayInput('y', key({ ctrl: true }), state)).toBe(true);
      expect(state.handleRedo).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+R opens the reload dialog', () => {
      const state = overlay();

      expect(handleReviewOverlayInput('r', key({ ctrl: true }), state)).toBe(true);
      expect(state.setShowReloadDialog).toHaveBeenCalledWith(true);
    });

    it('does not undo on a plain z', () => {
      const state = overlay();

      expect(handleReviewOverlayInput('z', key(), state)).toBe(false);
      expect(state.handleUndo).not.toHaveBeenCalled();
    });

    it('leaves every other key to the screen', () => {
      expect(handleReviewOverlayInput('a', key(), overlay())).toBe(false);
    });
  });
});

describe('handleJsonPanelInput', () => {
  const json = (overrides: Record<string, unknown> = {}) => {
    const pendingGRef = { current: false };
    return {
      jsonScrollOffset: 5,
      setJsonScrollOffset: vi.fn(),
      pendingGRef,
      sidebarFocused: false,
      showJson: true,
      jsonValue: Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'),
      height: 10,
      ...overrides,
    };
  };
  /** The offset the handler asked for; the setter is given a function that ignores its argument. */
  const requested = (state: ReturnType<typeof json>): number[] =>
    state.setJsonScrollOffset.mock.calls.map(([update]) => (update as (previous: number) => number)(0));

  it('does nothing while the sidebar has focus, so the keys go to the sidebar', () => {
    const state = json({ sidebarFocused: true });

    expect(handleJsonPanelInput('', key({ downArrow: true }), state)).toBe(false);
    expect(state.setJsonScrollOffset).not.toHaveBeenCalled();
  });

  it('does nothing while the JSON view is closed', () => {
    const state = json({ showJson: false });

    expect(handleJsonPanelInput('', key({ downArrow: true }), state)).toBe(false);
    expect(state.setJsonScrollOffset).not.toHaveBeenCalled();
  });

  it('scrolls down a line with the down arrow', () => {
    const state = json();

    expect(handleJsonPanelInput('', key({ downArrow: true }), state)).toBe(true);
    expect(requested(state)).toEqual([6]);
  });

  it('stops at the last line', () => {
    const state = json({ jsonScrollOffset: 90 });

    handleJsonPanelInput('', key({ downArrow: true }), state);

    expect(requested(state)).toEqual([90]);
  });

  it('stops at the first line', () => {
    const state = json({ jsonScrollOffset: 0 });

    handleJsonPanelInput('', key({ upArrow: true }), state);

    expect(requested(state)).toEqual([0]);
  });

  it('jumps to the top on a double g, and only on the second one', () => {
    const state = json();

    expect(handleJsonPanelInput('g', key(), state)).toBe(true);
    expect(state.pendingGRef.current).toBe(true);
    expect(state.setJsonScrollOffset).not.toHaveBeenCalled();

    expect(handleJsonPanelInput('g', key(), state)).toBe(true);
    expect(state.pendingGRef.current).toBe(false);
    expect(requested(state)).toEqual([0]);
  });

  it('forgets a lone g when another key follows', () => {
    const state = json();
    handleJsonPanelInput('g', key(), state);

    handleJsonPanelInput('', key({ downArrow: true }), state);

    expect(state.pendingGRef.current).toBe(false);
  });

  it('swallows a key that is not a scroll key, and forgets a lone g', () => {
    const state = json();
    handleJsonPanelInput('g', key(), state);

    expect(handleJsonPanelInput('x', key(), state)).toBe(true);

    expect(state.pendingGRef.current).toBe(false);
    expect(state.setJsonScrollOffset).not.toHaveBeenCalled();
  });

  it('treats Ctrl+g as an ordinary key, not the start of gg', () => {
    const state = json();

    handleJsonPanelInput('g', key({ ctrl: true }), state);

    expect(state.pendingGRef.current).toBe(false);
  });
});
