import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  awaitForCurrentImportAttempt,
  cancelAndDrainImportWork,
  createImportAttemptOwner,
  trackImportWork,
} from '../../src/tui/import/cancellation.js';
import { useExtraction } from '../../src/tui/import/steps/06-extraction/use-extraction.js';
import type { ExtractionInput, ExtractionResult } from '../../src/tui/import/steps/06-extraction/types.js';
import { useGeneration } from '../../src/tui/import/steps/08-generation/use-generation.js';
import type { GenerationInput, GenerationResult } from '../../src/tui/import/steps/08-generation/types.js';
import { useScopeGateFlow } from '../../src/tui/import/steps/07-scope-gate/use-scope-gate-flow.js';
import type { ScopeGateLoad } from '../../src/tui/import/steps/07-scope-gate/types.js';

const extractionRun = vi.hoisted(() => ({ invoke: vi.fn() }));
const generationRun = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../src/tui/import/steps/06-extraction/run.js', () => ({ runExtraction: extractionRun.invoke }));
vi.mock('../../src/tui/import/steps/08-generation/run.js', () => ({ runGeneration: generationRun.invoke }));

beforeEach(() => vi.clearAllMocks());

function mountHook<P, T>(useHook: (input: P) => T, initialInput: P) {
  const result: { current: T | undefined } = { current: undefined };
  function Probe({ input }: { input: P }): React.ReactElement {
    result.current = useHook(input);
    return <Text />;
  }
  const view = render(<Probe input={initialInput} />);
  return {
    get current(): T {
      return result.current as T;
    },
    rerender: (input: P) => view.rerender(<Probe input={input} />),
    unmount: () => view.unmount(),
  };
}

const extractionInput = (signal?: AbortSignal): ExtractionInput => ({
  signal,
  projectPath: '/project',
  filePaths: [],
  rawTokensPath: '',
  tokenStrategy: 'generate',
  credentials: null,
  agent: 'claude',
  promptOverrides: [],
  noCache: false,
});

const generationInput = (signal?: AbortSignal): GenerationInput => ({
  signal,
  sessionId: 'session',
  decisions: { accepted: ['Button'], rejected: [] },
  cachedNames: Promise.resolve([]),
  tokensPath: '',
  tokenSessionId: null,
  existingEntitiesPath: null,
  agent: 'claude',
  promptOverrides: [],
  noCache: false,
  hasTokens: false,
});

describe('import attempt cancellation', () => {
  it('fences a preflight continuation when the attempt is replaced during an await', async () => {
    const owner = createImportAttemptOwner();
    const oldAttempt = owner.begin();
    let finishSettings!: (settings: { agent: string }) => void;
    const readSettings = vi.fn(
      () =>
        new Promise<{ agent: string }>((resolve) => {
          finishSettings = resolve;
        }),
    );
    const startChild = vi.fn();
    const prepared = awaitForCurrentImportAttempt(oldAttempt, owner.isCurrent, readSettings);
    const newAttempt = owner.begin();
    finishSettings({ agent: 'claude' });

    const result = await prepared;
    expect(result).toEqual({ current: false });
    if (result.current) startChild();
    expect(readSettings).toHaveBeenCalledOnce();
    expect(startChild).not.toHaveBeenCalled();
    expect(newAttempt.controller.signal.aborted).toBe(false);
  });

  it('cancels the active attempt and waits for its tracked stage work to drain', async () => {
    const owner = createImportAttemptOwner();
    const attempt = owner.begin();
    let finish!: () => void;
    const work = trackImportWork(new Promise<void>((resolve) => (finish = resolve)));
    let drained = false;
    const shutdown = cancelAndDrainImportWork().then(() => {
      drained = true;
    });

    expect(attempt.controller.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(drained).toBe(false);
    finish();
    await Promise.all([work, shutdown]);
    expect(drained).toBe(true);
    expect(owner.isCurrent(attempt)).toBe(false);
  });

  it('aborts the replaced attempt and only recognizes the newest attempt as current', () => {
    const owner = createImportAttemptOwner();
    const first = owner.begin();
    const second = owner.begin();

    expect(first.id).toBeLessThan(second.id);
    expect(first.controller.signal.aborted).toBe(true);
    expect(owner.isCurrent(first)).toBe(false);
    expect(owner.isCurrent(second)).toBe(true);

    owner.cancel();
    expect(second.controller.signal.aborted).toBe(true);
    expect(owner.isCurrent(second)).toBe(false);
    expect(owner.current()).toBeUndefined();
  });

  it('aborts extraction on input replacement and ignores its late completion', async () => {
    let resolveFirst!: (result: ExtractionResult) => void;
    let resolveSecond!: (result: ExtractionResult) => void;
    extractionRun.invoke
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));
    const view = mountHook(useExtraction, extractionInput());
    await vi.waitFor(() => expect(extractionRun.invoke).toHaveBeenCalledTimes(1));
    const oldSignal = extractionRun.invoke.mock.calls[0]?.[0].signal as AbortSignal;

    view.rerender(extractionInput());
    await vi.waitFor(() => expect(extractionRun.invoke).toHaveBeenCalledTimes(2));
    expect(oldSignal.aborted).toBe(true);

    resolveFirst({ ok: false, step: 'analyze extract', message: 'late old result' });
    resolveSecond({ ok: false, step: 'analyze extract', message: 'current result' });
    await vi.waitFor(() =>
      expect(view.current).toMatchObject({ status: 'done', result: { message: 'current result' } }),
    );
    view.unmount();
  });

  it('aborts only the stage signal when successful extraction clears its input', async () => {
    let finish!: (result: ExtractionResult) => void;
    extractionRun.invoke.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const attempt = new AbortController();
    const view = mountHook<ExtractionInput | undefined, ReturnType<typeof useExtraction>>(
      useExtraction,
      extractionInput(attempt.signal),
    );
    await vi.waitFor(() => expect(extractionRun.invoke).toHaveBeenCalledOnce());
    const stageSignal = extractionRun.invoke.mock.calls[0]?.[0].signal as AbortSignal;

    view.rerender(undefined);
    await vi.waitFor(() => expect(stageSignal.aborted).toBe(true));
    expect(attempt.signal.aborted).toBe(false);
    finish({ ok: false, step: 'analyze extract', message: 'late canceled result' });
    view.unmount();
  });

  it('captures rejected extraction promises as stage failures', async () => {
    extractionRun.invoke.mockRejectedValueOnce(new Error('unexpected extraction error'));
    const view = mountHook(useExtraction, extractionInput());

    await vi.waitFor(() =>
      expect(view.current).toMatchObject({
        status: 'done',
        result: { ok: false, step: 'analyze extract', message: 'unexpected extraction error' },
      }),
    );
    view.unmount();
  });

  it('aborts generation on input replacement, consumes late rejection, and leaves the new result in place', async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (result: GenerationResult) => void;
    generationRun.invoke
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFirst = reject)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));
    const view = mountHook(useGeneration, generationInput());
    await vi.waitFor(() => expect(generationRun.invoke).toHaveBeenCalledTimes(1));
    const oldSignal = generationRun.invoke.mock.calls[0]?.[0].signal as AbortSignal;

    view.rerender(generationInput());
    await vi.waitFor(() => expect(generationRun.invoke).toHaveBeenCalledTimes(2));
    expect(oldSignal.aborted).toBe(true);

    rejectFirst(new Error('late old rejection'));
    resolveSecond({ ok: false, step: 'generate components', message: 'current result' });
    await vi.waitFor(() =>
      expect(view.current).toMatchObject({ status: 'done', result: { message: 'current result' } }),
    );
    view.unmount();
  });

  it('cancels an active App-owned attempt and hook child on unmount, consuming late rejection', async () => {
    let rejectRun!: (error: Error) => void;
    extractionRun.invoke.mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectRun = reject)));
    const owner = createImportAttemptOwner();
    const attempt = owner.begin();
    const input = extractionInput(attempt.controller.signal);
    function AppHarness(): React.ReactElement {
      useExtraction(input);
      React.useEffect(() => () => owner.cancel(), []);
      return <Text />;
    }
    const view = render(<AppHarness />);
    await vi.waitFor(() => expect(extractionRun.invoke).toHaveBeenCalledOnce());
    const stageSignal = extractionRun.invoke.mock.calls[0]?.[0].signal as AbortSignal;

    view.unmount();
    await vi.waitFor(() => {
      expect(attempt.controller.signal.aborted).toBe(true);
      expect(stageSignal.aborted).toBe(true);
    });
    rejectRun(new Error('late rejection after unmount'));
    await Promise.resolve();
  });

  it('keys scope confirmation and cache restoration by attempt', async () => {
    const loaded = { ok: true, components: [] } as ScopeGateLoad;
    const checkCache = vi.fn(async () => [] as string[]);
    const deps = { load: vi.fn(() => loaded), checkCache };
    const firstController = new AbortController();
    const input = (attemptId: number, signal: AbortSignal) => ({
      attemptId,
      signal,
      sessionId: 'same-session',
      cache: {
        sessionId: 'same-session',
        tokensPath: '',
        agent: 'claude',
        promptOverrides: [],
        existingEntitiesPath: null,
        noCache: false,
      },
    });
    const view = mountHook((value) => useScopeGateFlow(value, deps), input(1, firstController.signal));

    const firstFlow = view.current;
    expect(firstFlow?.status).toBe('deciding');
    if (firstFlow?.status === 'deciding') firstFlow.confirm({ accepted: ['Button'], rejected: [] });
    await vi.waitFor(() => expect(view.current?.status).toBe('confirmed'));
    expect(checkCache).toHaveBeenCalledTimes(1);

    firstController.abort();
    const secondController = new AbortController();
    view.rerender(input(2, secondController.signal));
    expect(view.current?.status).toBe('deciding');
    await vi.waitFor(() => expect(checkCache).toHaveBeenCalledTimes(2));
    expect(view.current?.status).toBe('deciding');
    view.unmount();
  });
});
