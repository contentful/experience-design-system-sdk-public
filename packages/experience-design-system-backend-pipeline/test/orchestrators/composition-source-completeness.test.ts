import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { runAgent } from '../../src/agents/index.js';
import { runCompositionService } from '../../src/steps/composition/src/services/run-composition-service.js';
import { readCompositionFiles } from '../../src/orchestrators/run-extract-and-compose-session/helpers/read-composition-files.js';
import { resolveComposition } from '../../src/orchestrators/run-extract-and-compose-session/helpers/resolve-composition.js';

vi.mock('../../src/agents/index.js', () => ({
  runAgent: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false })),
}));
const content = '/*' + 'é'.repeat(400_000) + '*/';

it('retains complete composition source files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'composition-prompt-completeness-'));
  try {
    const path = join(root, 'registry.ts');
    writeFileSync(path, content);
    const result = await readCompositionFiles([], [path]);
    expect(result).toEqual([{ path, content }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('resolves composition without invoking the retired agent or its cache callbacks', async () => {
  const onCacheLookup = vi.fn(() => '{"tool":"map_edge","parent":"A","child":"B"}');
  const onCacheStore = vi.fn();
  const onProgress = vi.fn();
  const result = await runCompositionService({
    components: [],
    allFiles: [{ path: '/example/registry.ts', content }],
    agent: 'codex',
    forceAgent: true,
    promptOverride: 'Retired composition prompt',
    onCacheLookup,
    onCacheStore,
    onProgress,
  });
  expect(runAgent).not.toHaveBeenCalled();
  expect(onCacheLookup).not.toHaveBeenCalled();
  expect(onCacheStore).not.toHaveBeenCalled();
  expect(onProgress.mock.calls).toEqual([['resolving'], ['done']]);
  expect(result).toMatchObject({ components: [], warnings: [], sourceCallSiteEvidence: [] });
});

it('reports incomplete caller coverage instead of presenting an unavailable index as confirmed absence', async () => {
  const onProgress = vi.fn();
  const result = await resolveComposition({
    components: [{ name: 'Surface', source: '/unavailable/Surface.tsx', framework: 'react', props: [], slots: [] }],
    sourceFiles: [],
    onProgress,
  });
  expect(result.sourceCallSiteCoverage?.components[0]?.outcome).toBe('unknown');
  expect(onProgress).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'composition',
      phase: 'done',
      activity:
        '0 source call-site observations collected · partial caller coverage — unobserved callers remain unknown',
    }),
  );
});
