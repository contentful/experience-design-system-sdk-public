import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useSyncExternalStore } from 'react';
import * as backend from '@contentful/experience-design-system-backend-pipeline';
import { seedCompleteDefinitions } from '../source-session-fixture.js';
import { runPreview, realPreviewDeps } from '../../../src/tui/import/steps/10-flow/flow/preview.js';
import { FlowScreen } from '../../../src/tui/import/steps/10-flow/flow/screen.js';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  storeCDFComponents,
} from '@contentful/experience-design-system-backend-pipeline';
const cycle = vi.hoisted(() => ({ failure: false }));
vi.mock('../../../src/tui/import/steps/07-scope-gate/graph/cycle-detection.js', async (original) => {
  const real = await original<typeof import('../../../src/tui/import/steps/07-scope-gate/graph/cycle-detection.js')>();
  return {
    ...real,
    findSlotCycles: (...args: Parameters<typeof real.findSlotCycles>) => {
      if (cycle.failure) throw new Error('cycle check unavailable');
      return real.findSlotCycles(...args);
    },
  };
});
import {
  createFlowController,
  realFlowDeps,
  type FlowDeps,
  type FlowStart,
} from '../../../src/tui/import/steps/10-flow/flow/controller.js';
import { GenerateReviewStep } from '../../../src/tui/import/steps/09-review/generate-review-step.js';
let root: string;
let unmount: (() => void) | undefined;
beforeEach(() => {
  cycle.failure = false;
  root = mkdtempSync(join(tmpdir(), 'failure-gates-'));
  vi.stubEnv('EDS_PIPELINE_DB_PATH', join(root, 'pipeline.db'));
});
afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
const start = (): FlowStart => ({
  handoff: {
    credentialsSkipped: true,
    tokens: { strategy: 'generate' },
    extraction: {
      sessionId: 'example',
      outDir: '/example/out',
      tokensPath: '',
      tokenSessionId: null,
      tokenCount: 0,
      existingEntitiesPath: null,
      existingEntitiesStatus: 'idle',
      compositionPhase: 'done',
    },
    generation: {
      route: 'review',
      sessionId: 'example',
      acceptedCount: 1,
      generatedCount: 1,
      mapTokensEligible: false,
    },
  },
  agent: 'codex',
  projectPath: '/example',
  outDir: '/example/out',
  rawTokensPath: '',
  credentials: { spaceId: '', environmentId: '', cmaToken: '', host: '' },
});
const deps = (loadAcceptedComponents: FlowDeps['loadAcceptedComponents']): FlowDeps => ({
  preview: {} as never,
  push: {} as never,
  save: {} as never,
  loadAcceptedComponents,
  mkdir: vi.fn(),
  detectSaveConflict: vi.fn(),
  buildTimestampedSubdir: vi.fn(),
  rejectComponentsByName: vi.fn(),
  log: vi.fn(),
  stderr: vi.fn(),
});
it.each(['load', 'calculation'])(
  'blocks controller finalization and subsequent save routes on %s failure',
  async (kind) => {
    const dependencies = deps(() => {
      if (kind === 'load') throw new Error('accepted data unavailable');
      return [];
    });
    cycle.failure = kind === 'calculation';
    const flow = createFlowController(start(), dependencies);
    flow.finalize(1, 0, 0);
    expect(flow.getState()).toMatchObject({ step: 'error', finalReviewPassed: false, errorStep: 'final review' });
    expect(flow.getState().errorMessage).toContain('unavailable');
    await flow.submitPath('/example/out');
    expect(dependencies.mkdir).not.toHaveBeenCalled();
  },
);
it('keeps the controller acyclic and explicit-empty finalize routes', () => {
  for (const accepted of [0, 1]) {
    const flow = createFlowController(
      start(),
      deps(() => []),
    );
    flow.finalize(accepted, 0, 0);
    expect(flow.getState()).toMatchObject({
      step: 'path-prompt',
      finalReviewPassed: true,
      generatedAcceptedCount: accepted,
    });
  }
});
it('the actual mounted final review shows calculation failure and cannot open confirmation', async () => {
  const db = openPipelineDb();
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, [
    {
      name: 'Panel',
      source: '/example/Panel.tsx',
      framework: 'react',
      props: [{ name: 'label', type: 'string', required: false }],
      slots: [],
    },
  ]);
  storeCDFComponents(db, sessionId, [
    { key: 'Panel', entry: { $type: 'component', $properties: { label: { $type: 'string', $category: 'content' } } } },
  ]);
  db.close();
  const finalize = vi.fn();
  const view = render(
    <GenerateReviewStep extractSessionId={sessionId} onFinalize={finalize} onQuit={vi.fn()} livePreview={false} />,
  );
  unmount = view.unmount;
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Panel'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const before = view.lastFrame();
  view.stdin.write('A');
  await vi.waitFor(() => expect(view.lastFrame()).not.toBe(before));
  cycle.failure = true;
  view.stdin.write('f');
  await vi.waitFor(() => expect(view.lastFrame()).toContain('cycle check unavailable'));
  expect(view.lastFrame()).not.toContain('Finalize review?');
  expect(finalize).not.toHaveBeenCalled();
});

it('known cycles block the controller until the next check uses the updated acyclic definitions', () => {
  const cyclic = [{ key: 'Panel', entry: { $type: 'component', $slots: { body: { $allowedComponents: ['Panel'] } } } }];
  let accepted = cyclic;
  const flow = createFlowController(
    start(),
    deps(() => accepted),
  );
  flow.finalize(1, 0, 0);
  expect(flow.getState()).toMatchObject({ step: 'error', finalReviewPassed: false });
  accepted = [{ key: 'Panel', entry: { $type: 'component', $slots: { body: { $allowedComponents: [] } } } }];
  flow.editDefinitions();
  flow.finalize(1, 0, 0);
  expect(flow.getState()).toMatchObject({ step: 'path-prompt', finalReviewPassed: true });
});
it('real accepted load closes its database when the underlying read fails', () => {
  const actualOpen = backend.openPipelineDb;
  const db = actualOpen();
  const close = vi.spyOn(db, 'close');
  vi.spyOn(backend, 'openPipelineDb').mockReturnValue(db);
  vi.spyOn(backend, 'loadSelectedCDFComponents').mockImplementation(() => {
    throw new Error('Stored CDF unavailable');
  });
  expect(() => realFlowDeps().loadAcceptedComponents('example')).toThrow('Stored CDF unavailable');
  expect(close).toHaveBeenCalledOnce();
});
it('the mounted FlowScreen routes an accepted-load failure from confirmation to an error without a path prompt', async () => {
  const db = openPipelineDb();
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, [
    {
      name: 'Panel',
      source: '/example/Panel.tsx',
      framework: 'react',
      props: [{ name: 'label', type: 'string', required: false }],
      slots: [],
    },
  ]);
  await seedCompleteDefinitions(db, sessionId, root, [
    { key: 'Panel', entry: { $type: 'component', $properties: { label: { $type: 'string', $category: 'content' } } } },
  ]);
  db.close();
  const input = start();
  input.handoff.extraction!.sessionId = sessionId;
  const dependencies = deps(() => {
    throw new Error('Accepted load unavailable');
  });
  const flow = createFlowController(input, dependencies);
  function MountedFlow() {
    const state = useSyncExternalStore(flow.subscribe, flow.getState);
    return <FlowScreen state={state} controller={flow} livePreview={false} onExit={vi.fn()} />;
  }
  const view = render(<MountedFlow />);
  unmount = view.unmount;
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Panel'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write('A');
  await vi.waitFor(() => expect(view.lastFrame()).not.toContain('Loading'));
  view.stdin.write('f');
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Save decisions and exit?'));
  view.stdin.write('y');
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Accepted load unavailable'));
  expect(flow.getState()).toMatchObject({ step: 'error', finalReviewPassed: false });
  await flow.submitPath('/example/out');
  expect(dependencies.mkdir).not.toHaveBeenCalled();
});

it('mounted known cycles block until a member is rejected and the accepted graph is recomputed', async () => {
  const db = openPipelineDb();
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, [
    {
      name: 'Panel',
      source: '/example/Panel.tsx',
      framework: 'react',
      props: [{ name: 'label', type: 'string', required: false }],
      slots: [{ name: 'body', description: '', isDefault: false, allowedComponents: ['Panel'] }],
    },
  ]);
  storeCDFComponents(db, sessionId, [
    {
      key: 'Panel',
      entry: {
        $type: 'component',
        $properties: { label: { $type: 'string', $category: 'content' } },
        $slots: { body: { $allowedComponents: ['Panel'] } },
      },
    },
  ]);
  db.close();
  const view = render(
    <GenerateReviewStep extractSessionId={sessionId} onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
  );
  unmount = view.unmount;
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Panel'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(view.lastFrame()).toContain('auto-rejected');
  const before = view.lastFrame();
  view.stdin.write('a');
  await vi.waitFor(() => expect(view.lastFrame()).not.toBe(before));
  view.stdin.write('f');
  await vi.waitFor(() => expect(view.lastFrame()).toContain('accepted set still contains a cycle'));
  view.stdin.write('r');
  await vi.waitFor(() => expect(view.lastFrame()).not.toContain('accepted set still contains a cycle'));
  view.stdin.write('f');
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Confirm exit with nothing accepted?'));
});

it('mounted preview recovery routes corrupt review state to an error while preserving state and events', async () => {
  vi.stubEnv('EDS_REVIEW_ARTIFACTS_DIR', join(root, 'reviews'));
  const db = openPipelineDb();
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, [
    {
      name: 'Panel',
      source: '/example/Panel.tsx',
      framework: 'react',
      props: [{ name: 'label', type: 'string', required: false }],
      slots: [],
    },
  ]);
  await seedCompleteDefinitions(db, sessionId, root, [
    { key: 'Panel', entry: { $type: 'component', $properties: { label: { $type: 'string', $category: 'content' } } } },
  ]);
  db.close();
  const dir = join(root, 'reviews', sessionId);
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, 'current-review-state.json');
  const eventsPath = join(dir, 'events.jsonl');
  writeFileSync(statePath, '{ retained corrupt');
  writeFileSync(eventsPath, 'retained events');
  const dependencies = realPreviewDeps();
  dependencies.createClient = () => ({
    previewImport: async () => {
      throw new backend.ApiError(
        'Validation failed',
        422,
        JSON.stringify({
          details: { errors: [{ path: 'manifest:components/Panel/label', message: 'Example validation issue' }] },
        }),
      );
    },
    getLastRequestId: () => undefined,
  });
  const patch = await runPreview(
    {
      state: { credentialsSkipped: false },
      extractSessionId: sessionId,
      tokensPath: '',
      spaceId: 'example',
      environmentId: 'preview',
      cmaToken: 'example-token',
      host: 'api.example.com',
      deleteAll: false,
    },
    dependencies,
  );
  expect(patch).toMatchObject({ step: 'error', errorStep: 'apply preview' });
  expect(patch.errorMessage).toContain(statePath);
  expect(readFileSync(statePath, 'utf8')).toBe('{ retained corrupt');
  expect(readFileSync(eventsPath, 'utf8')).toBe('retained events');
  const controller = createFlowController(
    start(),
    deps(() => []),
  );
  const view = render(
    <FlowScreen
      state={{ ...controller.getState(), ...patch }}
      controller={controller}
      onExit={vi.fn()}
      livePreview={false}
    />,
  );
  unmount = view.unmount;
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Preview validation could not be recorded'));
  expect(view.lastFrame()).toContain('[Enter] Exit');
});
