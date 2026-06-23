import { describe, expect, it } from 'vitest';
import { buildGenerateComponentsArgs } from '../../../src/import/tui/WizardApp.js';

describe('wizard generate-components cache', () => {
  it('defaults to cache-on (no --no-cache flag)', () => {
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

  it('passes --no-cache when noCache is true', () => {
    const args = buildGenerateComponentsArgs({
      sessionId: 'abc-123',
      tokensPath: '/tmp/tokens.json',
      agent: 'claude',
      noCache: true,
    });
    expect(args).toContain('--no-cache');
  });

  it('omits --no-cache when noCache is false or undefined (default)', () => {
    const explicit = buildGenerateComponentsArgs({
      sessionId: 's',
      agent: 'claude',
      noCache: false,
    });
    const omitted = buildGenerateComponentsArgs({
      sessionId: 's',
      agent: 'claude',
    });
    expect(explicit).not.toContain('--no-cache');
    expect(omitted).not.toContain('--no-cache');
  });
});
