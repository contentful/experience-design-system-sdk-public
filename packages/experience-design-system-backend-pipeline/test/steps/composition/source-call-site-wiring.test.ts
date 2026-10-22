import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  composeComponents,
  runExtractAndComposeSession,
  buildExplorationSourceInput,
  runExploreStage,
} from '../../../src/index.js';
import { runAgent } from '../../../src/agents/services/run-agent.js';
import {
  openPipelineDb,
  loadRawComponents,
  loadCompletedSourceEvidence,
  loadSavedComponentSourceRef,
  loadComponentReviewMetadata,
} from '../../../src/persistence/src/session/repositories/db.js';
import { resolveComposition } from '../../../src/orchestrators/run-extract-and-compose-session/helpers/resolve-composition.js';
import type { RawComponentDefinition } from '../../../src/steps/extraction/src/types/component.js';
import { captureSourceEvidence, extractReactComponents } from '../../../src/steps/extraction/index.js';
import { deriveComponentId } from '../../../src/persistence/src/session/helpers/components/derive-component-id.js';

vi.mock('../../../src/agents/services/run-agent.js', () => ({ runAgent: vi.fn() }));

const definitions = [
  {
    name: 'Button',
    content: 'export function Button({ label }: { label: string }) { return <button>{label}</button>; }',
  },
  {
    name: 'Card',
    content: [
      "import { Button as Action } from './Button';",
      'export function Card({ title }: { title: string }) {',
      '  const dormant = () => <Action label="Continue" />;',
      '  return <div>{title}<Ghost /></div>;',
      '}',
    ].join('\n'),
  },
];

describe('source call-site production wiring', () => {
  let projectPath: string;
  let files: Array<{ path: string; content: string }>;
  let components: RawComponentDefinition[];

  beforeEach(async () => {
    projectPath = await realpath(await mkdtemp(join(tmpdir(), 'source-observations-')));
    vi.stubEnv('EDS_PIPELINE_DB_PATH', join(projectPath, 'pipeline.db'));
    vi.stubEnv('DISABLE_ANALYTICS', '1');
    files = definitions.map(({ name, content }) => ({ path: join(projectPath, `${name}.tsx`), content }));
    await Promise.all(files.map(({ path, content }) => writeFile(path, content)));
    components = (
      await extractReactComponents(
        files.map(({ path }) => path),
        undefined,
        { projectRoot: projectPath },
      )
    ).components;
    vi.mocked(runAgent).mockReset().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(projectPath, { recursive: true, force: true });
  });

  it.each([false, true])(
    'delivers richer caller facts through both producers and cold saved reasoning (override=%s)',
    async (override) => {
      const composed = await composeComponents({
        components,
        allFiles: files,
        forceAgent: true,
        ...(override ? { promptOverride: 'OVERRIDE_CALLER_CONTEXT' } : {}),
      });
      expect(composed.sourceCallSiteEvidence[0]!.inputs).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'label', state: 'text', value: 'Continue' })]),
      );
      expect(composed.sourceCallSiteCoverage).toMatchObject({ scope: 'admitted-source', coverage: 'partial' });
      expect(runAgent).not.toHaveBeenCalled();
      const response = await runExtractAndComposeSession({
        projectPath,
        outDir: join(projectPath, 'caller-output'),
        filePaths: files.map((f) => f.path),
        agent: 'claude',
        promptOverrides: override ? ['composition=OVERRIDE_CALLER_CONTEXT'] : [],
        noCache: true,
      });
      expect(response.sourceCallSiteEvidence[0]!.inputs).toEqual(composed.sourceCallSiteEvidence[0]!.inputs);
      expect(response.sourceCallSiteCoverage).toMatchObject({
        analysis: 'configured-lexical-references',
        coverage: 'partial',
      });
      expect(response.sourceCallSiteEvidence[0]!.parentDeclarationId).not.toBe(
        response.components.find(({ name }) => name === 'Card')!.componentFacts!.sourceObservations!
          .componentDeclarationId,
      );
      expect(response.sourceCallSiteEvidence[0]!.lexicalAncestors).toHaveLength(2);
      expect(runAgent).not.toHaveBeenCalled();
      await Promise.all(files.map((f) => writeFile(f.path, 'DISK_CHANGED_AFTER_SAVE')));
      const db = openPipelineDb();
      try {
        const saved = loadCompletedSourceEvidence(db, response.sessionId, response.sourceEvidenceHandle);
        expect(saved.readiness).toBe('ready');
        if (saved.readiness !== 'ready') throw new Error('Completed source missing');
        const input = buildExplorationSourceInput(saved.envelope);
        expect(input.observations.accepted).toEqual(response.sourceCallSiteEvidence);
        expect(input.observations.callerCoverage).toEqual(response.sourceCallSiteCoverage);
        const before = JSON.stringify(input);
        const result = await runExploreStage({
          scopes: ['components-1'],
          rawComponentsInline: JSON.stringify(response.components),
          sourceInput: input,
          agent: 'codex',
          outDir: projectPath,
          timeoutMs: 1000,
          maxAttempts: 1,
          skillContentOverride: 'Use supplied caller evidence.',
          invoker: {
            invoke: async ({ prompt }) => {
              const data = JSON.parse(prompt.split('\nInput data:\n')[1]!.split('\n')[0]!);
              expect(data.sourceInput.observations).toEqual(input.observations);
              expect(prompt).not.toContain('DISK_CHANGED_AFTER_SAVE');
              const assignment = JSON.parse(prompt.split('\nAssignment:\n')[1]!.split('\n')[0]!);
              return {
                stdout: JSON.stringify({
                  agentRole: assignment.scope,
                  components: assignment.requestedComponents.map((c: object) => ({ ...c, included: false })),
                }),
                stderr: '',
                exitCode: 0,
                timedOut: false,
              };
            },
          },
        });
        expect(result.ok).toBe(true);
        expect(JSON.stringify(input)).toBe(before);
      } finally {
        db.close();
      }
    },
  );

  it('collects from the full supplied source set without invoking an agent for an override prompt', async () => {
    const result = await composeComponents({ components, allFiles: files, forceAgent: true, promptOverride: 'custom' });
    expect(result).toMatchObject({
      sourceCallSiteEvidence: [
        { parent: 'Card', child: 'Button', startLine: 3, endLine: 3, execution: 'lexical-reference' },
      ],
      sourceCallSiteRejections: [{ parent: 'Card', candidate: 'Ghost', reason: 'unknown-component' }],
    });
    expect(runAgent).not.toHaveBeenCalled();
    expect(result.components.every(({ slots }) => slots.length === 0)).toBe(true);
  });

  it('retains observations when typed slots already resolve composition and no agent runs', async () => {
    components[1].slots = [{ name: 'children', isDefault: true, allowedComponents: ['Button'] }];
    components[0].slots = [{ name: 'children', isDefault: true, allowedComponents: ['Card'] }];
    const result = await composeComponents({ components, allFiles: files });
    expect(result.sourceCallSiteEvidence).toHaveLength(1);
    expect(result.sourceCallSiteRejections).toHaveLength(1);
    expect(runAgent).not.toHaveBeenCalled();
    expect(result.components).toEqual(components);
  });

  it('does not promote partial lexical observations or legacy agent output into slot edges', async () => {
    vi.mocked(runAgent).mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ tool: 'map_edge', parent: 'Button', child: 'Card' }),
      stderr: '',
      timedOut: false,
    });
    const result = await composeComponents({ components, allFiles: files, forceAgent: true });
    expect(result.sourceCallSiteEvidence).toEqual([expect.objectContaining({ parent: 'Card', child: 'Button' })]);
    expect(result.components.every(({ slots }) => slots.length === 0)).toBe(true);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('saves both evidence arrays on the completed extraction step and returns the same fresh results', async () => {
    const response = await runExtractAndComposeSession({
      projectPath,
      outDir: join(projectPath, 'output'),
      filePaths: files.map(({ path }) => path),
      agent: 'claude',
      promptOverrides: [],
      noCache: true,
      onProgress: (event) => {
        if (event.kind !== 'composition' || event.phase !== 'resolving') return;
        const db = openPipelineDb();
        try {
          db.prepare(
            "UPDATE raw_components SET status = 'rejected', reject_reason = 'review decision' WHERE name = 'Card'",
          ).run();
        } finally {
          db.close();
        }
      },
    });
    const db = openPipelineDb();
    try {
      const step = db.prepare('SELECT status, outputs FROM steps WHERE session_id = ?').get(response.sessionId) as {
        status: string;
        outputs: string;
      };
      expect(step.status).toBe('complete');
      const outputs = JSON.parse(step.outputs);
      expect(outputs.sessionId).toBe(response.sessionId);
      expect(JSON.parse(outputs.compositionEvidence)).toEqual(response.sourceCallSiteEvidence);
      expect(JSON.parse(outputs.compositionRejections)).toEqual(response.sourceCallSiteRejections);
      expect(response.sourceCallSiteEvidence).toEqual([
        expect.objectContaining({ parent: 'Card', child: 'Button', execution: 'lexical-reference' }),
      ]);
      expect(response.sourceCallSiteRejections).toEqual([
        expect.objectContaining({ parent: 'Card', candidate: 'Ghost', reason: 'unknown-component' }),
      ]);
      expect(
        loadRawComponents(db, response.sessionId)
          .map(({ name }) => name)
          .sort(),
      ).toEqual(['Button', 'Card']);
      expect(
        db
          .prepare('SELECT status, reject_reason FROM raw_components WHERE session_id = ? AND name = ?')
          .get(response.sessionId, 'Card'),
      ).toEqual({
        status: 'rejected',
        reject_reason: 'review decision',
      });
      expect(runAgent).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it.each([true, false])(
    'retains fresh lexical observations through a directory alias, reference=%s',
    async (hasReference) => {
      const aliasPath = join(projectPath, 'linked-project');
      await symlink(projectPath, aliasPath, 'dir');
      if (!hasReference) {
        await writeFile(
          files[1].path,
          'export function Card({ title }: { title: string }) { return <div>{title}</div>; }',
        );
      }
      const response = await runExtractAndComposeSession({
        projectPath: aliasPath,
        outDir: join(projectPath, 'alias-output'),
        filePaths: files.map(({ path }) => join(aliasPath, basename(path))),
        agent: 'claude',
        promptOverrides: [],
        noCache: true,
      });
      expect(response.sourceCallSiteEvidence).toEqual(
        hasReference
          ? [expect.objectContaining({ parent: 'Card', child: 'Button', execution: 'lexical-reference' })]
          : [],
      );
      expect(response.components.find(({ name }) => name === 'Card')?.sourcePath).toBe(join(aliasPath, 'Card.tsx'));
      const db = openPipelineDb();
      try {
        const step = db.prepare('SELECT status, outputs FROM steps WHERE session_id = ?').get(response.sessionId) as {
          status: string;
          outputs: string;
        };
        expect(step.status).toBe('complete');
        expect(JSON.parse(JSON.parse(step.outputs).compositionEvidence)).toEqual(response.sourceCallSiteEvidence);
      } finally {
        db.close();
      }
    },
  );

  it('does not invent an index for an aliased component from captured names without matching identity', async () => {
    const aliasPath = join(projectPath, 'linked-project');
    await symlink(projectPath, aliasPath, 'dir');
    const aliasedComponents = components.map((component) => ({
      ...component,
      componentFacts: undefined,
      source: join(aliasPath, `${component.name}.tsx`),
      sourcePath: join(aliasPath, `${component.name}.tsx`),
    }));
    const capture = await captureSourceEvidence({
      projectRoot: aliasPath,
      filePaths: aliasedComponents.map(({ sourcePath }) => sourcePath),
      components: aliasedComponents.map((component) => ({
        componentId:
          component.name === 'Card' ? 'unrelated-identity' : deriveComponentId(component.name, component.source),
        name: component.name,
        sourcePath: component.sourcePath,
      })),
    });
    const db = openPipelineDb();
    try {
      const result = await resolveComposition({
        components: aliasedComponents,
        sourceFiles: aliasedComponents.map(({ sourcePath }) => sourcePath),
        sourceCapture: capture,
      });
      expect(result.sourceCallSiteEvidence).toEqual([]);
      expect(result.sourceCallSiteRejections).toEqual([]);
      expect(result.components).toEqual(aliasedComponents);
    } finally {
      db.close();
    }
  });

  it('binds actual source-only extraction to saved generation and review bytes through a directory alias', async () => {
    const aliasPath = join(projectPath, 'linked-project');
    await symlink(projectPath, aliasPath, 'dir');
    const sourcePath = join(aliasPath, 'Panel.svelte');
    await writeFile(
      sourcePath,
      [
        '<script lang="ts">',
        'let { title }: { title: string } = $props();',
        '</script>',
        '<h2>{title}SOURCE_ONLY_A</h2>',
      ].join('\n'),
    );
    const response = await runExtractAndComposeSession({
      projectPath: aliasPath,
      outDir: join(projectPath, 'source-only-output'),
      filePaths: [sourcePath],
      agent: 'claude',
      promptOverrides: [],
      noCache: true,
    });
    expect(response.components).toEqual([
      expect.objectContaining({ name: 'Panel', source: sourcePath, framework: 'svelte' }),
    ]);
    expect(response.components[0]!.sourcePath).toBeUndefined();
    const db = openPipelineDb();
    const stored = loadRawComponents(db, response.sessionId)[0]!;
    try {
      const saved = loadCompletedSourceEvidence(db, response.sessionId, response.sourceEvidenceHandle);
      expect(saved.readiness).toBe('ready');
      if (saved.readiness !== 'ready') throw new Error('Expected complete source evidence');
      expect(
        loadSavedComponentSourceRef(db, response.sessionId, stored.component_id, 'Panel', stored.source).content,
      ).toEqual(expect.stringContaining('SOURCE_ONLY_A'));
      const bound = saved.envelope.capture.files.find((file) =>
        file.componentRefs.some((ref) => ref.componentId === stored.component_id && ref.name === 'Panel'),
      );
      expect(bound?.captured).toMatchObject({ kind: 'full', text: expect.stringContaining('SOURCE_ONLY_A') });
    } finally {
      db.close();
    }
    await writeFile(sourcePath, '<h2>SOURCE_ONLY_B</h2>');
    await rm(sourcePath);
    const reopened = openPipelineDb();
    try {
      const ref = loadSavedComponentSourceRef(
        reopened,
        response.sessionId,
        stored.component_id,
        'Panel',
        stored.source,
      );
      expect(ref.content).toContain('SOURCE_ONLY_A');
      expect(ref.content).not.toContain('SOURCE_ONLY_B');
      expect(ref.sourceEvidence?.extractionByteBinding).toBe('unverified');
      const review = loadComponentReviewMetadata(reopened, response.sessionId, 'Panel');
      expect(review?.componentSource).toContain('SOURCE_ONLY_A');
      expect(review?.componentSource).not.toContain('SOURCE_ONLY_B');
      expect(review?.extractionByteBinding).toBe('unverified');
      expect(loadRawComponents(reopened, response.sessionId)[0]?.source).toBe(sourcePath);
    } finally {
      reopened.close();
    }
  });

  it('saves explicit empty arrays on a fresh extraction without any JSX references', async () => {
    await writeFile(files[1].path, 'export function Card({ title }: { title: string }) { return <div>{title}</div>; }');
    const response = await runExtractAndComposeSession({
      projectPath,
      outDir: join(projectPath, 'output'),
      filePaths: [files[1].path],
      agent: 'claude',
      promptOverrides: [],
      noCache: true,
    });
    expect(response).toMatchObject({ sourceCallSiteEvidence: [], sourceCallSiteRejections: [] });
    const db = openPipelineDb();
    try {
      const step = db.prepare('SELECT outputs FROM steps WHERE session_id = ?').get(response.sessionId) as {
        outputs: string;
      };
      expect(JSON.parse(step.outputs)).toMatchObject({ compositionEvidence: '[]', compositionRejections: '[]' });
    } finally {
      db.close();
    }
  });

  it('completes extraction without depending on an available composition agent', async () => {
    vi.mocked(runAgent).mockRejectedValue(new Error('agent unavailable'));
    await expect(
      runExtractAndComposeSession({
        projectPath,
        outDir: join(projectPath, 'output'),
        filePaths: files.map(({ path }) => path),
        agent: 'claude',
        promptOverrides: [],
        noCache: true,
      }),
    ).resolves.toMatchObject({ compositionPhase: 'done' });
    const db = openPipelineDb();
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM steps WHERE status = 'complete'").get()).toEqual({ count: 1 });
      expect(runAgent).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('honors cancellation after composition starts without invoking or caching an agent', async () => {
    const controller = new AbortController();
    const db = openPipelineDb();
    try {
      const running = resolveComposition({
        components: [components[0]!],
        sourceFiles: [files[0]!.path],
        signal: controller.signal,
        onProgress: (event) => {
          if (event.kind === 'composition' && event.phase === 'resolving') controller.abort();
        },
      });
      await expect(running).rejects.toMatchObject({ name: 'AbortError' });
      expect(runAgent).not.toHaveBeenCalled();
      expect(db.prepare('SELECT COUNT(*) AS count FROM composition_cache').get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});
