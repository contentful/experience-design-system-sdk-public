import { describe, expect, it } from 'vitest';
import { buildGenerateComponentsArgs } from '../../../src/import/tui/WizardApp.js';

describe('wizard generate-components cache', () => {
  it('never passes --no-cache', () => {
    const args = buildGenerateComponentsArgs({
      sessionId: 'abc-123',
      tokensPath: '/tmp/tokens.json',
      agent: 'claude',
    });
    expect(args).not.toContain('--no-cache');
  });

  it('does pass --session and --agent', () => {
    const args = buildGenerateComponentsArgs({
      sessionId: 's',
      agent: 'claude',
    });
    expect(args).toContain('--session');
    expect(args).toContain('s');
    expect(args).toContain('--agent');
    expect(args).toContain('claude');
  });
});
