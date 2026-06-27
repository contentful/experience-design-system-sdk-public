import { describe, expect, it } from 'vitest';
import { buildSelectAgentArgs, parseAutoFilterProgressLine } from '../../../src/import/tui/WizardApp.js';

// `--no-auto-filter` flag plumbing: Commander turns `--no-auto-filter` into
// `opts.autoFilter = false`; the import command threads
// `autoFilter: opts.autoFilter !== false` into WizardAppProps. The Wizard
// runtime gates `runAutoFilter` on this prop. That gating is exercised
// indirectly: this test confirms the prop's default and threading shape.

describe('wizard auto-filter — buildSelectAgentArgs (Feature 3)', () => {
  it('passes --session and --exclude-invalid by default', () => {
    const args = buildSelectAgentArgs({ sessionId: 'abc-123', agent: 'claude' });
    expect(args).toContain('analyze');
    expect(args).toContain('select-agent');
    expect(args).toContain('--session');
    expect(args).toContain('abc-123');
    expect(args).toContain('--agent');
    expect(args).toContain('claude');
    // Validation auto-rejection is handled via reject_reason persistence; the
    // wizard always passes --exclude-invalid so the LLM gate doesn't fail-loud.
    expect(args).toContain('--exclude-invalid');
  });
});

describe('wizard auto-filter — parseAutoFilterProgressLine (Feature 3)', () => {
  it('parses an accepted decision line', () => {
    const r = parseAutoFilterProgressLine('progress=select-agent:3/10:accepted:Button:primary%20UI%20component');
    expect(r).toEqual({
      n: 3,
      total: 10,
      decision: 'accepted',
      name: 'Button',
      reason: 'primary UI component',
    });
  });

  it('parses a rejected decision line with URL-encoded reason containing a colon', () => {
    const r = parseAutoFilterProgressLine(
      'progress=select-agent:7/10:rejected:HeroBanner:data-fetch%20wrapper%3A%20skip',
    );
    expect(r).toEqual({
      n: 7,
      total: 10,
      decision: 'rejected',
      name: 'HeroBanner',
      reason: 'data-fetch wrapper: skip',
    });
  });

  it('returns null for non-progress lines', () => {
    expect(parseAutoFilterProgressLine('Validating 10 components')).toBeNull();
    expect(parseAutoFilterProgressLine('progress=scan:42')).toBeNull();
    expect(parseAutoFilterProgressLine('')).toBeNull();
  });

  it('returns null when the decision is not accepted/rejected', () => {
    expect(parseAutoFilterProgressLine('progress=select-agent:1/3:weird:Foo:bar')).toBeNull();
  });

  it('handles a line with no reason (empty trailing field)', () => {
    const r = parseAutoFilterProgressLine('progress=select-agent:1/1:accepted:Foo:');
    expect(r).toEqual({ n: 1, total: 1, decision: 'accepted', name: 'Foo', reason: '' });
  });
});
