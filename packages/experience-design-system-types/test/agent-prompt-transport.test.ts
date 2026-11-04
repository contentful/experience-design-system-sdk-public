import { describe, expect, it } from 'vitest';
import { shouldUseStdinForPrompt } from '../src/index.js';

describe('agent prompt transport policy', () => {
  it.each(['claude', 'codex'])('defaults %s to stdin', (agent) => {
    expect(shouldUseStdinForPrompt(agent)).toBe(true);
  });

  it.each(['opencode', 'cursor', 'copilot'])('defaults %s to argv', (agent) => {
    expect(shouldUseStdinForPrompt(agent)).toBe(false);
  });

  it('honors explicit transport choices for every agent', () => {
    expect(shouldUseStdinForPrompt('claude', false)).toBe(false);
    expect(shouldUseStdinForPrompt('opencode', true)).toBe(true);
  });
});
