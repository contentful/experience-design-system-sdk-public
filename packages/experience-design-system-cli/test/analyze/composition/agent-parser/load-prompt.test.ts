import { describe, it, expect } from 'vitest';
import { resolvePromptPath, loadPrompt } from '../../../../src/analyze/composition/agent-parser/load-prompt.js';

describe('load-prompt', () => {
  it('resolves the bundled composition-parser.md from the package prompts/ dir', () => {
    const p = resolvePromptPath('composition-parser.md');
    expect(p).toMatch(/prompts[/\\]composition-parser\.md$/);
  });

  it('loads the composition parser prompt content', () => {
    const text = loadPrompt('composition-parser.md');
    expect(text).toMatch(/pure/i);
    expect(text).toContain('export default function');
    expect(text).toMatch(/STRICT RULES/);
  });

  it('throws a clear error for a missing prompt file', () => {
    expect(() => loadPrompt('does-not-exist.md')).toThrow(/prompt file missing/i);
  });
});
