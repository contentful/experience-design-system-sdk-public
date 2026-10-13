import React from 'react';
import { render as inkRender } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  ReviewComponentPanel,
  ReviewEmptyComponentsWarning,
  ReviewFinalizeError,
  ReviewNoSelection,
  buildReviewFieldEditor,
  getReviewSelectionState,
} from '../../../src/tui/import/steps/09-review/components/ReviewComponentPanel.js';
import {
  ReviewLoadError,
  ReviewLoadingState,
} from '../../../src/tui/import/steps/09-review/components/ReviewStatus.js';
import { ReviewStepDialogs } from '../../../src/tui/import/steps/09-review/components/ReviewDialogs.js';
import type { UseReviewEditorResult } from '../../../src/tui/import/steps/09-review/use-review-editor.js';
import type { UseReviewSurfaceStateResult } from '../../../src/tui/import/steps/09-review/use-review-surface-state.js';
import type { UseFinalizePreviewReturn } from '../../../src/tui/import/steps/09-review/use-finalize-preview.js';
import type { CdfReviewEntry } from '../../../src/tui/import/steps/09-review/types.js';

const frame = (element: React.ReactElement): string =>
  (inkRender(element).lastFrame() ?? '').replace(/\u001b\[[0-9;]*m/g, '');

const entry = (extra: Partial<CDFComponentEntry> = {}): CDFComponentEntry => ({
  $type: 'component',
  $properties: {
    label: { $type: 'string', $category: 'content' },
    flag: { $type: 'boolean', $category: 'state' },
  },
  ...extra,
});
const review = (key: string, e: CDFComponentEntry = entry()): CdfReviewEntry => ({
  key,
  entry: e,
  status: 'needs-review',
});

describe('getReviewSelectionState', () => {
  it('selects the component at the index and shows it as JSON keyed by its name', () => {
    const state = getReviewSelectionState([review('A'), review('B')], 1, true);

    expect(state.selected?.key).toBe('B');
    expect(JSON.parse(state.selectedJson)).toEqual({ B: entry() });
  });

  it('has nothing selected, and empty JSON, past the end of the list', () => {
    expect(getReviewSelectionState([review('A')], 5, true)).toEqual({
      selected: null,
      selectedJson: '',
      visibleJsonPanelValue: '',
    });
  });

  it('has nothing selected for an empty list', () => {
    expect(getReviewSelectionState([], 0, false).selected).toBeNull();
  });

  it('hides state props from the read-only JSON view unless asked to show them, but not from the editable JSON', () => {
    const hidden = getReviewSelectionState([review('A')], 0, false);
    const shown = getReviewSelectionState([review('A')], 0, true);

    expect(hidden.visibleJsonPanelValue).not.toContain('flag');
    expect(shown.visibleJsonPanelValue).toContain('flag');
    expect(hidden.selectedJson).toContain('flag');
  });
});

describe('buildReviewFieldEditor', () => {
  const editor = (overrides: Partial<UseReviewEditorResult> = {}) =>
    ({
      draftValue: '',
      showHiddenProps: false,
      setDraftValue: vi.fn(),
      handleEditSave: vi.fn(),
      handleEditDiscard: vi.fn(),
      setPanelOpen: vi.fn(),
      setPanelScrollOffset: vi.fn(),
      setTextEntryActive: vi.fn(),
      ...overrides,
    }) as unknown as UseReviewEditorResult;

  it("edits the selected component's JSON, until the person has typed a draft", () => {
    expect(buildReviewFieldEditor(editor(), '{"A":{}}', vi.fn()).value).toBe('{"A":{}}');
    expect(buildReviewFieldEditor(editor({ draftValue: '{"draft":1}' }), '{"A":{}}', vi.fn()).value).toBe(
      '{"draft":1}',
    );
  });

  it('wires change, save, discard, exit and the hidden-props switch to the review editor', () => {
    const reviewEditor = editor({ showHiddenProps: true });
    const onExit = vi.fn();
    const built = buildReviewFieldEditor(reviewEditor, '{}', onExit);

    expect(built.showHiddenProps).toBe(true);
    expect(built.onChange).toBe(reviewEditor.setDraftValue);
    expect(built.onSave).toBe(reviewEditor.handleEditSave);
    expect(built.onDiscard).toBe(reviewEditor.handleEditDiscard);
    expect(built.onExit).toBe(onExit);
    expect(built.onTextEntryActiveChange).toBe(reviewEditor.setTextEntryActive);
  });

  it.each([
    ['onTogglePropRationale', 'prop-rationale'],
    ['onToggleComponentRationale', 'component-rationale'],
    ['onToggleSourceExternal', 'source'],
  ] as const)('%s opens the %s panel at the top', (callback, panel) => {
    const reviewEditor = editor();

    buildReviewFieldEditor(reviewEditor, '{}', vi.fn())[callback]!();

    expect(reviewEditor.setPanelOpen).toHaveBeenCalledWith(panel);
    const resetOffset = (reviewEditor.setPanelScrollOffset as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as () => number;
    expect(resetOffset()).toBe(0);
  });

  it('starts on the component description', () => {
    expect(buildReviewFieldEditor(editor(), '{}', vi.fn()).initialFocusTarget).toEqual({ kind: 'description' });
  });

  it('lets the caller override anything', () => {
    const onExit = vi.fn();

    expect(buildReviewFieldEditor(editor(), '{}', vi.fn(), { onExit, initialFocusTarget: undefined })).toMatchObject({
      onExit,
      initialFocusTarget: undefined,
    });
  });
});

describe('the small review notices', () => {
  describe('ReviewEmptyComponentsWarning', () => {
    it('warns about one component in the singular', () => {
      expect(frame(<ReviewEmptyComponentsWarning count={1} hidden={false} />)).toBe(
        '⚠ 1 component had no classifiable props — review with care',
      );
    });

    it('warns about several in the plural', () => {
      expect(frame(<ReviewEmptyComponentsWarning count={3} hidden={false} />)).toContain('3 components had no');
    });

    it('says nothing when there are none, or when hidden', () => {
      expect(frame(<ReviewEmptyComponentsWarning count={0} hidden={false} />)).toBe('');
      expect(frame(<ReviewEmptyComponentsWarning count={3} hidden />)).toBe('');
    });
  });

  it('ReviewNoSelection says nothing is selected', () => {
    expect(frame(<ReviewNoSelection />)).toContain('No component selected');
  });

  describe('ReviewFinalizeError', () => {
    it('shows the message', () => {
      expect(frame(<ReviewFinalizeError message="Nothing to push" hidden={false} />)).toBe('⚠ Nothing to push');
    });

    it('shows nothing without a message, or when hidden', () => {
      expect(frame(<ReviewFinalizeError message={null} hidden={false} />)).toBe('');
      expect(frame(<ReviewFinalizeError message="" hidden={false} />)).toBe('');
      expect(frame(<ReviewFinalizeError message="Nothing to push" hidden />)).toBe('');
    });
  });

  it('ReviewLoadingState says the definitions are loading', () => {
    expect(frame(<ReviewLoadingState />)).toContain('Loading generated definitions...');
  });

  it('ReviewLoadError shows the message and how to leave', () => {
    const out = frame(<ReviewLoadError message="No generated definitions found" />);

    expect(out).toContain('No generated definitions found');
    expect(out).toContain('[q / Enter / Esc] Quit');
  });
});

describe('ReviewStepDialogs', () => {
  const surface = (overrides: Partial<UseReviewSurfaceStateResult> = {}) =>
    ({
      sidebarFocused: true,
      showFinalize: false,
      setShowFinalize: vi.fn(),
      showQuit: false,
      setShowQuit: vi.fn(),
      finalizeError: null,
      setFinalizeError: vi.fn(),
      ...overrides,
    }) as UseReviewSurfaceStateResult;
  const preview: UseFinalizePreviewReturn = {
    status: 'done',
    removed: [{ name: 'GoneComponent' } as never],
    scrollOffset: 0,
    scrollBy: vi.fn(),
  };
  const components = [
    { status: 'accepted' as const },
    { status: 'rejected' as const },
    { status: 'needs-review' as const },
  ];

  it('shows the finalize dialog with the counts and what the preview says would be removed', () => {
    const out = frame(
      <ReviewStepDialogs
        surfaceState={surface({ showFinalize: true })}
        components={components}
        finalizePreview={preview}
        onFinalize={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    expect(out).toContain('Finalize');
    expect(out).toContain('GoneComponent');
  });

  it('shows the quit dialog', () => {
    const out = frame(
      <ReviewStepDialogs
        surfaceState={surface({ showQuit: true })}
        components={components}
        finalizePreview={preview}
        onFinalize={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    expect(out).toContain('Quit');
    expect(out).not.toContain('Finalize');
  });

  it('shows no dialog when neither is open', () => {
    expect(
      frame(
        <ReviewStepDialogs
          surfaceState={surface()}
          components={components}
          finalizePreview={preview}
          onFinalize={vi.fn()}
          onQuit={vi.fn()}
        />,
      ),
    ).toBe('');
  });

  it('closes the finalize dialog on cancel, and closes the quit dialog on cancel', async () => {
    const state = surface({ showFinalize: true });
    const finalizeView = inkRender(
      <ReviewStepDialogs
        surfaceState={state}
        components={components}
        finalizePreview={preview}
        onFinalize={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    finalizeView.stdin.write('\u001b');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(state.setShowFinalize).toHaveBeenCalledWith(false);

    const quitState = surface({ showQuit: true });
    const quitView = inkRender(
      <ReviewStepDialogs
        surfaceState={quitState}
        components={components}
        finalizePreview={preview}
        onFinalize={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    quitView.stdin.write('\u001b');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(quitState.setShowQuit).toHaveBeenCalledWith(false);
  });
});

describe('ReviewComponentPanel footer and live-preview indicators', () => {
  // The real editor draws `header` (the title with the counts) inside its box, so the stand-in has to as well.
  vi.mock('../../../src/tui/import/steps/09-review/components/ReviewDetailsEditor.js', () => ({
    ReviewDetailsEditor: ({ header }: { header?: React.ReactNode }) => <>{header}</>,
  }));

  const reviewEditor = (overrides: Record<string, unknown> = {}) => ({
    panelOpen: 'none' as const,
    panelScrollOffset: 0,
    tokenReviewRow: 0,
    tokenReviewEditing: false,
    tokenReviewEditCursor: 0,
    tokenReviewEditSelection: new Set<string>(),
    showJson: false,
    jsonScrollOffset: 0,
    currentTokenSuggestions: () => [],
    ...overrides,
  });
  const panel = (overrides: Record<string, unknown> = {}) =>
    frame(
      <ReviewComponentPanel
        selectedKey="Button"
        selectedEntry={entry()}
        componentRationale={null}
        reviewMetadata={null}
        reviewEditor={reviewEditor()}
        width={120}
        height={12}
        jsonValue="{}"
        sidebarFocused={false}
        fieldEditor={{ value: '{}', onChange: () => {}, onSave: () => {}, onDiscard: () => {} }}
        saveError={null}
        sidebarFooter="[F] finalize"
        livePreview={{ status: 'idle', disabled: false }}
        livePreviewSpinner="⠋"
        {...overrides}
      />,
    );

  it('shows the token review keys while the token review is open, whoever has focus', () => {
    expect(panel({ reviewEditor: reviewEditor({ panelOpen: 'token-review' }), sidebarFocused: true })).toContain(
      '[↑/↓] move  [Enter] edit allowed  [Esc] close',
    );
  });

  it("shows the caller's footer while the sidebar has focus", () => {
    expect(panel({ sidebarFocused: true })).toContain('[F] finalize');
  });

  it('shows the scroll keys for the JSON view', () => {
    expect(panel({ reviewEditor: reviewEditor({ showJson: true }) })).toContain('[gg/G] top/bottom');
  });

  it('shows the editing hint otherwise, with the token review key only when there is something to review', () => {
    expect(panel()).toContain('[Tab] focus list  (edit fields)');
    expect(panel()).not.toContain('[t] token review');
    expect(
      panel({
        reviewEditor: reviewEditor({
          currentTokenSuggestions: () => [{ propName: 'bg', paths: [], suggested: [], allowed: [] }],
        }),
      }),
    ).toContain('[t] token review');
  });

  it('shows the live preview spinner while it runs, and that it is disabled when it is', () => {
    expect(panel({ livePreview: { status: 'running', disabled: false }, livePreviewSpinner: '⠙' })).toContain(
      '⠙ live preview',
    );
    expect(panel({ livePreview: { status: 'idle', disabled: true } })).toContain('live preview disabled');
    expect(panel()).not.toContain('live preview');
  });

  it('shows the save error, or leaves the row blank', () => {
    expect(panel({ saveError: 'Invalid CDF' })).toContain('✗ Invalid CDF');
    expect(panel()).not.toContain('✗');
  });

  it('counts props and slots in the title, singular and plural', () => {
    const props = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { $type: 'string', $category: 'content' }]));
    const slots = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i}`, { $allowedComponents: [] }]));
    const title = (p: number, sl: number) =>
      panel({ selectedEntry: { $type: 'component', $properties: props(p), ...(sl ? { $slots: slots(sl) } : {}) } });

    expect(title(1, 0)).toContain('1 prop ');
    expect(title(1, 0)).not.toContain('1 props');
    expect(title(3, 0)).toContain('3 props');
    expect(title(3, 0)).not.toContain('slot');
    expect(title(2, 1)).toContain('2 props · 1 slot');
    expect(title(2, 2)).toContain('2 props · 2 slots');
  });

  it('shows the component name, and which side the focus switch goes to', () => {
    expect(panel({ sidebarFocused: true })).toContain('Button');
    expect(panel({ sidebarFocused: true })).toContain('[Tab] focus panel');
    expect(panel({ sidebarFocused: false })).toContain('[Tab] focus list');
  });
});
