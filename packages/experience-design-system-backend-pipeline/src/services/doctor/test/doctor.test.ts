import { describe, expect, it } from 'vitest';
import { checkNodeVersion } from '../check-node-version.js';
import { installCommand, installHint } from '../helpers/install-command.js';
import { stderrLines } from '../helpers/stderr-lines.js';
import { AGENT_DEFS } from '../constants/agent-defs.js';

describe('checkNodeVersion', () => {
  it('passes for the required major', () => {
    const r = checkNodeVersion('24.0.0');
    expect(r.passed).toBe(true);
    expect(r.major).toBe(24);
  });

  it('fails below the required major', () => {
    const r = checkNodeVersion('18.19.0');
    expect(r.passed).toBe(false);
    expect(r.required).toBe(24);
  });
});

describe('agent definitions', () => {
  it('installCommand uses npm install -g', () => {
    const claude = AGENT_DEFS.find((a) => a.binary === 'claude')!;
    expect(installCommand(claude)).toBe('npm install -g @anthropic-ai/claude-code');
  });

  it('installHint appends the suffix', () => {
    const claude = AGENT_DEFS.find((a) => a.binary === 'claude')!;
    expect(installHint(claude)).toBe('npm install -g @anthropic-ai/claude-code && claude login');
  });
});

describe('stderrLines', () => {
  it('returns at most `limit` info lines', () => {
    const out = stderrLines('a\nb\nc\nd', 2);
    expect(out).toEqual([
      { kind: 'info', text: 'a' },
      { kind: 'info', text: 'b' },
    ]);
  });
});
