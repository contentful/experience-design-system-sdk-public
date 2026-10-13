import React from 'react';
import { Text } from 'ink';
import { render as inkRender } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import type {
  ComponentRationale,
  ComponentReviewMetadata,
} from '@contentful/experience-design-system-backend-pipeline';
import {
  ReviewDetailsPanel,
  type ReviewDetailsPanelProps,
} from '../../../src/tui/import/steps/09-review/review-details-panel.js';
import {
  ReviewDetailsEditor,
  type ReviewDetailsEditorProps,
} from '../../../src/tui/import/steps/09-review/components/ReviewDetailsEditor.js';
import { FINALIZE_REMOVED_WINDOW } from '../../../src/tui/import/steps/09-review/components/FinalizeDialog.js';
import type { FieldEditorMetadata } from '../../../src/tui/import/steps/09-review/components/FieldEditor.js';
import type { RationaleRow } from '../../../src/tui/import/steps/09-review/components/RationalePanel.js';

// The v2 test config forces colour on, so strip it and read the frame as plain text.
const frame = (element: React.ReactElement): string =>
  (inkRender(element).lastFrame() ?? '').replace(/\u001b\[[0-9;]*m/g, '');

const rationale: ComponentRationale = {
  name: 'ButtonFromRationale',
  description: 'A button',
  descriptionRationale: 'Taken from the docblock',
  propsRationale: null,
  slotsRationale: null,
  props: [{ name: 'variant', rationale: 'Looks like an enum' }],
  slots: [{ name: 'icon', rationale: 'Renders children' }],
} as ComponentRationale;

const metadata: ComponentReviewMetadata = {
  name: 'Button',
  sourcePath: 'src/Button.tsx',
  componentSource: 'line one\nline two\nline three',
  props: [],
} as unknown as ComponentReviewMetadata;

const base = (overrides: Partial<ReviewDetailsPanelProps> = {}): ReviewDetailsPanelProps => ({
  selectedKey: 'Button',
  panelOpen: 'none',
  componentRationale: rationale,
  reviewMetadata: metadata,
  panelScrollOffset: 0,
  width: 60,
  height: 14,
  tokenSuggestions: [],
  tokenReviewRow: 0,
  tokenReviewEditing: false,
  tokenReviewEditCursor: 0,
  tokenReviewEditSelection: new Set(),
  showJson: false,
  jsonValue: '{ "Button": {} }',
  jsonScrollOffset: 0,
  sidebarFocused: false,
  editor: <Text>THE EDITOR</Text>,
  ...overrides,
});

describe('ReviewDetailsPanel decides which view fills the slot', () => {
  it('shows the editor when nothing else is open', () => {
    expect(frame(<ReviewDetailsPanel {...base()} />)).toContain('THE EDITOR');
  });

  it('shows the prop and slot rationale, named for the component', () => {
    const out = frame(<ReviewDetailsPanel {...base({ panelOpen: 'prop-rationale' })} />);

    expect(out).toContain('RATIONALE — ButtonFromRationale');
    expect(out).toContain('variant');
    expect(out).toContain('Looks like an enum');
    expect(out).toContain('icon');
    expect(out).not.toContain('THE EDITOR');
  });

  it('names the rationale after the selected key when there is no rationale', () => {
    const out = frame(
      <ReviewDetailsPanel {...base({ panelOpen: 'prop-rationale', componentRationale: null, selectedKey: 'Card' })} />,
    );

    expect(out).toContain('Card');
  });

  it('shows the component rationale', () => {
    const out = frame(<ReviewDetailsPanel {...base({ panelOpen: 'component-rationale' })} />);

    expect(out).toContain('Taken from the docblock');
    expect(out).not.toContain('THE EDITOR');
  });

  it('shows an empty component rationale, named for the selected key, when there is none', () => {
    const out = frame(
      <ReviewDetailsPanel
        {...base({ panelOpen: 'component-rationale', componentRationale: null, selectedKey: 'Card' })}
      />,
    );

    expect(out).toContain('Card');
  });

  describe('the source view', () => {
    it('shows the path and the source from the scroll offset', () => {
      const out = frame(<ReviewDetailsPanel {...base({ panelOpen: 'source', panelScrollOffset: 1 })} />);

      expect(out).toContain('source: src/Button.tsx');
      expect(out).toContain('line two');
      expect(out).not.toContain('line one');
      expect(out).toContain('[s/Esc] close');
    });

    it('says so when no source was captured', () => {
      const out = frame(<ReviewDetailsPanel {...base({ panelOpen: 'source', reviewMetadata: null })} />);

      expect(out).toContain('<unknown source path>');
      expect(out).toContain('(no source captured)');
    });
  });

  it('shows the token review with the suggestions it was given', () => {
    const out = frame(
      <ReviewDetailsPanel
        {...base({
          panelOpen: 'token-review',
          tokenSuggestions: [{ propName: 'bg', paths: ['color.a'], suggested: ['color.a'], allowed: ['color.a'] }],
        })}
      />,
    );

    expect(out).toContain('bg');
    expect(out).not.toContain('THE EDITOR');
  });

  it('shows the read-only JSON when it is turned on', () => {
    const out = frame(<ReviewDetailsPanel {...base({ showJson: true })} />);

    expect(out).toContain('GENERATED DEFINITION (read-only)');
    expect(out).not.toContain('THE EDITOR');
  });

  describe('the JSON view takes focus from the sidebar', () => {
    const rawFrame = (element: React.ReactElement): string => inkRender(element).lastFrame() ?? '';
    const WHITE_BORDER = '\u001b[37m';

    it('draws the active border when the sidebar does not have focus', () => {
      expect(rawFrame(<ReviewDetailsPanel {...base({ showJson: true, sidebarFocused: false })} />)).toContain(
        WHITE_BORDER,
      );
    });

    it('draws no active border while the sidebar has focus', () => {
      expect(rawFrame(<ReviewDetailsPanel {...base({ showJson: true, sidebarFocused: true })} />)).not.toContain(
        WHITE_BORDER,
      );
    });
  });

  it('shows an open panel instead of the JSON when both are on', () => {
    const out = frame(<ReviewDetailsPanel {...base({ showJson: true, panelOpen: 'component-rationale' })} />);

    expect(out).toContain('Taken from the docblock');
    expect(out).not.toContain('GENERATED DEFINITION');
  });
});

describe('ReviewDetailsEditor', () => {
  const componentJson = JSON.stringify({
    Button: {
      $type: 'component',
      $properties: { variant: { $type: 'string', $category: 'content', $description: 'Visual style' } },
    },
  });
  const withRationale = {
    ...metadata,
    props: { variant: { rationale: 'Chosen because it looks like an enum' } },
  } as unknown as ComponentReviewMetadata;

  const editorProps = (overrides: Partial<ReviewDetailsEditorProps> = {}): ReviewDetailsEditorProps => ({
    selectedKey: 'Button',
    componentRationale: rationale,
    reviewMetadata: withRationale,
    width: 70,
    height: 20,
    jsonValue: '{}',
    sidebarFocused: false,
    reviewEditor: {
      panelOpen: 'none',
      panelScrollOffset: 0,
      tokenReviewRow: 0,
      tokenReviewEditing: false,
      tokenReviewEditCursor: 0,
      tokenReviewEditSelection: new Set<string>(),
      showJson: false,
      jsonScrollOffset: 0,
      currentTokenSuggestions: () => [],
    },
    fieldEditor: {
      value: componentJson,
      onChange: () => undefined,
      onSave: () => undefined,
      onDiscard: () => undefined,
    },
    ...overrides,
  });
  const reviewEditor = (
    overrides: Partial<ReviewDetailsEditorProps['reviewEditor']>,
  ): ReviewDetailsEditorProps['reviewEditor'] => ({
    ...editorProps().reviewEditor,
    ...overrides,
  });

  it('shows the field editor with its rows when no panel is open', () => {
    const out = frame(<ReviewDetailsEditor {...editorProps()} />);

    expect(out).toContain('variant');
    expect(out).not.toContain('RATIONALE');
  });

  it('hands the open panel to the panel view instead of the editor', () => {
    const out = frame(
      <ReviewDetailsEditor {...editorProps({ reviewEditor: reviewEditor({ panelOpen: 'component-rationale' }) })} />,
    );

    expect(out).toContain('Taken from the docblock');
    expect(out).not.toContain('Visual style');
  });

  it('hands the token suggestions the review editor offers to the token review', () => {
    const out = frame(
      <ReviewDetailsEditor
        {...editorProps({
          reviewEditor: reviewEditor({
            panelOpen: 'token-review',
            currentTokenSuggestions: () => [
              { propName: 'backgroundColor', paths: ['color.a'], suggested: ['color.a'], allowed: ['color.a'] },
            ],
          }),
        })}
      />,
    );

    expect(out).toContain('backgroundColor');
  });

  it('hands the JSON view its text and offset', () => {
    const out = frame(
      <ReviewDetailsEditor
        {...editorProps({
          jsonValue: 'alpha\nbeta\ngamma',
          reviewEditor: reviewEditor({ showJson: true, jsonScrollOffset: 1 }),
        })}
      />,
    );

    expect(out).toContain('beta');
    expect(out).not.toContain('alpha');
  });

  describe('the field editor', () => {
    // Active or not shows only in colour: a blue border and a highlighted selected row, or a grey border and none.
    const raw = (element: React.ReactElement): string => inkRender(element).lastFrame() ?? '';
    const ACTIVE_BORDER = '\u001b[38;2;23;115;235m┌';
    const INACTIVE_BORDER = '\u001b[38;2;196;209;222m┌';
    const SELECTED_ROW = '\u001b[44m';

    it('is active when the sidebar does not have focus: a blue border and a highlighted row', () => {
      const out = raw(<ReviewDetailsEditor {...editorProps({ sidebarFocused: false })} />);

      expect(out).toContain(ACTIVE_BORDER);
      expect(out).toContain(SELECTED_ROW);
    });

    it('is not active while the sidebar has focus: a grey border and no highlighted row', () => {
      const out = raw(<ReviewDetailsEditor {...editorProps({ sidebarFocused: true })} />);

      expect(out).toContain(INACTIVE_BORDER);
      expect(out).not.toContain(SELECTED_ROW);
    });

    it('does not show the inline rationales the metadata carries, since the panel has its own view of them', () => {
      expect(frame(<ReviewDetailsEditor {...editorProps()} />)).not.toContain('Chosen because it looks like an enum');
    });

    it('is given the review metadata, which the source view reads when `s` is pressed', async () => {
      const withSource = {
        sourcePath: 'src/Button.tsx',
        componentSource: 'const a = 1;\nconst variant = 2;\nconst c = 3;',
        props: { variant: { sourceStartLine: 2, sourceEndLine: 2 } },
      } as unknown as ComponentReviewMetadata;
      const instance = inkRender(<ReviewDetailsEditor {...editorProps({ reviewMetadata: withSource })} />);

      instance.stdin.write('s');
      await new Promise((resolve) => setTimeout(resolve, 30));
      const out = (instance.lastFrame() ?? '').replace(/\u001b\[[0-9;]*m/g, '');

      expect(out).toContain('src/Button.tsx: lines 2–2');
      expect(out).toContain('const variant = 2;');
    });

    it('has no source location to show without review metadata', async () => {
      const instance = inkRender(<ReviewDetailsEditor {...editorProps({ reviewMetadata: null })} />);

      instance.stdin.write('s');
      await new Promise((resolve) => setTimeout(resolve, 30));
      const out = (instance.lastFrame() ?? '').replace(/\u001b\[[0-9;]*m/g, '');

      expect(out).toContain('source: <unknown source path>');
      expect(out).toContain('(no source location captured for this prop)');
    });
  });
});

describe('types the screen will use', () => {
  it('describes the finalize window, the editor metadata and a rationale row', () => {
    const row: RationaleRow = { name: 'variant', kind: 'prop', rationale: 'why' };
    const fieldMetadata: FieldEditorMetadata = { sourcePath: 'src/B.tsx', componentSource: null, props: [] } as never;

    expect(FINALIZE_REMOVED_WINDOW).toBe(6);
    expect(row.kind).toBe('prop');
    expect(fieldMetadata).toBeDefined();
  });
});
