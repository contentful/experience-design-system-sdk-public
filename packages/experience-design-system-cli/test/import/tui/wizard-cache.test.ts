import { describe, expect, it } from 'vitest';
import {
  buildGenerateComponentsArgs,
  buildMapTokensArgs,
  shouldRunMapTokens,
} from '../../../src/import/tui/WizardApp.js';

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

describe('wizard map-tokens step', () => {
  it('builds the map tokens command with the generated session and agent', () => {
    expect(
      buildMapTokensArgs({
        sessionId: 'generated-session',
        agent: 'claude',
        model: 'model-a',
        noCache: true,
      }),
    ).toEqual([
      'map',
      'tokens',
      '--session',
      'generated-session',
      '--agent',
      'claude',
      '--model',
      'model-a',
      '--no-cache',
    ]);
  });

  it('requires both mappable props and raw tokens before invoking the agent', () => {
    expect(shouldRunMapTokens({ mappablePropCount: 1, rawTokenCount: 1 })).toBe(true);
    expect(shouldRunMapTokens({ mappablePropCount: 0, rawTokenCount: 1 })).toBe(false);
    expect(shouldRunMapTokens({ mappablePropCount: 1, rawTokenCount: 0 })).toBe(false);
  });
});
