import { describe, expect, it } from 'vitest';
import { formatArgvPromptSizeLimitError, MAX_ARGV_PROMPT_BYTES, shouldUseStdinForPrompt } from '../src/index.js';

describe('agent prompt transport policy', () => {
  it('defines the shared argv prompt byte limit', () => {
    expect(MAX_ARGV_PROMPT_BYTES).toBe(100_000);
  });

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

  it('formats one shared argv limit diagnostic', () => {
    expect(formatArgvPromptSizeLimitError('opencode', 100_004)).toBe(
      'The opencode prompt is being sent as a command-line argument and exceeds the 100000-byte safety limit (100004 UTF-8 bytes). Use claude or codex with stdin delivery for large projects.',
    );
  });
});
