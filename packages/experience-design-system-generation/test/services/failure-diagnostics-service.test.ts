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
