import { describe, it, expect } from 'vitest';
import { buildSelectAgentArgs, buildGenerateComponentsArgs } from '../../../src/import/tui/WizardApp.js';

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

describe('buildSelectAgentArgs — --no-cache forwarding', () => {
  it('appends --no-cache when noCache is true', () => {
    const args = buildSelectAgentArgs({
      sessionId: 's1',
      agent: 'claude',
      noCache: true,
    });
    expect(args).toContain('--no-cache');
  });

  it('omits --no-cache when noCache is false or undefined', () => {
    const explicit = buildSelectAgentArgs({
      sessionId: 's1',
      agent: 'claude',
      noCache: false,
    });
    const omitted = buildSelectAgentArgs({ sessionId: 's1', agent: 'claude' });
    expect(explicit).not.toContain('--no-cache');
    expect(omitted).not.toContain('--no-cache');
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
