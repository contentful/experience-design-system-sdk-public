import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';

describe('zero-prop component preserved through auto-filter (Feature 3 regression)', () => {
  it('surfaces a zero-prop AI-rejected component in the AI-excluded section', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={[
          { name: 'Button', componentId: 'c0' },
          { name: 'OpaqueWidget', componentId: 'c1', aiDecision: 'rejected', aiReason: 'no semantic value' },
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('OpaqueWidget');
    expect(out).not.toContain('[AI]');
    expect(out).toMatch(/AI recommended exclusions/);
  });

  it('routes a zero-prop AI-accepted component into the main list', () => {
    const onConfirm = vi.fn();
    const { lastFrame, stdin } = render(
      <ScopeGateStep
        components={[
          { name: 'Button', componentId: 'c0' },
          { name: 'OpaqueWidget', componentId: 'c1', aiDecision: 'accepted', aiReason: null },
        ]}
        onConfirm={onConfirm}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('AI excluded');
    expect(out).toContain('OpaqueWidget');
    stdin.write('Y');
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.accepted).toContain('OpaqueWidget');
    expect(arg.rejected).not.toContain('OpaqueWidget');
  });

  it('confirm includes a zero-prop AI-rejected component in the rejected list (dual-write contract)', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep
        components={[
          { name: 'Button', componentId: 'c0' },
          { name: 'OpaqueWidget', componentId: 'c1', aiDecision: 'rejected', aiReason: 'no semantic value' },
        ]}
        onConfirm={onConfirm}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    stdin.write('f');
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rejected).toContain('OpaqueWidget');
    expect(arg.accepted).not.toContain('OpaqueWidget');
  });
});
