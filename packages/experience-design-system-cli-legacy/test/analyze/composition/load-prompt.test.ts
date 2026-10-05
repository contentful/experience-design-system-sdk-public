import { describe, it, expect } from 'vitest';
import { resolvePromptPath, loadPrompt } from '../../../src/analyze/composition/prompt-loader.js';

describe('load-prompt', () => {
  it('resolves a bundled prompt from the package prompts/ dir', () => {
    const p = resolvePromptPath('composition-edges.md');
    expect(p).toMatch(/prompts[/\\]composition-edges\.md$/);
  });

  it('loads the composition-edges prompt content', () => {
    const text = loadPrompt('composition-edges.md');
    expect(text.length).toBeGreaterThan(0);
  });

  it('throws a clear error for a missing prompt file', () => {
    expect(() => loadPrompt('does-not-exist.md')).toThrow(/prompt file missing/i);
  });
});
