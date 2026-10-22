import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runExtractAndComposeSession } from '../../src/orchestrators/run-extract-and-compose-session/run-extract-and-compose-session.js';
import { openPipelineDb, loadCompletedSourceEvidence } from '../../src/persistence/src/session/repositories/db.js';
import { runAgent } from '../../src/agents/services/run-agent.js';

vi.mock('../../src/agents/services/run-agent.js', () => ({ runAgent: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
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
