import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { captureSourceEvidence } from '@contentful/experience-design-system-extraction';
import {
  completeExtractionWithSourceEvidence,
  createStep,
  getOrCreateSession,
  loadCompletedSourceEvidence,
  loadComponentReviewMetadata,
  loadRawComponents,
  loadSavedComponentSourceRef,
  loadSavedSharedSource,
  openPipelineDb,
  storeRawComponents,
} from '../../src/persistence/src/session/repositories/db.js';
import { hydrateSourceFixture } from '../source-fixture.js';
import { buildExplorationSourceInput } from '../../src/orchestrators/run-exploration-session/helpers/build-source-input.js';
import { runOneGenerateComponent } from '../../src/orchestrators/run-generate-components-session/helpers/run-one-generate-component.js';
import {
  buildSelectionEvidenceInline,
  renderSelectionEvidenceInline,
} from '../../src/agents/prompts/helpers/build-selection-evidence-inline.js';
import type { RawComponentDefinition } from '../../src/steps/extraction/src/types/component.js';

let root: string;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});
it('keeps nested configured source, callers and context hashes through first/final/reopen and actual generation/review adapters', async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'saved-configured-source-')));
  const local = join(root, 'packages/example');
  mkdirSync(join(local, 'parts'), { recursive: true });
  const source = join(local, 'parts/widget.tsx'),
    app = join(local, 'app.tsx'),
    config = join(local, 'tsconfig.json');
  writeFileSync(
    source,
    `export function Widget({size='small'}: {size?: 'small' | 'large'; label: string}) { return <section/>; }`,
  );
  writeFileSync(
    app,
    'import { Widget as Local } from "@parts/widget"; export const View = () => <Local size="small" label="example"/>; export const call = () => Local({label:"example"});',
  );
  writeFileSync(config, '{"compilerOptions":{"baseUrl":".","paths":{"@parts/*":["parts/*"]},"noEmit":false}}');
  const component: RawComponentDefinition = {
    name: 'Widget',
    source,
    sourcePath: source,
    framework: 'react',
    props: [
      { name: 'size', type: "'small' | 'large'", required: false, defaultValue: "'small'" },
      { name: 'label', type: 'string', required: true },
    ],
    slots: [],
  };
  const hydrated = await hydrateSourceFixture(component, root);
  const dbPath = join(root, 'pipeline.db'),
    db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  const stepId = createStep(db, sessionId, 'analyze extract', { project: root });
  expect(loadCompletedSourceEvidence(db, sessionId).readiness).toBe('unavailable');
  storeRawComponents(db, sessionId, [hydrated]);
  const first = loadRawComponents(db, sessionId)[0]!;
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [source, app],
    components: [{ componentId: first.component_id, name: 'Widget', sourcePath: source }],
  });
  const handle = completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId,
    components: [hydrated],
    cycles: [],
    scannedFiles: [source, app],
    capture,
    observations: { accepted: [], rejected: [] },
  });
  const savedContext = capture.compilerContexts![0]!;
  const configHash = capture.files.find((file) => file.canonicalPath === config)!.textHash!;
  expect(capture.files.find((file) => file.canonicalPath === app)?.componentRefs[0]?.roles).toEqual(
    expect.arrayContaining(['binding', 'application', 'caller', 'reference']),
  );
  db.close();
  writeFileSync(source, 'export function Widget() { return "LIVE_REPLACEMENT"; }');
  writeFileSync(config, '{"compilerOptions":{"paths":{"@parts/*":["wrong/*"]}}}');
  rmSync(app);
  const reopened = openPipelineDb(dbPath);
  try {
    expect(loadCompletedSourceEvidence(reopened, sessionId, { ...handle, digest: 'wrong' }).readiness).toBe(
      'unavailable',
    );
    const saved = loadCompletedSourceEvidence(reopened, sessionId, handle);
    expect(saved.readiness).toBe('ready');
    if (saved.readiness !== 'ready') throw new Error(saved.reason);
    expect(saved.envelope.capture.compilerContexts).toEqual(capture.compilerContexts);
    const final = loadRawComponents(reopened, sessionId)[0]!;
    expect(
      final.props.map(({ name, type, required, defaultValue }) => ({ name, type, required, defaultValue })),
    ).toEqual(first.props.map(({ name, type, required, defaultValue }) => ({ name, type, required, defaultValue })));
    const shared = loadSavedSharedSource(reopened, sessionId, { componentIds: [first.component_id], handle });
    expect(shared.readiness).toBe('ready');
    if (shared.readiness !== 'ready') throw new Error(shared.reason);
    expect(shared.source.files).toHaveLength(3);
    expect(shared.source.files.find((file) => file.canonicalPath === config)?.textHash).toBe(configHash);
    expect(shared.source.compilerContexts).toEqual([savedContext]);
    const compatibility = loadSavedComponentSourceRef(reopened, sessionId, first.component_id, 'Widget', source);
    expect(compatibility.compilerContexts).toEqual([savedContext]);
    expect(JSON.stringify(compatibility).match(/"compilerOptions":/g)).toHaveLength(1);
    expect(compatibility.siblingFiles?.some((file) => file.content.includes('Local({label:'))).toBe(true);
    const exploration = buildExplorationSourceInput(saved.envelope, 10000);
    expect(exploration.compilerContexts).toEqual([savedContext]);
    expect(exploration.files.find((file) => file.path === app)?.compilerContextId).toBe(savedContext.contextId);
    const selection = buildSelectionEvidenceInline(saved.envelope);
    expect(JSON.parse(selection).compilerContexts).toEqual([savedContext]);
    expect(Buffer.byteLength(renderSelectionEvidenceInline(selection), 'utf8')).toBeLessThanOrEqual(
      capture.bounds.limits.maxPromptBytes,
    );
    const prompts: string[] = [];
    const generated = await runOneGenerateComponent(
      {
        db: reopened,
        sessionId,
        invoker: {
          checkAuth: async () => 'ok',
          invoke: async ({ prompt }) => {
            prompts.push(prompt);
            return {
              stdout:
                JSON.stringify({ tool: 'classify_component' }) +
                '\n' +
                JSON.stringify({
                  tool: 'classify_prop',
                  prop: 'size',
                  cdf_type: 'string',
                  cdf_category: 'content',
                  values: ['small', 'large'],
                }) +
                '\n' +
                JSON.stringify({
                  tool: 'classify_prop',
                  prop: 'label',
                  cdf_type: 'string',
                  cdf_category: 'content',
                }),
              stderr: '',
              exitCode: 0,
              timedOut: false,
            };
          },
        },
        agent: 'claude',
        model: undefined,
        tokensInline: undefined,
        tokenMapInline: undefined,
        verbose: false,
        noCache: true,
        skillPathOverride: undefined,
        skillContentOverride: 'Generate from captured declarations.',
        promptHash: 'generic-configured-test',
        existingContentfulEntities: undefined,
        existingTokensInline: undefined,
        precomputedCachedNames: new Set(),
        allowedComponentNames: new Set(['Widget']),
        onProgress: undefined,
      },
      final,
      0,
      1,
    );
    expect(generated.failed, JSON.stringify(generated)).toBe(false);
    expect(prompts[0]).toContain(savedContext.contextId);
    expect(prompts[0]).toContain(configHash);
    expect(prompts[0]).toContain('"caller"');
    expect(prompts[0]).toContain('large');
    expect(prompts[0]).not.toContain('LIVE_REPLACEMENT');
    expect(prompts[0]?.match(/### Shared source evidence/g)).toHaveLength(1);
    const sharedSection = prompts[0]!.split('### Shared source evidence')[1]!;
    expect(sharedSection.match(/export function Widget/g)).toHaveLength(1);
    const review = loadComponentReviewMetadata(reopened, sessionId, 'Widget');
    expect(review?.sourceCompilerContext).toEqual(savedContext);
    expect(review?.sourceTextHash).toBe(capture.files.find((file) => file.canonicalPath === source)!.textHash);
    expect(review?.componentSource).not.toContain('LIVE_REPLACEMENT');
    expect(JSON.parse(JSON.stringify(review)).sourceCompilerContext).toEqual(savedContext);
  } finally {
    reopened.close();
  }
});
