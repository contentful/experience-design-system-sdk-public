import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runExtractAndComposeSession } from '../../src/orchestrators/run-extract-and-compose-session/run-extract-and-compose-session.js';
import {
  openPipelineDb,
  loadCompletedSourceEvidence,
  loadRawComponents,
} from '../../src/persistence/src/session/repositories/db.js';
import { runAgent } from '../../src/agents/services/run-agent.js';
import { emitPreClassificationExclusions } from '../../src/orchestrators/run-extract-and-compose-session/helpers/emit-pre-classification-exclusions.js';

vi.mock('../../src/agents/services/run-agent.js', () => ({ runAgent: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

it('preserves extractor-owned exclusions without inventing prop exclusions', () => {
  const sourceExclusion = {
    itemType: 'file' as const,
    name: 'unavailable.ts',
    reason: 'source unavailable',
    stage: 'extract',
  };
  const extraction = {
    components: [
      {
        name: 'Surface',
        source: '/project/Surface.tsx',
        framework: 'react' as const,
        props: [{ name: 'onReady', type: '() => void', required: true }],
        slots: [],
      },
    ],
    warnings: [],
    exclusions: [sourceExclusion],
  };
  const report = vi.fn();
  emitPreClassificationExclusions(extraction, report);
  expect(report.mock.calls).toEqual([[sourceExclusion]]);
  expect(report.mock.calls[0]![0]).not.toBe(sourceExclusion);
  expect(() => emitPreClassificationExclusions(extraction, undefined)).not.toThrow();
});

it('completes and reopens a session with mixed frameworks and admitted non-component context', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-session-')));
  roots.push(root);
  vi.stubEnv('EDS_PIPELINE_DB_PATH', join(root, 'pipeline.db'));
  vi.stubEnv('DISABLE_ANALYTICS', '1');
  vi.mocked(runAgent).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
  const sources = {
    'Surface.tsx': 'export const Surface = ({ label }: {label: string}) => <section>{label}</section>;',
    'Panel.vue':
      '<script setup lang="ts">defineProps<{ label: string }>();</script><template><aside>{{ label }}</aside></template>',
    'helper.ts': 'export const helper = true;',
    'Context.md': '# Context',
    'data.json': '{"label":"sample"}',
  };
  const filePaths = Object.entries(sources).map(([name, text]) => {
    const path = join(root, name);
    writeFileSync(path, text);
    return path;
  });
  const result = await runExtractAndComposeSession({
    projectPath: root,
    outDir: join(root, 'output'),
    filePaths,
    evidenceFilePaths: [],
    agent: 'codex',
    promptOverrides: [],
    noCache: true,
  });
  expect(result.components.map((component) => component.name).sort()).toEqual(['Panel', 'Surface']);
  expect(result.scannedFileCount).toBe(filePaths.length);
  expect(result.sourceEvidenceHandle.readiness).toBe('ready');
  filePaths.forEach((path) => rmSync(path));
  const db = openPipelineDb();
  try {
    const saved = loadCompletedSourceEvidence(db, result.sessionId, result.sourceEvidenceHandle);
    expect(saved.readiness).toBe('ready');
    if (saved.readiness !== 'ready') throw new Error('Completed source missing');
    expect(saved.envelope.capture.inventory?.selectedSourcePaths).toEqual([...filePaths].sort());
    expect(saved.envelope.capture.coverage).toBe('partial');
    expect(saved.envelope.capture.files.find((file) => file.canonicalPath === filePaths[0])?.captured).toEqual({
      kind: 'full',
      text: sources['Surface.tsx'],
    });
  } finally {
    db.close();
  }
});

it('retains complete unclassified source inputs through the fresh session and saved reload', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'retained-input-session-')));
  roots.push(root);
  vi.stubEnv('EDS_PIPELINE_DB_PATH', join(root, 'pipeline.db'));
  vi.stubEnv('DISABLE_ANALYTICS', '1');
  vi.mocked(runAgent).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
  const path = join(root, 'Surface.tsx');
  writeFileSync(
    path,
    `export function Surface(props: {
    onReady: string; ref: string; key: string; testId: string; disabled: boolean;
    componentId: string; size: number; role: 'first' | 'second'; callback: () => void;
  }) { return <div>{props.onReady}{props.ref}{props.key}{props.testId}{props.disabled}{props.componentId}{props.size}{props.role}</div>; }`,
  );
  const exclusions: Record<string, unknown>[] = [];
  const result = await runExtractAndComposeSession({
    projectPath: root,
    outDir: join(root, 'output'),
    filePaths: [path],
    evidenceFilePaths: [],
    agent: 'codex',
    promptOverrides: [],
    noCache: true,
    onExclusion: (value) => exclusions.push(value),
  });
  const names = ['callback', 'componentId', 'disabled', 'key', 'onReady', 'ref', 'role', 'size', 'testId'];
  const component = result.components[0]!;
  expect(component.props.map((prop) => prop.name).sort()).toEqual(names);
  expect(component.props.every((prop) => prop.category === undefined)).toBe(true);
  expect(component.sourceCandidates?.map((input) => input.name).sort()).toEqual(names);
  expect(exclusions.some((value) => value.itemType === 'prop' || value.stage === 'pre-classify')).toBe(false);
  rmSync(path);
  const db = openPipelineDb();
  try {
    const saved = loadRawComponents(db, result.sessionId)[0]!;
    expect(saved.props.map((prop) => prop.name).sort()).toEqual(names);
    expect(saved.props.every((prop) => prop.category === undefined)).toBe(true);
    expect(saved.sourceCandidates?.map((input) => input.name).sort()).toEqual(names);
    expect(saved.componentFacts?.sourceObservations?.componentDeclarationId).toEqual(
      component.componentFacts?.sourceObservations?.componentDeclarationId,
    );
    expect(saved.componentEvidenceReadStatus).toBe('available');
  } finally {
    db.close();
  }
});
