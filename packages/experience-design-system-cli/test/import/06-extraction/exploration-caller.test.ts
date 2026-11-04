import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ exploration: vi.fn(async () => ({ ok: true })), open: vi.fn() }));
vi.mock('@contentful/experience-design-system-backend-pipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@contentful/experience-design-system-backend-pipeline')>()),
  runExplorationComponentsSession: calls.exploration,
  openPipelineDb: calls.open,
  createLocalCliAgentInvoker: () => ({ invoke: vi.fn() }),
}));
vi.mock('../../../src/tui/import/steps/06-extraction/find-skill-path.js', () => ({
  findSkillPath: (name: string) => name,
}));
import { runSelection } from '../../../src/tui/import/steps/06-extraction/selection.js';
describe('completed extraction exploration caller', () => {
  it('omits malformed optional model context while continuing completed-handle exploration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'exploration-alignment-'));
    try {
      const path = join(directory, 'existing.json');
      await writeFile(path, JSON.stringify({ components: [null], tokens: [] }));
      calls.exploration.mockClear();
      await runSelection({
        sessionId: 'session',
        agent: 'codex',
        noCache: false,
        sourceEvidenceHandle: {
          extractionStepId: 1,
          envelopeId: 'envelope',
          digest: 'digest',
          coverage: 'partial',
          readiness: 'ready',
        },
        existingEntitiesPath: path,
      });
      expect(calls.exploration).toHaveBeenCalledWith(
        expect.objectContaining({ existingComponentsInline: undefined, existingTokensInline: undefined }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('routes the completed handle to fresh seven-scope exploration without opening the legacy selection reader', async () => {
    const handle = {
      extractionStepId: 1,
      envelopeId: 'envelope',
      digest: 'digest',
      coverage: 'partial' as const,
      readiness: 'ready' as const,
    };
    await runSelection({
      sessionId: 'session',
      agent: 'codex',
      model: 'model',
      noCache: false,
      sourceEvidenceHandle: handle,
      promptText: 'custom instructions',
    });
    expect(calls.exploration).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session',
        sourceEvidenceHandle: handle,
        agent: 'codex',
        model: 'model',
        promptText: 'custom instructions',
      }),
    );
    expect(calls.open).not.toHaveBeenCalled();
  });
});
