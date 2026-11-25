import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createAgentPromptArtifact, shouldUsePromptArtifact } from '../src/index.js';

describe('Codex prompt artifact transport', () => {
  it('switches oversized turn inputs without imposing a content cap', () => {
    expect(shouldUsePromptArtifact('codex', 'x'.repeat(1_048_576))).toBe(false);
    expect(shouldUsePromptArtifact('codex', 'x'.repeat(1_048_577))).toBe(true);
    expect(shouldUsePromptArtifact('claude', 'x'.repeat(2_000_000))).toBe(false);
  });

  it('saves every instruction and evidence byte, with private read-only permissions and explicit read guidance', async () => {
    const original = `Task\n${'JSON and source evidence 😀 '.repeat(100_000)}\nOutput protocol`;
    const artifact = await createAgentPromptArtifact(original);
    try {
      expect(await readFile(artifact.path, 'utf8')).toBe(original);
      expect((await stat(artifact.path)).mode & 0o777).toBe(0o400);
      expect(artifact.prompt.length).toBeLessThan(1_048_576);
      expect(artifact.prompt).toContain(JSON.stringify(artifact.path));
      expect(artifact.prompt).toContain('repository filesystem tools');
      expect(artifact.prompt).toContain('truncated tool output is not complete evidence');
    } finally {
      await artifact.dispose();
    }
    expect(existsSync(artifact.path)).toBe(false);
    await artifact.dispose();
  });

  it('rejects preparation for an already-aborted task', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createAgentPromptArtifact('task', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
