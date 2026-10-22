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
    'preserves full source after filtering candidate observations for %s',
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
      original.capture.bounds.limits.maxPromptBytes = 1;
      const sourceInput = buildExplorationSourceInput(original);
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
      expect(delivered?.files).toEqual(sourceInput.files);
      expect(delivered).not.toHaveProperty('projectionBounds');
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

  it('retains full serialized source despite historical projection limits', () => {
    const source = buildSharedSource(envelope());
    source.files[0]!.content = 'é'.repeat(300_000);
    source.projectionBounds = { maxBytes: 1, usedBytes: 1 };
    const snapshot = JSON.stringify(source);
    const projected = projectSharedSource(source);
    expect(projected.files).toEqual(source.files);
    expect(projected.components).toEqual(source.components);
    expect(projected).not.toHaveProperty('projectionBounds');
    expect(projected.omittedFiles).toBe(0);
    const sections = buildInputSections({
      skill: 'components',
      mode: 'autonomous',
      outDir: '/example',
      sharedSource: source,
    });
    expect(sections.join('\n')).toContain(source.files[0]!.content);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('uses the same canonical ranges and roles for actual assurance input without duplicating text', () => {
    const projected = buildExplorationSourceInput(envelope());
    expect(projected.files[1]!.ranges[0]!.startLine).toBe(40);
    expect(projected.files[0]!.componentRefs).toHaveLength(2);
    expect(projected.components).toHaveLength(2);
    expect(projected).not.toHaveProperty('projectionBounds');
  });
  it('retains all excerpt lines without mutating the saved envelope', () => {
    const original = envelope();
    original.capture.files[1]!.captured = {
      kind: 'excerpts',
      ranges: [
        { startLine: 40, endLine: 41, text: 'export const Panel = () => "😀";\n' + 'é'.repeat(4000) },
        { startLine: 90, endLine: 90, text: 'export const Text = () => "é";' },
      ],
    };
    const snapshot = JSON.stringify(original);
    const projected = projectSharedSource(buildSharedSource(original, ['panel']));
    expect(renderSharedSource(projected)).toContain('é'.repeat(4000));
    const file = projected.files.find((file) => file.path === 'panel.tsx');
    expect(file?.ranges).toEqual([
      { startLine: 40, endLine: 41, displayStartLine: 1 },
      { startLine: 90, endLine: 90, displayStartLine: 5 },
    ]);
    expect(file?.partial).toBe(true);
    expect(projected.components[0]?.refs.find((ref) => ref.role === 'definition')?.partial).toBe(true);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(buildExplorationSourceInput(original).files[1]?.ranges).toEqual(original.capture.files[1]!.captured.ranges);
  });
});

it('retains saved config provenance and full compiler contexts', () => {
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
  const projected = projectSharedSource(oversized);
  expect(projected.compilerContexts).toEqual(oversized.compilerContexts);
  expect(projected.omittedCompilerContexts ?? 0).toBe(0);
  expect(projected.promptCoverage).toBe('partial');
  expect(renderSharedSource(projected)).toContain('x'.repeat(10000));
  expect(source.compilerContexts).toEqual(original.capture.compilerContexts);
});

it('retains all selection evidence despite historical prompt limits', () => {
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
  original.observations.accepted = Array.from({ length: 70 }, (_, index) => ({ index }));
  original.observations.rejected = Array.from({ length: 70 }, (_, index) => ({ index }));
  original.capture.diagnostics = Array.from({ length: 70 }, () => ({ kind: 'read', reason: 'Example diagnostic.' }));
  original.capture.resolution = Array.from({ length: 70 }, () => ({
    fromFileId: 'caller',
    specifier: 'example',
    outcome: 'unresolved',
  }));
  original.capture.bounds.limits.maxPromptBytes = 1000;
  const projected = buildSelectionEvidenceInline(original);
  expect(renderSelectionEvidenceInline(projected)).toContain('é'.repeat(10000));
  expect(JSON.parse(projected)).toMatchObject({ promptCoverage: 'partial', compilerContextsOmitted: 0 });
  expect(JSON.parse(projected).observations.accepted).toEqual(original.observations.accepted);
  expect(JSON.parse(projected).observations.rejected).toEqual(original.observations.rejected);
  expect(JSON.parse(projected).resolution).toEqual(original.capture.resolution);
  expect(JSON.parse(projected).diagnostics).toEqual(original.capture.diagnostics);
  expect(original.capture.compilerContexts[0]!.compilerOptions.paths).toEqual({ example: ['é'.repeat(10000)] });
  original.capture.bounds.limits.maxPromptBytes = 1;
  expect(buildSelectionEvidenceInline(original)).toBe(projected);
});
