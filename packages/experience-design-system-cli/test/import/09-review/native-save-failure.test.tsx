import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import {
  useReviewEditor,
  type UseReviewEditorResult,
} from '../../../src/tui/import/steps/09-review/use-review-editor.js';
const store = vi.hoisted(() =>
  vi.fn<() => void>(() => {
    throw new Error('Write failed');
  }),
);
const close = vi.hoisted(() => vi.fn());
vi.mock('@contentful/experience-design-system-backend-pipeline', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openPipelineDb: () => ({ close }),
  storeCDFComponents: store,
  loadCDFComponents: () => [],
}));
afterEach(() => {
  store.mockReset();
  store.mockImplementation(() => {
    throw new Error('Write failed');
  });
  close.mockReset();
});
it('keeps draft and local saved state unchanged when persistence fails', async () => {
  let hook: UseReviewEditorResult;
  const setComponents = vi.fn();
  const onEditSaved = vi.fn();
  const draft = JSON.stringify({
    $type: 'component',
    $properties: { label: { $type: 'string', $category: 'content', $default: '' } },
  });
  function Probe() {
    hook = useReviewEditor({
      components: [{ key: 'Example', entry: { $type: 'component', $properties: {} }, status: 'needs-review' }],
      selectedIdx: 0,
      extractSessionId: 'example',
      availableTokens: [],
      setComponents,
      pushHistorySnapshot: vi.fn(),
      onEditSaved,
      onTokenSaved: vi.fn(),
    });
    return <Text>{hook.saveError ?? 'ready'}</Text>;
  }
  const ui = render(<Probe />);
  try {
    hook!.setDraftValue(draft);
    await new Promise((resolve) => setTimeout(resolve, 30));
    hook!.handleEditSave();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store).toHaveBeenCalled();
    expect(setComponents).not.toHaveBeenCalled();
    expect(onEditSaved).not.toHaveBeenCalled();
    expect(hook!.draftValue).toBe(draft);
    expect(hook!.saveError).toContain('Write failed');
  } finally {
    ui.unmount();
  }
});

it.each(['success', 'close-warning', 'callback-warning'])(
  'acknowledges actual committed editor saves before reporting cleanup warnings: %s',
  async (mode) => {
    store.mockImplementation(() => undefined);
    if (mode === 'close-warning')
      close.mockImplementation(() => {
        throw new Error('Close warning');
      });
    let hook: UseReviewEditorResult;
    const publish = vi.fn();
    const callback = vi.fn(() => {
      if (mode === 'callback-warning') throw new Error('Callback warning');
    });
    const entry = {
      $type: 'component' as const,
      $properties: { count: { $type: 'number' as const, $category: 'content' as const, $default: 0 } },
    };
    function Probe() {
      hook = useReviewEditor({
        components: [{ key: 'Example', componentId: 'component', entry, status: 'needs-review' }],
        selectedIdx: 0,
        extractSessionId: 'example',
        availableTokens: [],
        setComponents: publish,
        pushHistorySnapshot: vi.fn(),
        onEditSaved: callback,
        onTokenSaved: vi.fn(),
      });
      return <Text>{hook.saveError ?? 'ready'}</Text>;
    }
    const ui = render(<Probe />);
    try {
      hook!.setDraftValue(JSON.stringify({ ...entry, $description: 'Edited' }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(hook!.handleEditSave()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(publish).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledOnce();
      expect(hook!.draftValue).toBe('');
      if (mode !== 'success') expect(hook!.saveError).toContain('Saved; warning:');
      else expect(hook!.saveError).toBeNull();
    } finally {
      ui.unmount();
    }
  },
);

it.each(['blank', 'duplicate-owner', 'property-conflict'])(
  'rejects invalid complete CDF in the mounted editor before persistence: %s',
  async (mode) => {
    let hook: UseReviewEditorResult;
    const setComponents = vi.fn(),
      onEditSaved = vi.fn();
    const sourceInput = {
      schemaVersion: 1,
      componentId: 'surface',
      componentDeclarationId: 'declaration',
      rootSymbolId: 'parameter',
      inputName: 'supplied',
      inputPath: ['supplied'],
    };
    const entry = {
      $type: 'component',
      $properties: mode === 'property-conflict' ? { supplied: { $type: 'string', $category: 'content' } } : {},
      $slots:
        mode === 'blank'
          ? { ' ': {} }
          : mode === 'duplicate-owner'
            ? { region: { $sourceInput: sourceInput }, other: { $sourceInput: sourceInput } }
            : { region: { $sourceInput: sourceInput } },
    };
    const draft = JSON.stringify(entry);
    function Probe() {
      hook = useReviewEditor({
        components: [{ key: 'Example', entry: { $type: 'component', $properties: {} }, status: 'needs-review' }],
        selectedIdx: 0,
        extractSessionId: 'example',
        availableTokens: [],
        setComponents,
        pushHistorySnapshot: vi.fn(),
        onEditSaved,
        onTokenSaved: vi.fn(),
      });
      return <Text>{hook.saveError ?? 'ready'}</Text>;
    }
    const ui = render(<Probe />);
    try {
      hook!.setDraftValue(draft);
      await new Promise((resolve) => setTimeout(resolve, 30));
      hook!.handleEditSave();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(store).not.toHaveBeenCalled();
      expect(setComponents).not.toHaveBeenCalled();
      expect(onEditSaved).not.toHaveBeenCalled();
      expect(hook!.draftValue).toBe(draft);
      expect(hook!.saveError).toContain('Invalid');
    } finally {
      ui.unmount();
    }
  },
);
