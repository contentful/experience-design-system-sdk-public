import { render } from 'ink-testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { GenerateReviewStep } from '../../../src/tui/import/steps/09-review/generate-review-step.js';
import type {
  ImmediateInputHandler,
  ImmediateInputKey,
} from '../../../src/tui/import/steps/07-scope-gate/sidebar/hooks/useImmediateInput.js';
const state = vi.hoisted(() => ({
  input: undefined as ImmediateInputHandler | undefined,
  handlers: new Set<ImmediateInputHandler>(),
  entries: [] as unknown[],
  sets: 0,
  saved: [] as unknown[],
  store: vi.fn(),
}));
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
      state.input = (input, key) => {
        for (const registered of [...state.handlers]) registered(input, key);
      };
    },
  };
});
vi.mock('../../../src/tui/import/steps/09-review/use-review-session.js', async (importOriginal) => {
  const original = await importOriginal<object>();
  const { useState, useEffect } = await import('react');
  return {
    ...original,
    useReviewSession: ({ onExtraLoaded }: { onExtraLoaded: (cycles: unknown[]) => void }) => {
      const [components, set] = useState(state.entries);
      useEffect(() => {
        onExtraLoaded([
          {
            path: ['Example', 'Example'],
            edges: [{ fromComponent: 'Example', slotName: 'region', toComponent: 'Example' }],
          },
        ]);
      }, [onExtraLoaded]);
      return {
        components,
        setComponents: (update: unknown[] | ((entries: unknown[]) => unknown[])) => {
          const entries = typeof update === 'function' ? update(state.entries) : update;
          state.entries = entries;
          state.sets++;
          set(entries);
        },
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
  storeReviewCDFComponent: (
    db: unknown,
    session: string,
    component: { key: string; componentId?: string },
    entry: unknown,
  ) => {
    state.store(db, session, component, entry);
    state.saved = [{ ...component, componentId: component.componentId ?? 'component', entry }];
  },
  loadReviewCDFComponents: () => state.saved,
  storeSlotCycles: vi.fn(),
}));
afterEach(() => {
  state.store.mockReset();
  state.sets = 0;
  state.saved = [];
});
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
async function key(input: string, isReturn = false) {
  state.input!(input, { return: isReturn } as ImmediateInputKey);
  await pause();
}
it.each(['failure', 'success'])(
  'mounted cycle edit preserves association and publishes state only after save: %s',
  async (mode) => {
    const sourceInput = {
      schemaVersion: 1,
      componentId: 'surface',
      componentDeclarationId: 'declaration',
      rootSymbolId: 'parameter',
      inputName: 'supplied',
      inputPath: ['supplied'],
    };
    state.entries = [
      {
        key: 'Example',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: {
            region: {
              $allowedComponents: ['Example'],
              $sourceInput: sourceInput,
              $required: true,
              $description: 'Original',
            },
          },
        },
        status: 'accepted',
      },
    ];
    if (mode === 'failure')
      state.store.mockImplementation(() => {
        throw new Error('Cycle write failed');
      });
    const ui = render(<GenerateReviewStep extractSessionId="example" onFinalize={vi.fn()} onQuit={vi.fn()} />);
    try {
      await pause();
      await key('c');
      await key('x');
      await key('', true);
      const before = structuredClone(state.entries);
      const sets = state.sets;
      expect(() => state.input!('y', {} as ImmediateInputKey)).not.toThrow();
      await pause();
      if (!state.store.mock.calls.length)
        throw new Error(JSON.stringify({ frame: ui.lastFrame(), entries: state.entries }));
      expect(state.store).toHaveBeenCalled();
      if (mode === 'failure') {
        expect(state.entries).toEqual(before);
        expect(state.sets).toBe(sets);
        expect(ui.lastFrame()).toContain('Cycle write failed');
      } else {
        expect(state.entries).not.toEqual(before);
        const next = state.store.mock.calls[0]![3].$slots.region;
        expect(next.$sourceInput).toEqual(sourceInput);
        expect(next.$required).toBe(true);
        expect(next.$description).toBe('Original');
        expect(next.$allowedComponents).toEqual([]);
      }
    } finally {
      ui.unmount();
    }
  },
);
