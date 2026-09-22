import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScopeGateHost } from '../../../src/import/tui/scope-gate-host.js';

const TWO = [
  { name: 'Button', componentId: 'c0' },
  { name: 'Card', componentId: 'c1' },
];

describe('ScopeGateHost — compositionMode fork', () => {
  it('atomic mode renders the flat step with NO hierarchy affordances', () => {
    const { lastFrame } = render(
      <ScopeGateHost
        components={TWO}
        autoAccept={false}
        compositionMode="atomic"
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    // components render
    expect(out).toContain('Button');
    expect(out).toContain('Card');
    // flat-step chrome present
    expect(out).toContain('continue');
    // hierarchy affordances absent
    expect(out).not.toMatch(/Added groups/i);
    expect(out).not.toMatch(/Only cycles/i);
    expect(out).not.toMatch(/lineage/i);
    expect(out).not.toMatch(/\(cycle\)/i);
  });

  it('defaults to atomic when compositionMode is omitted', () => {
    const { lastFrame } = render(
      <ScopeGateHost components={TWO} autoAccept={false} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toMatch(/Added groups/i);
    expect(out).not.toMatch(/lineage/i);
  });

  it('surfaces a deterministic review candidate and lets the operator include it', () => {
    const onConfirm = vi.fn();
    const { lastFrame, stdin } = render(
      <ScopeGateHost
        components={[
          {
            name: 'Provider',
            componentId: 'c0',
            needsReview: true,
            aiReason: 'source uses createContext and component has no props',
          },
        ]}
        autoAccept={false}
        compositionMode="atomic"
        onConfirm={onConfirm}
        onQuit={() => {}}
      />,
    );

    expect(lastFrame()).toContain('Review flags');
    expect(lastFrame()).toContain('source uses createContext');

    stdin.write('a');
    stdin.write('f');

    expect(onConfirm).toHaveBeenCalledWith({ accepted: ['Provider'], rejected: [] });
  });

  it('keeps the list visible when a user toggle-all drives everything to excluded after AI filtering completed', () => {
    // Regression: AI flags one component (excluded by default). Filtering has
    // completed. User presses `A` to toggle-all the remaining (non-AI) components
    // to excluded too, landing at all-excluded by their own action — this must
    // NOT be mistaken for "AI excluded all components" and must NOT hide the list.
    const { lastFrame, stdin } = render(
      <ScopeGateHost
        components={[
          { name: 'Provider', componentId: 'c0', needsReview: true, aiReason: 'flagged by AI' },
          { name: 'Button', componentId: 'c1' },
        ]}
        autoAccept={false}
        compositionMode="atomic"
        aiFilterStatus="complete"
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );

    stdin.write('A');

    const out = lastFrame() ?? '';
    expect(out).not.toMatch(/AI excluded all components/i);
    expect(out).toContain('Provider');
    expect(out).toContain('Button');
  });

  it('composite mode renders the hierarchy-aware step', () => {
    const { lastFrame } = render(
      <ScopeGateHost
        components={TWO}
        autoAccept={false}
        compositionMode="composite"
        onConfirm={() => {}}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Button');
    // composite-only chrome (counter strip carries a Groups column)
    expect(out).toMatch(/Groups/i);
  });
});
