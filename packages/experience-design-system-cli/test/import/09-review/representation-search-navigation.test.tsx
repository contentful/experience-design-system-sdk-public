import { render } from 'ink-testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { GenerateReviewStep } from '../../../src/tui/import/steps/09-review/generate-review-step.js';
import type { CdfReviewEntry } from '../../../src/tui/import/steps/09-review/types.js';
import type {
  ImmediateInputHandler,
  ImmediateInputKey,
} from '../../../src/tui/import/steps/07-scope-gate/sidebar/hooks/useImmediateInput.js';

const state = vi.hoisted(() => ({ handlers: new Set<ImmediateInputHandler>() }));
vi.mock('../../../src/tui/import/steps/07-scope-gate/sidebar/hooks/useImmediateInput.js', async () => {
  const { useRef, useLayoutEffect } = await import('react');
  return {
    useImmediateInput: (handler: ImmediateInputHandler, enabled = true) => {
      const ref = useRef(handler);
      ref.current = handler;
      useLayoutEffect(() => {
        if (!enabled) return;
        const registered: ImmediateInputHandler = (input, key) => ref.current(input, key);
        state.handlers.add(registered);
        return () => {
          state.handlers.delete(registered);
        };
      }, [enabled]);
    },
  };
});
vi.mock('../../../src/tui/import/steps/09-review/use-review-session.js', async (importOriginal) => {
  const original = await importOriginal<object>();
  const { useState } = await import('react');
  return {
    ...original,
    useReviewSession: () => {
      const [components, setComponents] = useState<CdfReviewEntry[]>([
        { key: 'Example', status: 'accepted', entry: { $type: 'component', $properties: {} } },
      ]);
      return {
        components,
        setComponents,
        loading: false,
        loadError: null,
        availableTokens: [],
        reloadFromSave: vi.fn(),
      };
    },
    useReviewMetadata: () => ({ reviewMetadata: null, componentRationale: null }),
    useReviewFinalize: () => ({
      finalizePreview: { removed: [], status: 'idle', scrollOffset: 0 },
      handleFinalizeConfirm: vi.fn(),
    }),
  };
});
vi.mock('@contentful/experience-design-system-backend-pipeline', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openPipelineDb: () => ({ close: vi.fn() }),
  loadRawComponents: () => [],
  storeSlotCycles: vi.fn(),
}));

const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
async function press(input: string, key: Partial<ImmediateInputKey> = {}) {
  for (const handler of [...state.handlers]) handler(input, key as ImmediateInputKey);
  await pause();
}
afterEach(() => state.handlers.clear());

it('keeps the representation hotkey as text while the actual review search is active', async () => {
  const ui = render(<GenerateReviewStep extractSessionId="example-session" onFinalize={vi.fn()} onQuit={vi.fn()} />);
  try {
    await pause();
    await press('/');
    await press('m');
    expect(ui.lastFrame()).toContain('/m');
    expect(ui.lastFrame()).not.toContain('Source representations');
    await press('', { escape: true });
    await press('m');
    expect(ui.lastFrame()).toContain('Source representations');
    await press('', { escape: true });
    expect(ui.lastFrame()).not.toContain('Source representations');
  } finally {
    ui.unmount();
  }
});
