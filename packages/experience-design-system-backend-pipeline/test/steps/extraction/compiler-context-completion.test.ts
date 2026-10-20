import { mkdirSync, mkdtempSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { Project } from 'ts-morph';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractEndpoint, captureSourceEvidence } from '@contentful/experience-design-system-extraction';
import { extractComponents } from '../../../src/steps/extraction/src/controller/extract-components-endpoint.js';
import { buildCompilerEvidenceInline } from '../../../src/agents/prompts/helpers/build-compiler-evidence-inline.js';
import { buildExplorationSourceInput } from '../../../src/orchestrators/run-exploration-session/helpers/build-source-input.js';
import { runOneGenerateComponent } from '../../../src/orchestrators/run-generate-components-session/helpers/run-one-generate-component.js';
import { runExploreStage } from '../../../src/steps/exploration/src/services/run-explore-stage.js';
import * as saved from '../../../src/persistence/src/session/repositories/db.js';

const roots: string[] = [];
function fixture(files: Record<string, string | undefined>): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'configured-endpoints-')));
  roots.push(root);
  for (const [name, source] of Object.entries(files)) {
    if (source === undefined) continue;
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, source);
  }
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const producers = [
  ['public', (paths: string[], projectRoot: string) => extractEndpoint({ filePaths: paths, projectRoot })],
  ['backend', (paths: string[], projectRoot: string) => extractComponents({ filePaths: paths, projectRoot })],
] as const;
describe('matched actual configured producers', () => {
  for (const [owner, extract] of producers) {
    it.each([
      { extension: 'tsx', config: 'tsconfig.json', mode: 'NodeNext', resolution: 'NodeNext', strict: true },
      { extension: 'jsx', config: 'jsconfig.json', mode: 'ESNext', resolution: 'Bundler', strict: false },
      { extension: 'vue', config: 'tsconfig.json', mode: 'Node16', resolution: 'Node16', strict: true },
      { extension: 'vue', config: 'jsconfig.json', mode: 'ESNext', resolution: 'Bundler', strict: false },
    ])(
      `${owner} honors extends/paths/configured modes for $extension/$config`,
      async ({ extension, config, mode, resolution, strict }) => {
        const source =
          extension === 'vue'
            ? '<script setup lang="ts">import type { Props } from "@props/Props"; defineProps<Props>();</script><template><section>{{ label }}</section></template>'
            : extension === 'jsx'
              ? '/** @param {import("@props/Props").Props} props */ export function Example(props) { return <section>{props.label}</section>; }'
              : 'import type { Props } from "@props/Props"; export function Example(props: Props) { return <section>{props.label}</section>; }';
        const root = fixture({
          'base.json': JSON.stringify({
            compilerOptions: {
              strict,
              jsx: 'react-jsx',
              allowJs: true,
              noEmit: false,
              declaration: true,
              sourceMap: true,
              incremental: true,
              outDir: './out',
              tsBuildInfoFile: './out/build.tsbuildinfo',
              baseUrl: '.',
              paths: { '@props/*': ['types/*'] },
            },
          }),
          [config]: JSON.stringify({
            extends: './base.json',
            compilerOptions: { module: mode, moduleResolution: resolution },
            include: ['**/*'],
          }),
          'types/Props.d.ts': 'export interface Props { label: string; mode?: "small" | "large" }',
          [`Example.${extension}`]: source,
          'Unscanned.tsx': 'export const Unscanned = () => <section/>;',
        });
        const before = readdirSync(root, { recursive: true }).map(String).sort();
        const emit = vi.spyOn(Project.prototype, 'emit'),
          emitSync = vi.spyOn(Project.prototype, 'emitSync'),
          memory = vi.spyOn(Project.prototype, 'emitToMemory');
        const result = await extract([join(root, `Example.${extension}`)], root);
        expect(result.components.map((c) => c.name)).toEqual(['Example']);
        expect(result.extractionDiagnostics?.projects[0]).toMatchObject({
          configPath: join(root, config),
          options: {
            module: ts.ModuleKind[mode as keyof typeof ts.ModuleKind],
            moduleResolution: ts.ModuleResolutionKind[resolution as keyof typeof ts.ModuleResolutionKind],
            strict,
            noEmit: true,
            baseUrl: root,
          },
        });
        expect(result.extractionDiagnostics?.projects[0]?.options.paths).toBe(
          JSON.stringify({ '@props/*': ['types/*'] }),
        );
        expect(result.components[0]?.sourceCandidates?.find((c) => c.name === 'label')?.facts?.declarations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ canonicalPath: join(root, 'types/Props.d.ts'), textHash: expect.any(String) }),
          ]),
        );
        expect(result.extractionDiagnostics?.reads).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: join(root, 'base.json'), kind: 'config', outcome: 'read' }),
            expect.objectContaining({ path: join(root, 'types/Props.d.ts'), kind: 'compiler', outcome: 'read' }),
          ]),
        );
        expect(emit).not.toHaveBeenCalled();
        expect(emitSync).not.toHaveBeenCalled();
        expect(memory).not.toHaveBeenCalled();
        expect(readdirSync(root, { recursive: true }).map(String).sort()).toEqual(before);
        expect(JSON.parse(JSON.stringify(result.extractionDiagnostics))).toEqual(result.extractionDiagnostics);
      },
    );
  }
});

describe('compiler roots and saved uncertainty', () => {
  it('saves distinct solution-root contexts after cold reopen with zero component output', async () => {
    const root = fixture({
      'tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './apps/web/config.json' }, { path: './apps/node/config.json' }],
      }),
      'apps/web/config.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","strict":false}}',
      'apps/node/config.json': '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","strict":true}}',
      'apps/web/plain.tsx': 'export const value = 1;',
      'apps/node/plain.tsx': 'export const value = 2;',
    });
    const paths = [join(root, 'apps/web/plain.tsx'), join(root, 'apps/node/plain.tsx')];
    const result = await extractComponents({ filePaths: paths, projectRoot: root });
    expect(result.components).toEqual([]);
    expect(result.extractionDiagnostics?.references).toEqual(
      expect.arrayContaining(paths.map((path) => expect.objectContaining({ root: path, outcome: 'selected' }))),
    );
    expect(new Set(result.extractionDiagnostics?.projects.map((project) => project.configPath)).size).toBe(2);
    const dbPath = join(root, 'pipeline.db');
    let db = saved.openPipelineDb(dbPath);
    const { sessionId } = saved.getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    const stepId = saved.createStep(db, sessionId, 'analyze extract', { project: root });
    saved.storeRawComponents(db, sessionId, [], { extractionDiagnostics: result.extractionDiagnostics });
    expect(saved.loadCompletedSourceEvidence(db, sessionId).readiness).toBe('unavailable');
    const capture = await captureSourceEvidence({ projectRoot: root, filePaths: paths });
    saved.completeExtractionWithSourceEvidence(db, {
      sessionId,
      stepId,
      components: [],
      capture,
      cycles: [],
      scannedFiles: paths,
      observations: { accepted: [], rejected: [] },
      extractionDiagnostics: result.extractionDiagnostics,
    });
    db.close();
    db = saved.openPipelineDb(dbPath);
    try {
      const read = saved.loadExtractionSourceDiagnostics(db, sessionId);
      expect(read.status).toBe('available');
      if (read.status !== 'available') throw new Error('Unavailable compiler receipts');
      expect(read.diagnostics.projects).toHaveLength(2);
      expect(read.diagnostics.references).toEqual(result.extractionDiagnostics?.references);
      expect(read.diagnostics.reads?.some((r) => r.kind === 'config' && r.binding === 'verified')).toBe(true);
      expect(saved.loadCompletedSourceEvidence(db, sessionId).readiness).toBe('ready');
    } finally {
      db.close();
    }
  });
});

for (const [owner, extract] of producers) {
  it.each([
    {
      name: 'missing',
      config: { files: [], references: [{ path: './group/config.json' }] },
      extra: {},
      relative: 'group/plain.tsx',
      outcome: 'invalid',
    },
    {
      name: 'invalid',
      config: { files: [], references: [{ path: './group/config.json' }] },
      extra: { 'group/config.json': 'malformed' },
      relative: 'group/plain.tsx',
      outcome: 'invalid',
    },
    {
      name: 'cycle',
      config: { files: [], references: [{ path: './group/config.json' }] },
      extra: { 'group/config.json': '{"files":[],"references":[{"path":"../tsconfig.json"}]}' },
      relative: 'group/plain.tsx',
      outcome: 'cycle',
    },
    {
      name: 'overlap',
      config: { files: [], references: [{ path: './group/config.json' }, { path: './group/nested/config.json' }] },
      extra: {},
      relative: 'group/nested/plain.tsx',
      outcome: 'ambiguous',
    },
    {
      name: 'unmatched',
      config: { files: [], references: [{ path: './other/config.json' }] },
      extra: {},
      relative: 'plain.tsx',
      outcome: 'ambiguous',
    },
    {
      name: 'reference-budget',
      config: { files: [], references: Array.from({ length: 65 }, (_, i) => ({ path: `./group${i}/config.json` })) },
      extra: {},
      relative: 'group0/plain.tsx',
      outcome: 'budget-exhausted',
    },
  ])(`${owner} saves honest zero-output $name reference diagnostics`, async ({ config, extra, relative, outcome }) => {
    const root = fixture({ 'tsconfig.json': JSON.stringify(config), ...extra, [relative]: 'export const value = 1;' });
    const source = join(root, relative),
      result = await extract([source], root);
    expect(result.components).toEqual([]);
    expect(result.extractionDiagnostics?.references).toContainEqual(expect.objectContaining({ root: source, outcome }));
    expect(result.extractionDiagnostics?.projects[0]?.diagnostics.length).toBeGreaterThan(0);
    expect(result.extractionDiagnostics?.coverage).toBe('partial');
    const dbPath = join(root, 'receipts.db'),
      db = saved.openPipelineDb(dbPath),
      { sessionId } = saved.getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    saved.storeRawComponents(db, sessionId, [], { extractionDiagnostics: result.extractionDiagnostics });
    db.close();
    const reopened = saved.openPipelineDb(dbPath);
    try {
      const read = saved.loadExtractionSourceDiagnostics(reopened, sessionId);
      expect(read).toEqual({ status: 'available', diagnostics: result.extractionDiagnostics });
    } finally {
      reopened.close();
    }
  });
}

it.each(['stable', 'changed', 'deleted'] as const)(
  'keeps actual observed %s read bindings through ready selection/fresh generation/review',
  async (variant) => {
    const root = fixture({
      'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","strict":true}}',
      'Props.d.ts': 'export interface Props { label: string }',
      'Example.tsx':
        'import type { Props } from "./Props"; export function Example(props: Props) { return <section>{props.label}</section>; }',
    });
    const source = join(root, 'Example.tsx'),
      support = join(root, 'Props.d.ts');
    const result = await extractComponents({ filePaths: [source], projectRoot: root });
    expect(result.components).toHaveLength(1);
    const dbPath = join(root, 'pipeline.db');
    let db = saved.openPipelineDb(dbPath);
    const { sessionId } = saved.getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    const stepId = saved.createStep(db, sessionId, 'analyze extract', { project: root });
    saved.storeRawComponents(db, sessionId, result.components, { extractionDiagnostics: result.extractionDiagnostics });
    const initial = saved.loadRawComponents(db, sessionId)[0]!;
    expect(saved.loadCompletedSourceEvidence(db, sessionId).readiness).toBe('unavailable');
    if (variant === 'changed') writeFileSync(support, 'export interface Props { label: number }');
    if (variant === 'deleted') rmSync(support);
    const capture = await captureSourceEvidence({
      projectRoot: root,
      filePaths: [source],
      components: [{ componentId: initial.component_id, name: initial.name, sourcePath: source }],
    });
    const handle = saved.completeExtractionWithSourceEvidence(db, {
      sessionId,
      stepId,
      components: result.components,
      capture,
      cycles: [],
      scannedFiles: [source],
      observations: { accepted: [], rejected: [] },
      extractionDiagnostics: result.extractionDiagnostics,
    });
    db.close();
    rmSync(source);
    rmSync(support, { force: true });
    rmSync(join(root, 'tsconfig.json'));
    db = saved.openPipelineDb(dbPath);
    try {
      const raw = saved.loadRawComponents(db, sessionId)[0]!,
        envelope = saved.loadCompletedSourceEvidence(db, sessionId, handle),
        diagnostics = saved.loadExtractionSourceDiagnostics(db, sessionId);
      expect(envelope.readiness).toBe('ready');
      if (envelope.readiness !== 'ready' || diagnostics.status !== 'available')
        throw new Error('Unavailable completed evidence');
      const ownRead = diagnostics.diagnostics.reads!.find((read) => read.path === source && read.kind === 'compiler');
      const imported = diagnostics.diagnostics.reads!.find((read) => read.path === support && read.kind === 'compiler');
      expect(ownRead?.binding).toBe('verified');
      if (variant === 'deleted') expect(imported?.binding).not.toBe('verified');
      else expect(imported?.binding).toBe(variant === 'stable' ? 'verified' : 'changed');
      expect(raw.sourceCandidates?.find((candidate) => candidate.name === 'label')?.facts?.sourceTypeText).toBe(
        'string',
      );
      const sourceInput = buildExplorationSourceInput(envelope.envelope, 160 * 1024, diagnostics);
      const selectionPrompts: string[] = [];
      const selection = await runExploreStage({
        agent: 'codex',
        outDir: '',
        timeoutMs: 1000,
        backoffMs: 0,
        maxAttempts: 1,
        scopes: ['components-1'],
        rawComponentsInline: JSON.stringify([raw]),
        requestedComponents: [{ name: raw.name, source: raw.source, componentId: raw.component_id }],
        sourceInput,
        rendererReferenceInline: 'Use declared source.',
        skillContentOverride: 'Inspect immutable source.',
        invoker: {
          invoke: async ({ prompt }) => {
            selectionPrompts.push(prompt);
            return {
              stdout: JSON.stringify({
                agentRole: 'components-1',
                components: [
                  {
                    name: raw.name,
                    source: raw.source,
                    componentId: raw.component_id,
                    included: false,
                    props: [],
                    slots: [],
                  },
                ],
              }),
              stderr: '',
              exitCode: 0,
              timedOut: false,
            };
          },
        },
      });
      expect(selection.ok).toBe(true);
      expect(selectionPrompts[0]).toContain(imported!.textHash!);
      const compilerEvidenceInline = buildCompilerEvidenceInline([raw], {
        readiness: 'ready',
        diagnostics: diagnostics.diagnostics,
        diagnosticsStatus: 'available',
      });
      const generationPrompts: string[] = [];
      const generated = await runOneGenerateComponent(
        {
          db,
          sessionId,
          invoker: {
            checkAuth: async () => 'ok',
            invoke: async ({ prompt }) => {
              generationPrompts.push(prompt);
              return {
                stdout: JSON.stringify({
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
          agent: 'codex',
          model: undefined,
          tokensInline: undefined,
          tokenMapInline: undefined,
          verbose: false,
          noCache: true,
          skillPathOverride: undefined,
          skillContentOverride: 'Classify supplied source.',
          promptHash: 'observed-read-probe',
          existingContentfulEntities: undefined,
          existingTokensInline: undefined,
          compilerEvidenceInline,
          precomputedCachedNames: new Set(),
          allowedComponentNames: new Set(['Example']),
          onProgress: undefined,
        },
        raw,
        0,
        1,
      );
      expect(generated.failed).toBe(false);
      expect(generationPrompts[0]).toContain(compilerEvidenceInline);
      expect(generationPrompts[0]).toContain('props.label');
      expect(saved.loadComponentReviewMetadata(db, sessionId, 'Example')?.extractionDiagnostics).toEqual(diagnostics);
      expect(saved.loadComponentReviewMetadata(db, sessionId, 'Example')?.sourceCandidates).toEqual(
        raw.sourceCandidates,
      );
      expect(saved.loadExtractionSourceDiagnostics(db, sessionId)).toEqual(diagnostics);
    } finally {
      db.close();
    }
  },
);

for (const [owner, extract] of producers)
  it(`${owner} reports invalid mode diagnostics without emitting`, async () => {
    const root = fixture({
      'tsconfig.json':
        '{"compilerOptions":{"module":"ESNext","moduleResolution":"NodeNext","noEmit":false,"outDir":"./out"}}',
      'Example.tsx': 'export const Example = () => <section/>;',
    });
    const before = readdirSync(root, { recursive: true }).map(String).sort();
    const result = await extract([join(root, 'Example.tsx')], root);
    expect(result.extractionDiagnostics?.projects[0]?.status).toBe('invalid');
    expect(result.extractionDiagnostics?.projects[0]?.diagnostics.join(' ')).toContain('NodeNext');
    expect(readdirSync(root, { recursive: true }).map(String).sort()).toEqual(before);
  });

for (const [owner, extract] of producers) {
  it(`${owner} records actual oversized imported compiler reads as uncertainty`, async () => {
    const root = fixture({
      'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler"}}',
      'Props.d.ts': 'export interface Props { label: string }' + ' '.repeat(4 * 1024 * 1024),
      'Example.tsx':
        'import type { Props } from "./Props"; export function Example(props: Props) { return <section>{props.label}</section>; }',
    });
    const result = await extract([join(root, 'Example.tsx')], root);
    expect(result.extractionDiagnostics?.coverage).toBe('partial');
    expect(result.extractionDiagnostics?.reads).toContainEqual(
      expect.objectContaining({
        path: join(root, 'Props.d.ts'),
        outcome: 'unavailable',
        reason: 'compiler-byte-budget-exhausted',
        textHash: null,
      }),
    );
    expect(result.extractionDiagnostics?.used.compilerBudgetFailures).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  it(`${owner} retains config byte-budget uncertainty in saved root receipts`, async () => {
    const root = fixture({ 'tsconfig.json': ' '.repeat(256 * 1024 + 1), 'plain.tsx': 'export const value = 1;' });
    const result = await extract([join(root, 'plain.tsx')], root);
    expect(result.components).toEqual([]);
    expect(result.extractionDiagnostics?.projects[0]?.diagnostics.join(' ')).toContain('config-byte-budget-exhausted');
    expect(result.extractionDiagnostics?.used.configBytes).toBe(0);
    expect(JSON.parse(JSON.stringify(result.extractionDiagnostics))).toEqual(result.extractionDiagnostics);
    const dbPath = join(root, 'receipts.db'),
      db = saved.openPipelineDb(dbPath);
    const { sessionId } = saved.getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    saved.storeRawComponents(db, sessionId, [], { extractionDiagnostics: result.extractionDiagnostics });
    db.close();
    const reopened = saved.openPipelineDb(dbPath);
    try {
      expect(saved.loadExtractionSourceDiagnostics(reopened, sessionId)).toEqual({
        status: 'available',
        diagnostics: result.extractionDiagnostics,
      });
    } finally {
      reopened.close();
    }
  });
  it(`${owner} records unavailable Vue source at the actual producer`, async () => {
    const root = fixture({ 'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler"}}' });
    const result = await extract([join(root, 'missing.vue')], root);
    expect(result.components).toEqual([]);
    expect(result.extractionDiagnostics?.projects[0]?.configPath).toBe(join(root, 'tsconfig.json'));
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ outcome: 'unavailable', reason: 'vue-sfc-read-failed' }),
    );
    expect(result.extractionDiagnostics?.reads).toContainEqual(
      expect.objectContaining({ path: join(root, 'missing.vue'), kind: 'framework', outcome: 'unavailable' }),
    );
  });
}

it('records cancelled backend roots and plain saved diagnostics with zero output', async () => {
  const root = fixture({ 'plain.tsx': 'export const value = 1;' }),
    controller = new AbortController();
  controller.abort();
  const result = await extractComponents({
    filePaths: [join(root, 'plain.tsx')],
    projectRoot: root,
    opts: { signal: controller.signal },
  });
  expect(result.components).toEqual([]);
  expect(result.extractionDiagnostics?.projects[0]?.diagnostics).toContain('compiler-analysis-aborted');
  const dbPath = join(root, 'receipts.db'),
    db = saved.openPipelineDb(dbPath);
  const { sessionId } = saved.getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  saved.storeRawComponents(db, sessionId, [], { extractionDiagnostics: result.extractionDiagnostics });
  db.close();
  const reopened = saved.openPipelineDb(dbPath);
  try {
    expect(saved.loadExtractionSourceDiagnostics(reopened, sessionId)).toEqual({
      status: 'available',
      diagnostics: result.extractionDiagnostics,
    });
  } finally {
    reopened.close();
  }
});
