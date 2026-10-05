import { describe, expect, it } from 'vitest';
import { describeAgentFailure } from '../../src/generate/services/failure-diagnostics-service.js';

describe('failure diagnostics service', () => {
  it('includes exit code and stderr detail', () => {
    expect(
      describeAgentFailure({
        exitCode: 1,
        stdout: '',
        stderr: 'agent error',
        timedOut: false,
      }),
    ).toBe('agent exited with code 1 — agent error');
  });

  it('uses stdout when stderr is empty and reports missing tool calls', () => {
    expect(
      describeAgentFailure({
        exitCode: 0,
        stdout: 'no structured output',
        stderr: '',
        timedOut: false,
      }),
    ).toBe('agent produced no tool calls — no structured output');
  });

  it('limits diagnostic detail to the requested tail length', () => {
    const message = describeAgentFailure(
      { exitCode: 1, stdout: '', stderr: `${'x'.repeat(20)}TAIL`, timedOut: false },
      4,
    );

    expect(message).toBe('agent exited with code 1 — TAIL');
  });
});

describe('describeAgentFailure', () => {
  it('includes exit code and stderr tail for a nonzero exit', () => {
    const msg = describeAgentFailure({
      exitCode: 1,
      stdout: '',
      stderr: 'ERROR: model "claude-3-5-haiku-20241022" is no longer available',
      timedOut: false,
    });
    expect(msg).toContain('agent exited with code 1');
    expect(msg).toContain('no longer available');
  });

  it('reports "no tool calls" and falls back to stdout when stderr is empty', () => {
    const msg = describeAgentFailure({
      exitCode: 0,
      stdout: 'I could not classify this component because the props were empty.',
      stderr: '',
      timedOut: false,
    });
    expect(msg).toContain('agent produced no tool calls');
    expect(msg).toContain('props were empty');
  });

  it('truncates long detail to the tail', () => {
    const long = 'x'.repeat(2000) + 'TAIL_MARKER';
    const msg = describeAgentFailure({ exitCode: 1, stdout: '', stderr: long, timedOut: false }, 800);
    expect(msg).toContain('TAIL_MARKER');
    expect(msg.length).toBeLessThan(900);
  });

  it('returns the base message alone when there is no stderr/stdout detail', () => {
    const msg = describeAgentFailure({ exitCode: 127, stdout: '', stderr: '', timedOut: false });
    expect(msg).toBe('agent exited with code 127');
  });
});
