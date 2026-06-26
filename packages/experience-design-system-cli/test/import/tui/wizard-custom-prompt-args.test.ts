import { describe, it, expect } from 'vitest';
import {
  buildSelectAgentArgs,
  buildGenerateComponentsArgs,
} from '../../../src/import/tui/WizardApp.js';

describe('buildSelectAgentArgs — custom prompt path (Feature 8)', () => {
  it('appends --select-prompt-path when selectPromptPath is set', () => {
    const args = buildSelectAgentArgs({
      sessionId: 's1',
      agent: 'claude',
      selectPromptPath: '/tmp/custom-select.md',
    });
    const idx = args.indexOf('--select-prompt-path');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('/tmp/custom-select.md');
  });

  it('omits --select-prompt-path when selectPromptPath is undefined', () => {
    const args = buildSelectAgentArgs({ sessionId: 's1', agent: 'claude' });
    expect(args).not.toContain('--select-prompt-path');
  });
});

describe('buildGenerateComponentsArgs — custom prompt path (Feature 8)', () => {
  it('appends --generate-prompt-path when generatePromptPath is set', () => {
    const args = buildGenerateComponentsArgs({
      sessionId: 's1',
      agent: 'claude',
      generatePromptPath: '/tmp/custom-gen.md',
    });
    const idx = args.indexOf('--generate-prompt-path');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('/tmp/custom-gen.md');
  });

  it('omits --generate-prompt-path when generatePromptPath is undefined', () => {
    const args = buildGenerateComponentsArgs({ sessionId: 's1', agent: 'claude' });
    expect(args).not.toContain('--generate-prompt-path');
  });
});
