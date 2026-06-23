import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../../src/import/tui/steps/ScopeGateStep.js';

const FIXTURE = [
  { name: 'Button', componentId: 'c0' },
  { name: 'Card', componentId: 'c1' },
  { name: 'Junk', componentId: 'c2' },
];

describe('ScopeGateStep', () => {
  it('renders all component names', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={FIXTURE}
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    expect(out).toContain('Card');
    expect(out).toContain('Junk');
  });

  it('calls onConfirm with all-accepted on f when no toggles happened', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({
      accepted: ['Button', 'Card', 'Junk'],
      rejected: [],
    });
  });

  it('toggles selection with a and confirms with f', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Move down twice (j) to land on 'Junk' then 'a' to toggle off
    stdin.write('j');
    stdin.write('j');
    stdin.write('a');
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledWith({
      accepted: ['Button', 'Card'],
      rejected: ['Junk'],
    });
  });

  it('A toggles all', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // First A: all currently included → flip to all rejected
    stdin.write('A');
    stdin.write('f');
    expect(onConfirm).toHaveBeenLastCalledWith({
      accepted: [],
      rejected: ['Button', 'Card', 'Junk'],
    });

    // Second A: all currently rejected → flip back to all accepted
    stdin.write('A');
    stdin.write('f');
    expect(onConfirm).toHaveBeenLastCalledWith({
      accepted: ['Button', 'Card', 'Junk'],
      rejected: [],
    });
  });

  it('r explicitly rejects the cursor component', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    // Cursor starts at Button. Move down once to land on Card, then reject it.
    stdin.write('j');
    stdin.write('r');
    stdin.write('f');
    expect(onConfirm).toHaveBeenCalledWith({
      accepted: ['Button', 'Junk'],
      rejected: ['Card'],
    });
  });

  it('F (capital) also confirms', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={onConfirm} onQuit={() => {}} />,
    );
    stdin.write('F');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({
      accepted: ['Button', 'Card', 'Junk'],
      rejected: [],
    });
  });

  it('calls onQuit on q', () => {
    const onQuit = vi.fn();
    const { stdin } = render(
      <ScopeGateStep components={FIXTURE} onConfirm={() => {}} onQuit={onQuit} />,
    );
    stdin.write('q');
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});

// ── Feature 3: AI-excluded section ────────────────────────────────────────────

describe('ScopeGateStep — AI-excluded section (Feature 3)', () => {
  const MIXED = [
    { name: 'Button', componentId: 'c0' },
    { name: 'Card', componentId: 'c1' },
    { name: 'BadgeIcon', componentId: 'c2', aiDecision: 'rejected' as const, aiReason: 'low semantic value' },
    { name: 'DivWrapper', componentId: 'c3', aiDecision: 'rejected' as const, aiReason: 'no semantic content' },
    { name: 'Hero', componentId: 'c4' },
  ];

  it('renders the AI-excluded header with count when there are rejected components', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI excluded (2)');
    // Both excluded names + reasons appear (expanded by default).
    expect(out).toContain('BadgeIcon');
    expect(out).toContain('low semantic value');
    expect(out).toContain('DivWrapper');
    expect(out).toContain('no semantic content');
  });

  it('omits the section entirely when zero AI-rejected components', () => {
    const allAccepted = [
      { name: 'Button', componentId: 'c0' },
      { name: 'Card', componentId: 'c1' },
    ];
    const { lastFrame } = render(
      <ScopeGateStep
        components={allAccepted}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('AI excluded');
    expect(out).not.toContain('AI filtering');
  });

  it('renders the running header with progress counter when aiFilterStatus is running', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="running"
        aiFilterProgress={{ done: 2, total: 5 }}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI filtering');
    expect(out).toContain('2/5');
  });

  it('renders a cancellation banner when aiFilterStatus is cancelled', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="cancelled"
        aiFilterProgress={{ done: 2, total: 5 }}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI auto-filter cancelled');
  });

  it('renders a failure banner when aiFilterStatus is failed', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={MIXED}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="failed"
        aiFilterError="agent crashed"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI auto-filter failed');
    expect(out).toContain('agent crashed');
  });

  it('renders <no reason given> for AI-rejected component without a reason', () => {
    const { lastFrame } = render(
      <ScopeGateStep
        components={[
          { name: 'Foo', componentId: 'c0' },
          { name: 'NoReason', componentId: 'c1', aiDecision: 'rejected', aiReason: null },
        ]}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('NoReason');
    expect(out).toContain('no reason given');
  });

  it('shows yellow banner when ALL components are AI-rejected', () => {
    const allRejected = [
      { name: 'A', componentId: 'c0', aiDecision: 'rejected' as const, aiReason: 'r1' },
      { name: 'B', componentId: 'c1', aiDecision: 'rejected' as const, aiReason: 'r2' },
    ];
    const { lastFrame } = render(
      <ScopeGateStep
        components={allRejected}
        onConfirm={() => {}}
        onQuit={() => {}}
        aiFilterStatus="complete"
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('AI excluded all components');
  });
});
