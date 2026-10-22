import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { runAgent } from '../../src/agents/index.js';
import { runCompositionService } from '../../src/steps/composition/src/services/run-composition-service.js';
import { selectCompositionPromptFiles } from '../../src/orchestrators/run-extract-and-compose-session/helpers/select-composition-prompt-files.js';

vi.mock('../../src/agents/index.js', () => ({
  runAgent: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false })),
}));
const content = '/*' + 'é'.repeat(400_000) + '*/';

it('retains complete composition candidates above the former prompt budget', async () => {
  const root = mkdtempSync(join(tmpdir(), 'composition-prompt-completeness-'));
  try {
    const path = join(root, 'registry.ts');
    writeFileSync(path, content);
    const result = await selectCompositionPromptFiles([], [path]);
    expect(result.promptFiles).toEqual([{ path, content }]);
    expect(result.runtimeFiles).toEqual([{ path, content }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('passes complete composition candidates to the service agent', async () => {
  await runCompositionService({
    components: [],
    allFiles: [{ path: '/example/registry.ts', content }],
    agent: 'codex',
    forceAgent: true,
  });
  expect(vi.mocked(runAgent).mock.calls[0]?.[0]?.prompt.includes(content)).toBe(true);
});
