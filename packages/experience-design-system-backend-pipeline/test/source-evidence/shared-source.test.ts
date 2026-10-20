import { describe, expect, it } from 'vitest';
import type { SessionSourceEnvelope } from '../../src/persistence/src/session/repositories/db.js';
import { buildSharedSource, projectSharedSource, renderSharedSource } from '../../src/source-evidence/shared-source.js';
import {
  buildSelectionEvidenceInline,
  renderSelectionEvidenceInline,
} from '../../src/agents/prompts/helpers/build-selection-evidence-inline.js';
import { buildExplorationSourceInput } from '../../src/orchestrators/run-exploration-session/helpers/build-source-input.js';
import { buildInputSections } from '../../src/agents/prompts/helpers/build-input-sections.js';
import { runExploreStage } from '../../src/steps/exploration/src/services/run-explore-stage.js';
import type { ExplorationSourceInput } from '@contentful/experience-design-system-types';

function envelope(): SessionSourceEnvelope {
  return {
    schemaVersion: 1,
    envelopeId: 'envelope-a',
    digest: 'envelope-digest',
    sessionId: 'session-a',
    extractionStepId: 1,
    revision: 'source-evidence-v1',
    readiness: 'ready',
    extractionByteBinding: 'unverified',
    capture: {
      schemaVersion: 1,
      captureId: 'capture-a',
      digest: 'capture-digest',
      projectRoot: '/example',
      coverage: 'partial',
      extractionByteBinding: 'unverified',
      diagnostics: [],
      resolution: [],
      bounds: {
        limits: {
          maxFiles: 10,
          maxFileBytes: 10000,
          maxTotalBytes: 10000,
          maxImportDepth: 4,
          maxReadAttempts: 20,
          maxResolverProbes: 50,
          maxCaptureMs: 1000,
          maxPromptBytes: 10000,
        },
        used: {},
      },
      files: [
        {
          fileId: 'caller',
          canonicalPath: '/example/app.tsx',
          displayPath: 'app.tsx',
          textHash: 'caller-hash',
          captured: { kind: 'full', text: 'const App = () => <Panel renderBody={() => <Text />} />;' },
          roles: ['application', 'reference'],
          componentRefs: [
            { componentId: 'panel', name: 'Panel', roles: ['application', 'reference'] },
            { componentId: 'text', name: 'Text', roles: ['application', 'reference'] },
          ],
        },
        {
          fileId: 'definition',
          canonicalPath: '/example/panel.tsx',
          displayPath: 'panel.tsx',
          textHash: 'definition-hash',
          captured: {
            kind: 'excerpts',
            ranges: [
              { startLine: 40, endLine: 40, text: 'export const Panel = () => "😀";' },
              { startLine: 90, endLine: 90, text: 'export const Text = () => "é";' },
            ],
          },
          roles: ['definition'],
          componentRefs: [
            { componentId: 'panel', name: 'Panel', roles: ['definition'] },
            { componentId: 'text', name: 'Text', roles: ['definition'] },
          ],
        },
      ],
    },
    observations: { accepted: [], rejected: [] },
  };
}

describe('shared saved source projections', () => {
  it.each(['components-6', 'components-7'] as const)(
    'preserves exact source byte receipts and limits after filtering candidate observations for %s',
    async (scope) => {
      const original = envelope();
      original.observations.callerCoverage = {
        scope: 'admitted-source',
        analysis: 'lexical-jsx-in-known-component-bodies',
        coverage: 'partial',
        files: [],
        unresolvedReferences: 0,
        unownedReferences: 0,
        components: [],
      };
      const full = buildExplorationSourceInput(original, 10000);
      const limit = full.projectionBounds!.usedBytes;
      const sourceInput = buildExplorationSourceInput(original, limit);
      const snapshot = JSON.stringify(sourceInput);
      let delivered: ExplorationSourceInput | undefined;
      const result = await runExploreStage({
        scopes: [scope],
        rawComponentsInline: '[]',
        sourceInput,
        agent: 'codex',
        outDir: '/example',
        timeoutMs: 1000,
        skillContentOverride: 'Inspect supplied source.',
        invoker: {
          invoke: async ({ prompt }) => {
            delivered = JSON.parse(prompt.split('\nInput data:\n')[1]!.split('\n')[0]!).sourceInput;
            return {
              stdout: JSON.stringify({ agentRole: scope, components: [] }),
              stderr: '',
              exitCode: 0,
              timedOut: false,
            };
          },
        },
      });
      expect(result.ok).toBe(true);
      const bytes = Buffer.byteLength(JSON.stringify(delivered), 'utf8');
      expect(bytes).toBeLessThanOrEqual(limit);
      expect(delivered?.projectionBounds).toEqual({ maxBytes: limit, usedBytes: bytes });
      expect(delivered?.observations).not.toHaveProperty('callerCoverage');
      expect(delivered?.omittedObservations).toBe(1);
      expect(JSON.stringify(sourceInput)).toBe(snapshot);
    },
  );

  it('deduplicates incoming files for multiple owners and retains each role and original range', () => {
    const source = buildSharedSource(envelope());
    expect(source.files).toHaveLength(2);
    expect(source.components.find((component) => component.component === 'Panel')).toMatchObject({
      source: 'panel.tsx',
    });
    expect(
      source.components
        .find((component) => component.component === 'Panel')!
        .refs.filter((ref) => ref.path === 'app.tsx')
        .map((ref) => ref.role),
    ).toEqual(['application', 'reference']);
    expect(source.files.find((file) => file.path === 'panel.tsx')!.ranges).toEqual(
      envelope().capture.files[1]!.captured.kind === 'excerpts'
        ? [
            { startLine: 40, endLine: 40, displayStartLine: 1 },
            { startLine: 90, endLine: 90, displayStartLine: 4 },
          ]
        : [],
    );
    const sections = buildInputSections({
      skill: 'components',
      mode: 'autonomous',
      outDir: '/example',
      sharedSource: source,
    });
    expect(sections.join('\n').match(/const App =/g)).toHaveLength(1);
    expect(sections.join('\n')).toContain('lexical');
  });

  it('bounds serialized UTF-8 metadata and rendered source including headers', () => {
    const source = buildSharedSource(envelope());
    const limit = Buffer.byteLength(renderSharedSource(source), 'utf8') - 20;
    const projected = projectSharedSource(source, limit);
    expect(Buffer.byteLength(renderSharedSource(projected), 'utf8')).toBeLessThanOrEqual(limit);
    expect(projected.projectionBounds).toEqual({
      maxBytes: limit,
      usedBytes: Buffer.byteLength(renderSharedSource(projected), 'utf8'),
    });
    expect(projectSharedSource(projected, limit + 1000).projectionBounds?.maxBytes).toBe(limit);
    expect(projected.promptCoverage).toBe('partial');
    expect((projected.omittedFiles ?? 0) + (projected.omittedRanges ?? 0)).toBeGreaterThan(0);
    expect(() => projectSharedSource(source, 1)).toThrow(/metadata.*bound/i);
  });

  it('uses the same canonical ranges and roles for actual assurance input without duplicating text', () => {
    const projected = buildExplorationSourceInput(envelope(), 10000);
    expect(projected.files[1]!.ranges[0]!.startLine).toBe(40);
    expect(projected.files[0]!.componentRefs).toHaveLength(2);
    expect(projected.components).toHaveLength(2);
    expect(Buffer.byteLength(JSON.stringify(projected), 'utf8')).toBeLessThanOrEqual(10000);
    expect(projected.projectionBounds?.usedBytes).toBe(Buffer.byteLength(JSON.stringify(projected), 'utf8'));
  });
  it('keeps original excerpt lines when only a prefix fits and does not mutate the saved envelope', () => {
    const original = envelope();
    original.capture.files[1]!.captured = {
      kind: 'excerpts',
      ranges: [
        { startLine: 40, endLine: 41, text: 'export const Panel = () => "😀";\n' + 'é'.repeat(4000) },
        { startLine: 90, endLine: 90, text: 'export const Text = () => "é";' },
      ],
    };
    const snapshot = JSON.stringify(original);
    const projected = projectSharedSource(buildSharedSource(original, ['panel']), 2000);
    expect(Buffer.byteLength(renderSharedSource(projected), 'utf8')).toBeLessThanOrEqual(2000);
    const file = projected.files.find((file) => file.path === 'panel.tsx');
    expect(file?.ranges).toEqual([{ startLine: 40, endLine: 40, displayStartLine: 1 }]);
    expect(file?.partial).toBe(true);
    expect(projected.components[0]?.refs.find((ref) => ref.role === 'definition')?.partial).toBe(true);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(() => buildExplorationSourceInput(original, 1)).toThrow(/metadata.*bound/i);
  });
});

it('selects saved config provenance with its owners and counts context omission inside the prompt bound', () => {
  const original = envelope();
  original.capture.files[0]!.compilerContextId = 'context-a';
  original.capture.files[1]!.compilerContextId = 'context-a';
  original.capture.files.push({
    fileId: 'config',
    canonicalPath: '/example/tsconfig.json',
    displayPath: 'tsconfig.json',
    textHash: 'config-hash',
    captured: { kind: 'full', text: '{"compilerOptions":{"strict":true}}' },
    roles: ['config'],
    componentRefs: [],
  });
  original.capture.compilerContexts = [
    {
      contextId: 'context-a',
      configPath: '/example/tsconfig.json',
      status: 'configured',
      referenceOutcome: 'selected',
      compilerOptions: { noEmit: true, strict: true },
      configFiles: [{ fileId: 'config', textHash: 'config-hash' }],
      diagnostics: [],
    },
  ];
  const source = buildSharedSource(original, ['panel']);
  expect(source.files).toHaveLength(3);
  expect(source.files.filter((file) => file.roles?.includes('config'))).toHaveLength(1);
  expect(source.compilerContexts).toEqual(original.capture.compilerContexts);
  const oversized = structuredClone(source);
  oversized.compilerContexts![0]!.compilerOptions.paths = { example: ['x'.repeat(10000)] };
  const projected = projectSharedSource(oversized, 1000);
  expect(projected.omittedCompilerContexts).toBe(1);
  expect(projected.promptCoverage).toBe('partial');
  expect(Buffer.byteLength(renderSharedSource(projected), 'utf8')).toBeLessThanOrEqual(1000);
  expect(source.compilerContexts).toEqual(original.capture.compilerContexts);
});

it('bounds configured selection metadata including its rendered header and makes omitted contexts explicit', () => {
  const original = envelope();
  original.capture.compilerContexts = [
    {
      contextId: 'large-context',
      configPath: '/example/tsconfig.json',
      status: 'configured',
      referenceOutcome: 'selected',
      compilerOptions: { noEmit: true, paths: { example: ['é'.repeat(10000)] } },
      configFiles: [],
      diagnostics: [],
    },
  ];
  original.capture.bounds.limits.maxPromptBytes = 1000;
  const projected = buildSelectionEvidenceInline(original);
  expect(Buffer.byteLength(renderSelectionEvidenceInline(projected), 'utf8')).toBeLessThanOrEqual(1000);
  expect(JSON.parse(projected)).toMatchObject({ promptCoverage: 'partial', compilerContextsOmitted: 1 });
  expect(original.capture.compilerContexts[0]!.compilerOptions.paths).toEqual({ example: ['é'.repeat(10000)] });
  original.capture.bounds.limits.maxPromptBytes = 1;
  expect(() => buildSelectionEvidenceInline(original)).toThrow(/metadata.*bound/i);
});
