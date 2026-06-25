import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';

// Pilot-testing invariant pinned by commit def35ef:
// "Components with zero classified $properties surface in final-review with
//  (empty) suffix + yellow warning banner."
//
// Feature 3 introduces auto-AI-filter, which CANNOT silently drop zero-prop
// components. If select-agent rejects a zero-prop component, it must STILL
// surface in the AI-excluded section (so the operator sees it). If un-excluded
// via `a`, it must flow through to the main accepted list and ultimately to
// final-review with the existing banner.
//
// This test pins both halves of the invariant: scope-gate auto-filter
// surfacing, and the dual-write contract that `runScopeGate` later honors.

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
    // Component must surface — never silently dropped.
    expect(out).toContain('OpaqueWidget');
    // Pilot-2026-06-25: separate "AI excluded" section is gone — the row
    // still surfaces but inline in the unified list with an [AI] badge and
    // an EXCLUDED label.
    expect(out).toContain('[AI]');
    expect(out).toContain('EXCLUDED');
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
    // Accepted zero-prop components should NOT show up in the AI-excluded section.
    expect(out).not.toContain('AI excluded');
    // OpaqueWidget renders in the main list.
    expect(out).toContain('OpaqueWidget');
    // f confirms with OpaqueWidget in accepted.
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
    // The AI-rejected zero-prop component is in the rejected list — so
    // applyScopeDecisions explicitly marks status='rejected' (not silently
    // skipped) and the snapshot reflects it. This is the same dual-write the
    // 4b4a1ac invariant pins.
    expect(arg.rejected).toContain('OpaqueWidget');
    expect(arg.accepted).not.toContain('OpaqueWidget');
  });
});
