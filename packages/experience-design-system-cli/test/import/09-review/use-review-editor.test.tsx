import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React, { useState } from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  getOrCreateSession,
  loadCDFComponents,
  openPipelineDb,
  storeCDFComponents,
  storeDTCGTokens,
  storeRawComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import {
  useReviewEditor,
  type UseReviewEditorResult,
} from '../../../src/tui/import/steps/09-review/use-review-editor.js';
import type { CdfReviewEntry } from '../../../src/tui/import/steps/09-review/types.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const withToken: CDFComponentEntry = {
  $type: 'component',
  $properties: {
    bg: { $type: 'token', $category: 'design', '$token.kind': 'color', '$token.allowed': ['color.a'] },
  },
};
const tokens = [
  { path: 'color.a', kind: 'color' },
  { path: 'color.b', kind: 'color' },
];

describe('useReviewEditor', () => {
  let dir: string;
  let previousDbPath: string | undefined;
  let sessionId: string;

  const storedEntry = (key: string): CDFComponentEntry | undefined => {
    const db = openPipelineDb();
    try {
      return loadCDFComponents(db, sessionId).find((c) => c.key === key)?.entry;
    } finally {
      db.close();
    }
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'review-editor-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
    const db = openPipelineDb();
    sessionId = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
    storeRawComponents(db, sessionId, [
      {
        name: 'Button',
        source: 'src/B.tsx',
        framework: 'react',
        props: [{ name: 'bg', type: 'string', required: false }],
        slots: [],
      },
    ]);
    storeDTCGTokens(
      db,
      sessionId,
      [],
      [
        { path: 'color.a', $type: 'color', $value: '#000' },
        { path: 'color.b', $type: 'color', $value: '#fff' },
      ],
    );
    storeCDFComponents(db, sessionId, [{ key: 'Button', entry: withToken }]);
    db.close();
  });
  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  /** Mounts the editor over real component state, so a save shows up in `components` as it would on screen. */
  const mount = async (initial: CdfReviewEntry[]) => {
    const calls = { pushed: [] as string[], edited: vi.fn(), tokenSaved: vi.fn() };
    const ref: { editor: UseReviewEditorResult | null; components: CdfReviewEntry[] } = {
      editor: null,
      components: initial,
    };
    function Probe(): React.ReactElement {
      const [components, setComponents] = useState(initial);
      ref.components = components;
      ref.editor = useReviewEditor({
        components,
        selectedIdx: 0,
        extractSessionId: sessionId,
        availableTokens: tokens,
        setComponents,
        pushHistorySnapshot: (_entries, label) => calls.pushed.push(label),
        onEditSaved: calls.edited,
        onTokenSaved: calls.tokenSaved,
      });
      return React.createElement(Text, null, '');
    }
    render(React.createElement(Probe));
    // The hook clears its token review state in an effect on mount; let that run before the test interacts with it.
    await settle();
    return { ref, calls, editor: () => ref.editor!, components: () => ref.components };
  };
  const button = (status: CdfReviewEntry['status'] = 'needs-review'): CdfReviewEntry => ({
    key: 'Button',
    entry: withToken,
    status,
  });
  const editedProps = { label: { $type: 'string', $category: 'content' } };
  const edited = JSON.stringify({ $type: 'component', $properties: editedProps });
  const editedBg = JSON.stringify({
    $type: 'component',
    $properties: { bg: { ...withToken.$properties.bg, '$token.allowed': ['color.b'] } },
  });

  describe('saving an edit', () => {
    it('stores the edited definition, accepts a component that was waiting for review, and says so', async () => {
      const m = await mount([button()]);
      m.editor().setDraftValue(editedBg);
      await settle();

      m.editor().handleEditSave();
      await settle();

      expect(m.components()[0].entry.$properties.bg['$token.allowed']).toEqual(['color.b']);
      expect(m.components()[0].status).toBe('accepted');
      expect(storedEntry('Button')!.$properties.bg['$token.allowed']).toEqual(['color.b']);
      expect(m.calls.edited).toHaveBeenCalledTimes(1);
      expect(m.editor().draftValue).toBe('');
      expect(m.editor().saveError).toBeNull();
    });

    it('keeps the status of a component that was already decided', async () => {
      const m = await mount([button('rejected')]);
      m.editor().setDraftValue(edited);
      await settle();

      m.editor().handleEditSave();
      await settle();

      expect(m.components()[0].status).toBe('rejected');
    });

    it('accepts the definition wrapped in its key, as the JSON view shows it', async () => {
      const m = await mount([button()]);
      m.editor().setDraftValue(JSON.stringify({ Button: JSON.parse(edited) }));
      await settle();

      m.editor().handleEditSave();
      await settle();

      expect(Object.keys(m.components()[0].entry.$properties)).toEqual(['label']);
    });

    it('does nothing for an empty draft', async () => {
      const m = await mount([button()]);
      m.editor().setDraftValue('   ');
      await settle();

      m.editor().handleEditSave();
      await settle();

      expect(m.calls.edited).not.toHaveBeenCalled();
      expect(m.components()[0].entry).toBe(withToken);
      expect(m.editor().saveError).toBeNull();
    });

    it('shows an error and changes nothing for a draft that is not JSON', async () => {
      const m = await mount([button()]);
      m.editor().setDraftValue('{ nope');
      await settle();

      m.editor().handleEditSave();
      await settle();

      expect(m.editor().saveError).toContain('JSON');
      expect(m.calls.edited).not.toHaveBeenCalled();
      expect(storedEntry('Button')).toEqual(withToken);
    });

    it('shows an error for something that is not a component definition', async () => {
      const m = await mount([button()]);
      m.editor().setDraftValue(JSON.stringify({ $type: 'token', $properties: {} }));
      await settle();

      m.editor().handleEditSave();
      await settle();

      expect(m.editor().saveError).toContain('Invalid CDF entry');
      expect(m.calls.edited).not.toHaveBeenCalled();
    });

    it('discarding clears the draft and the error', async () => {
      const m = await mount([button()]);
      m.editor().setDraftValue('{ nope');
      await settle();
      m.editor().handleEditSave();
      await settle();

      m.editor().handleEditDiscard();
      await settle();

      expect(m.editor().draftValue).toBe('');
      expect(m.editor().saveError).toBeNull();
    });
  });

  describe('token suggestions', () => {
    it('offers every token of the right kind, with the saved ones as the current choice', async () => {
      const m = await mount([button()]);

      expect(m.editor().currentTokenSuggestions()).toEqual([
        { propName: 'bg', paths: ['color.a', 'color.b'], suggested: ['color.a'], allowed: ['color.a'] },
      ]);
    });

    it('saves the chosen tokens as the allowed ones, records the step for undo, and says so', async () => {
      const m = await mount([button()]);
      const [suggestion] = m.editor().currentTokenSuggestions();
      m.editor().setTokenReviewEditSelection(new Set(['color.b']));
      await settle();

      m.editor().handleTokenEditSave(suggestion);
      await settle();

      expect(m.components()[0].entry.$properties.bg['$token.allowed']).toEqual(['color.b']);
      expect(storedEntry('Button')!.$properties.bg['$token.allowed']).toEqual(['color.b']);
      expect(m.calls.pushed).toEqual(['token-review:bg']);
      expect(m.calls.tokenSaved).toHaveBeenCalledTimes(1);
      expect(m.editor().tokenReviewEditing).toBe(false);
    });

    it('does not save when nothing is selected', async () => {
      const m = await mount([button()]);
      const [suggestion] = m.editor().currentTokenSuggestions();
      m.editor().setTokenReviewEditSelection(new Set());
      await settle();

      m.editor().handleTokenEditSave(suggestion);
      await settle();

      expect(m.calls.tokenSaved).not.toHaveBeenCalled();
      expect(storedEntry('Button')!.$properties.bg['$token.allowed']).toEqual(['color.a']);
    });

    it('keeps the first suggestion it showed for a prop, even after the choice is saved', async () => {
      const m = await mount([button()]);
      const [first] = m.editor().currentTokenSuggestions();
      m.editor().setTokenReviewEditSelection(new Set(['color.b']));
      await settle();
      m.editor().handleTokenEditSave(first);
      await settle();

      const [after] = m.editor().currentTokenSuggestions();

      expect(after.suggested).toEqual(['color.a']);
      expect(after.allowed).toEqual(['color.b']);
    });
  });

  it('starts with every panel closed', async () => {
    const m = await mount([button()]);

    expect(m.editor()).toMatchObject({
      panelOpen: 'none',
      showJson: false,
      showHiddenProps: false,
      textEntryActive: false,
      tokenReviewRow: 0,
      tokenReviewEditing: false,
    });
  });
});
